import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
import { GoogleGenerativeAI } from 'https://esm.run/@google/generative-ai';

const GEMINI_MODELS = ['gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview', 'gemini-2.5-flash'];

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

const genAI = new GoogleGenerativeAI(CONFIG.GEMINI_API_KEY);

export async function generateContentWithFallback(prompt) {
  let lastError = null;
  for (const modelName of GEMINI_MODELS) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      return result;
    } catch (error) {
      console.warn(`[AI 폴백] ${modelName} 호출 실패. 다음 모델 시도 중...`, error.message);
      lastError = error;

      if (error.status === 429 || error.message.includes('429') || error.message.includes('quota')) {
        console.warn('[System] API 요청 한도 초과. 폴백을 중단합니다.');
        break;
      }
    }
  }
  throw lastError || new Error('모든 AI 모델 호출에 실패했습니다.');
}
