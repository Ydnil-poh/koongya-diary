import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
import { GoogleGenAI } from 'https://esm.run/@google/genai';

const AI_COOLDOWN_UNTIL_KEY = 'koongya_ai_cooldown_until';
const DEFAULT_MODEL_CANDIDATES = ['gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview', 'gemini-2.5-flash'];
const REQUEST_TIMEOUT_MS = 25000;

let CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  GEMINI_API_KEY: ''
};

async function initializeConfig() {
  const cachedConfig = localStorage.getItem('koongya_config');
  if (cachedConfig) {
    try {
      const parsed = JSON.parse(cachedConfig);
      // 필수 값인 API 키가 있는지 확인
      if (parsed.GEMINI_API_KEY && parsed.GEMINI_API_KEY.trim() !== '') {
        CONFIG = parsed;
        console.log('[System] 캐시된 설정을 로드했습니다.');
      } else {
        console.warn('[System] 캐시된 설정에 API 키가 없어 무시합니다.');
        localStorage.removeItem('koongya_config');
      }
    } catch (e) {
      localStorage.removeItem('koongya_config');
    }
  }

  // 캐시에 없거나 부실할 경우 파일/서버에서 다시 로드
  if (!CONFIG.GEMINI_API_KEY) {
    try {
      const module = await import('../config.js');
      if (module.CONFIG && module.CONFIG.GEMINI_API_KEY) {
        CONFIG = module.CONFIG;
        localStorage.setItem('koongya_config', JSON.stringify(CONFIG));
        console.log('[System] config.js 파일에서 설정을 새로 로드했습니다.');
      }
    } catch (e) {
      console.error('[System] 설정을 로드하는 데 실패했습니다.');
    }
  }
}

await initializeConfig();

export const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'koongya-diary-auth' }
});

let genAIInstance = null;

function getGenAI() {
  if (genAIInstance) return genAIInstance;
  
  const apiKey = CONFIG.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    console.error('[AI] API Key가 설정되지 않았습니다. 현재 설정 상태:', CONFIG);
    throw new Error('API_KEY_MISSING');
  }

  try {
    // 2026년 기준 SDK는 문자열 혹은 객체를 모두 지원할 수 있으나 가장 표준적인 방식으로 시도
    genAIInstance = new GoogleGenAI(apiKey);
    return genAIInstance;
  } catch (e) {
    console.warn('[AI] 문자열 초기화 실패, 객체 방식으로 재시도합니다.');
    genAIInstance = new GoogleGenAI({ apiKey: apiKey });
    return genAIInstance;
  }
}

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
    const ai = getGenAI();
    const models = await ai.models.list();
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
  const cooldownMs = getAiCooldownRemainingMs();
  if (cooldownMs > 0) {
    throw new Error(`AI_COOLDOWN:${Math.ceil(cooldownMs / 1000)}`);
  }

  const modelNames = await getAvailableModelNames();
  let lastError = null;

  for (const modelName of modelNames) {
    console.log(`[AI] ${modelName} 모델로 요청 중...`);
    try {
      const ai = getGenAI();
      const model = ai.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      return { response: { text: () => result.response.text() || '' } };
    } catch (error) {
      console.warn(`[AI] ${modelName} 호출 실패:`, error.message);
      lastError = error;

      if (error.status === 429 || error.message.includes('429') || error.message.includes('quota')) {
        const retryMs = parseRetryDelayMs(error) || 60 * 1000;
        setAiCooldown(retryMs);
        throw new Error(`AI_COOLDOWN:${Math.ceil(retryMs / 1000)}`);
      }
    }
  }
  throw lastError || new Error('모든 AI 모델 호출에 실패했습니다.');
}

export async function* generateContentStreamWithFallback(prompt) {
  const cooldownMs = getAiCooldownRemainingMs();
  if (cooldownMs > 0) {
    throw new Error(`AI_COOLDOWN:${Math.ceil(cooldownMs / 1000)}`);
  }

  const modelNames = await getAvailableModelNames();
  let lastError = null;

  for (const modelName of modelNames) {
    console.log(`[AI-Stream] ${modelName} 모델로 스트리밍 요청 중...`);
    try {
      const ai = getGenAI();
      const model = ai.getGenerativeModel({ model: modelName });
      const result = await model.generateContentStream(prompt);
      
      for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        if (chunkText) {
          yield chunkText;
        }
      }
      return; 

    } catch (error) {
      console.warn(`[AI-Stream] ${modelName} 호출 실패:`, error.message);
      lastError = error;

      if (error.status === 429 || error.message.includes('429') || error.message.includes('quota')) {
        const retryMs = parseRetryDelayMs(error) || 60 * 1000;
        setAiCooldown(retryMs);
        throw new Error(`AI_COOLDOWN:${Math.ceil(retryMs / 1000)}`);
      }
    }
  }
  throw lastError || new Error('모든 AI 모델 호출에 실패했습니다.');
}
