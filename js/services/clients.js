import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
import { GoogleGenAI } from 'https://esm.run/@google/genai';

const AI_COOLDOWN_UNTIL_KEY = 'koongya_ai_cooldown_until';
const DEFAULT_MODEL_CANDIDATES = ['gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview', 'gemini-2.5-flash'];

let CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  GEMINI_API_KEY: ''
};

async function initializeConfig() {
  const cachedConfig = localStorage.getItem('koongya_config');
  if (cachedConfig) {
    try {
      CONFIG = JSON.parse(cachedConfig);
      console.log('[System] 로컬 캐시에서 설정을 즉시 로드했습니다.');

      fetch('/api/config')
        .then((res) => res.json())
        .then((serverConfig) => {
          if (serverConfig.SUPABASE_URL) {
            localStorage.setItem('koongya_config', JSON.stringify(serverConfig));
          }
        })
        .catch(() => {});
      return;
    } catch (e) {
      console.warn('[System] 캐시된 설정을 파싱할 수 없습니다.', e);
    }
  }

  try {
    const response = await fetch('/api/config');
    if (response.ok) {
      const serverConfig = await response.json();
      if (serverConfig.SUPABASE_URL) {
        CONFIG = serverConfig;
        localStorage.setItem('koongya_config', JSON.stringify(serverConfig));
        console.log('[System] 서버 보안 설정을 로드했습니다.');
        return;
      }
    }
  } catch (e) {
    console.log('[System] 서버 API 응답 없음. 로컬 모드로 진행합니다.');
  }

  try {
    const module = await import('../config.js');
    if (module.CONFIG) {
      CONFIG = module.CONFIG;
      localStorage.setItem('koongya_config', JSON.stringify(CONFIG));
    }
    console.log('[System] 로컬 설정 파일을 로드했습니다.');
  } catch (e) {
    console.error('[System] 설정을 불러올 수 없습니다. API 키를 확인해주세요.');
  }
}

await initializeConfig();

export const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'koongya-diary-auth' }
});

const genAI = new GoogleGenAI({ apiKey: CONFIG.GEMINI_API_KEY });

let cachedModelNames = null;
let modelCacheAt = 0;
const MODEL_CACHE_TTL_MS = 10 * 60 * 1000;

function parseRetryDelayMs(error) {
  const raw = error?.message || '';
  const secMatch = raw.match(/retry in\s+([\d.]+)s/i) || raw.match(/retryDelay":"(\d+)s/i);
  if (secMatch) return Math.max(1000, Math.ceil(parseFloat(secMatch[1]) * 1000));
  return null;
}

function setAiCooldown(ms) {
  const until = Date.now() + ms;
  localStorage.setItem(AI_COOLDOWN_UNTIL_KEY, String(until));
  return until;
}

export function getAiCooldownRemainingMs() {
  const until = Number(localStorage.getItem(AI_COOLDOWN_UNTIL_KEY) || 0);
  return Math.max(0, until - Date.now());
}

async function getAvailableModelNames() {
  if (cachedModelNames && Date.now() - modelCacheAt < MODEL_CACHE_TTL_MS) return cachedModelNames;
  try {
    const models = await genAI.models.list();
    const names = [];
    for await (const model of models) {
      if (model.supportedActions && model.supportedActions.includes('generateContent')) {
        names.push(model.name.replace('models/', ''));
      }
    }
    cachedModelNames = names.length ? names : DEFAULT_MODEL_CANDIDATES;
    modelCacheAt = Date.now();
    return cachedModelNames;
  } catch (e) {
    cachedModelNames = DEFAULT_MODEL_CANDIDATES;
    modelCacheAt = Date.now();
    return cachedModelNames;
  }
}

export async function generateContentWithFallback(prompt) {
  // 요청 큐를 저장/재전송하지 않습니다. 각 호출은 즉시 실행되고, 429면 즉시 종료합니다.
  const cooldownMs = getAiCooldownRemainingMs();
  if (cooldownMs > 0) {
    throw new Error(`AI_COOLDOWN:${Math.ceil(cooldownMs / 1000)}`);
  }

  const modelNames = await getAvailableModelNames();
  let lastError = null;
  for (const modelName of modelNames) {
    try {
      const result = await genAI.models.generateContent({ model: modelName, contents: prompt });
      return { response: { text: () => result.text || '' } };
    } catch (error) {
      console.warn(`[AI 폴백] ${modelName} 호출 실패. 다음 모델 시도 중...`, error.message);
      lastError = error;

      if (error.status === 429 || error.message.includes('429') || error.message.includes('quota')) {
        console.warn('[System] API 요청 한도 초과. 폴백을 중단합니다.');
        const retryMs = parseRetryDelayMs(error) || 60 * 1000;
        const until = setAiCooldown(retryMs);
        const cooldownError = new Error(`AI_COOLDOWN:${Math.ceil((until - Date.now()) / 1000)}`);
        cooldownError.cause = error;
        throw cooldownError;
      }
    }
  }
  throw lastError || new Error('모든 AI 모델 호출에 실패했습니다.');
}
