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
      if (parsed.GEMINI_API_KEY && parsed.GEMINI_API_KEY.trim() !== '') {
        CONFIG = parsed;
        console.log('[System] 캐시된 설정을 로드했습니다.');
      } else {
        localStorage.removeItem('koongya_config');
      }
    } catch (e) {
      localStorage.removeItem('koongya_config');
    }
  }

  if (!CONFIG.GEMINI_API_KEY) {
    try {
      const module = await import('../config.js');
      if (module.CONFIG && module.CONFIG.GEMINI_API_KEY) {
        CONFIG = module.CONFIG;
        localStorage.setItem('koongya_config', JSON.stringify(CONFIG));
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
    throw new Error('API_KEY_MISSING');
  }

  // 최신 SDK (@google/genai) 규격
  genAIInstance = new GoogleGenAI({ apiKey: apiKey });
  return genAIInstance;
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
      // 최신 SDK 모델 속성 기준
      names.push(model.name.replace('models/', ''));
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
    try {
      const ai = getGenAI();
      // 최신 SDK 호출 방식
      const result = await ai.models.generateContent({
        model: modelName,
        contents: prompt
      });
      
      return { response: { text: () => result.text || '' } }; // app.js 호환성 유지
    } catch (error) {
      console.warn(`[AI] ${modelName} 호출 실패:`, error.message);
      lastError = error;

      if (error.status === 429 || (error.message && error.message.includes('429'))) {
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
    console.log(`[AI-Stream] ${modelName} 모델로 요청 시도 중...`);
    try {
      const ai = getGenAI();
      // 최신 SDK 스트리밍 호출 방식
      const responseStream = await ai.models.generateContentStream({
        model: modelName,
        contents: prompt
      });
      
      for await (const chunk of responseStream) {
        if (chunk.text) {
          yield chunk.text;
        }
      }
      return; 

    } catch (error) {
      console.warn(`[AI-Stream] ${modelName} 호출 실패:`, error.message);
      lastError = error;

      if (error.status === 429 || (error.message && error.message.includes('429'))) {
        const retryMs = parseRetryDelayMs(error) || 60 * 1000;
        setAiCooldown(retryMs);
        throw new Error(`AI_COOLDOWN:${Math.ceil(retryMs / 1000)}`);
      }
    }
  }
  throw lastError || new Error('모든 AI 모델 호출에 실패했습니다.');
}
