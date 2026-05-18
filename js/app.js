import { KOONGYA_ORDER, getKoongyaById, getKoongyaImagePath, normalizeKoongyaId } from './data/koongyas.js';
import { supabase, generateContentWithFallback, generateContentStreamWithFallback, getAiCooldownRemainingMs } from './services/clients.js';
import {
  getEl,
  showToast,
  hideLoadingOverlay,
  saveGardenToLocal,
  loadGardenFromLocal,
  renderGarden
} from './ui/common.js';

let currentUser = null;
let unlockedKoongyas = ['onion'];
let selectedCellIndex = null;
let currentDbId = null;
let currentKoongyaId = null;
let currentStep = 1;
let currentKoongyaName = '';
let retrospectiveCache = { koongyaId: null, content: null };
let aiCooldownTimer = null;
let lastCooldownToastAt = 0;
const COOLDOWN_TOAST_INTERVAL_MS = 10 * 1000;
let retrospectiveGenerationInFlight = false;

const AI_LIMITS = {
  CHAT_HISTORY_LIMIT: 6,
  RETRO_SOURCE_LOG_LIMIT: 80,
  RETRO_RECENT_LOG_LIMIT: 6,
  RETRO_RELEVANT_LOG_LIMIT: 10,
  GRAD_HISTORY_LIMIT: 8,
  MAX_MESSAGE_CHARS: 280,
  MAX_RETRO_MESSAGE_CHARS: 180,
  MAX_RETRO_CONTEXT_CHARS: 2400,
  MAX_DIARY_CHARS: 500
};

const RETRIEVAL_STOPWORDS = new Set(['그리고', '그래서', '그런데', '하지만', '나는', '내가', '너는', '오늘', '그냥', '진짜', '약간', '너무', '이제', '대화', '생각', '쿵야']);

function clipText(value, maxChars) {
  if (!value) return '';
  return value.length > maxChars ? `${value.slice(0, maxChars)}…` : value;
}

function buildSpeechStyleGuide() {
  const koongya = getKoongyaById(currentKoongyaId) || {
    name: currentKoongyaName || '쿵야',
    speechStyle: '짧고 친근한 쿵야 말투를 유지한다.',
    sampleEnding: '쿵'
  };

  return `[말투 고정]
현재 대화 상대는 '${koongya.name} 쿵야'다. 성격이나 판단 방식은 바꾸지 말고, 답변의 말투만 이 쿵야처럼 맞춘다.
말투: ${koongya.speechStyle}
대표 어미/표현: ${koongya.sampleEnding}

[말투 유지 규칙]
1. 답변의 내용과 분석 관점은 기존 역할 지침을 따른다.
2. 문장 끝 표현은 대표 어미/표현을 자연스럽게 섞되, 다른 쿵야의 말투를 섞지 않는다.
3. 말투를 설명하지 말고, 해당 말투로 바로 답한다.`;
}

function buildChatGuide() {
  return `${buildSpeechStyleGuide()}

[기대 역할]
너는 사용자의 질문을 분석하고 전문 지식(철학, 과학, 트렌드 등)을 결합해 해설하는 '인텔리전스 가이드'야. 단, 답변 말투는 반드시 현재 쿵야의 말투로 맞춰.

[응답 규칙 - 절대 준수]
1. 일반적인 AI 비서처럼 "~입니다/습니다"로 끝나는 말투는 피해줘.
2. 마크다운 기호(#, **, -, > 등)를 절대 사용하지 마. 오직 순수 텍스트만 사용해.
3. 2~3문장 이내로 짧고 깊이 있게 대답한 뒤, 마지막에 현재 쿵야 말투로 날카로운 확장 질문 1개를 던져.
4. 말투를 설명하지 말고, 해당 말투로 바로 답해.`;
}

function buildRetrospectiveGuide() {
  return `${buildSpeechStyleGuide()}

[역할]
너는 대화에서 이미 나온 단편적인 생각들을 일기 글감으로 정리하는 '회고 편집자'야. 새 관점으로 사고를 확장하지 말고, 지난 대화에서 나온 내용만 압축하고 재배치해.

[정리 원칙]
1. 사용자 발화를 중심 자료로 삼고, 쿵야 발화는 생각의 연결 흐름을 파악하는 보조 단서로만 사용해.
2. 심리 분석, 전문 용어 해설, 새로운 조언, 추가 확장 질문은 하지 마.
3. 흩어진 생각을 시간순 그대로 나열하지 말고 출발점 → 감정/인식 → 이유/근거 → 일기로 이어질 문장 흐름으로 재배치해.
4. 중복 표현은 합치고, 서로 이어지는 생각은 한 문장으로 묶어.
5. 출력은 순수 텍스트만 사용하고 마크다운 기호(**, #, -, > 등)는 쓰지 마.

[출력 형식]
오늘의 글감
1. 출발점: 사용자가 처음 꺼낸 핵심 생각을 1문장으로 정리
2. 이어진 생각: 대화 중 반복되거나 연결된 생각을 2~3문장으로 정리
3. 일기로 옮길 흐름: 그대로 일기 첫 문단에 써도 어색하지 않게 3~5문장으로 매끄럽게 정리
마지막 문장: "자, 이제 이 흐름을 네 일기로 다듬어 볼까?"를 현재 쿵야 말투로 변형해 마무리`;
}

function buildDialogueSnippet(logs, maxChars = AI_LIMITS.MAX_MESSAGE_CHARS) {
  if (!logs || logs.length === 0) return '';
  return logs
    .map((log) => `${log.sender === 'user' ? '사용자' : '쿵야'}: ${clipText(log.message, maxChars)}`)
    .join('\n');
}

function tokenizeForRetrieval(value) {
  const tokens = (value || '').toLowerCase().match(/[가-힣a-z0-9]{2,}/g) || [];
  return tokens.filter((token) => !RETRIEVAL_STOPWORDS.has(token));
}

function buildRetrievalWeights(logs) {
  return logs.reduce((weights, log) => {
    if (log.sender !== 'user') return weights;
    tokenizeForRetrieval(log.message).forEach((token) => {
      weights.set(token, (weights.get(token) || 0) + 1);
    });
    return weights;
  }, new Map());
}

function scoreRetrospectiveLog(log, index, totalCount, weights) {
  const uniqueTokens = new Set(tokenizeForRetrieval(log.message));
  let keywordScore = 0;
  uniqueTokens.forEach((token) => {
    keywordScore += weights.get(token) || 0;
  });

  const userBoost = log.sender === 'user' ? 1.5 : 0;
  const recencyBoost = totalCount > 1 ? index / (totalCount - 1) : 0;
  return keywordScore + userBoost + recencyBoost;
}

function selectRetrospectiveLogs(logs) {
  if (!logs || logs.length === 0) return [];

  const weights = buildRetrievalWeights(logs);
  const selectedIndexes = new Set();
  const firstUserIndex = logs.findIndex((log) => log.sender === 'user');

  if (firstUserIndex >= 0) selectedIndexes.add(firstUserIndex);

  const recentStartIndex = Math.max(logs.length - AI_LIMITS.RETRO_RECENT_LOG_LIMIT, 0);
  logs.slice(recentStartIndex).forEach((_, offset) => {
    selectedIndexes.add(recentStartIndex + offset);
  });

  logs
    .map((log, index) => ({ index, score: scoreRetrospectiveLog(log, index, logs.length, weights) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, AI_LIMITS.RETRO_RELEVANT_LOG_LIMIT)
    .forEach(({ index }) => selectedIndexes.add(index));

  return [...selectedIndexes]
    .filter((index) => index >= 0 && index < logs.length)
    .sort((a, b) => a - b)
    .map((index) => logs[index]);
}

function buildRetrospectiveContext(logs) {
  const selectedLogs = selectRetrospectiveLogs(logs);
  if (selectedLogs.length === 0) return '';

  const lines = selectedLogs.map((log, index) => {
    const speaker = log.sender === 'user' ? '사용자' : '쿵야';
    return `${index + 1}. ${speaker}: ${clipText(log.message, AI_LIMITS.MAX_RETRO_MESSAGE_CHARS)}`;
  });

  let context = '';
  for (const line of lines) {
    const nextContext = context ? `${context}\n${line}` : line;
    if (nextContext.length > AI_LIMITS.MAX_RETRO_CONTEXT_CHARS) break;
    context = nextContext;
  }

  return context;
}

function parseCooldownSeconds(error) {
  if (!error?.message) return 0;
  const match = error.message.match(/AI_COOLDOWN:(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}


function syncAICooldownUI() {
  const remainingMs = getAiCooldownRemainingMs();
  const remainingSec = Math.ceil(remainingMs / 1000);
  
  const sendBtn = getEl('send-btn');
  const retroBtn = getEl('retrospective-btn');
  const regenBtn = getEl('regenerate-insight-btn');
  const saveBtn = getEl('save-diary-btn');
  
  const isDisabled = remainingMs > 0;

  // 버튼 상태 업데이트
  [sendBtn, retroBtn, regenBtn, saveBtn].forEach((btn) => {
    if (btn) btn.disabled = isDisabled;
  });

  // 토스트 알림 (너무 자주 뜨지 않게 인터벌 체크)
  const now = Date.now();
  if (isDisabled && now - lastCooldownToastAt >= COOLDOWN_TOAST_INTERVAL_MS) {
    showToast(`AI 요청 대기 중이에요. ${remainingSec}초 후 다시 시도해 주세요.`);
    lastCooldownToastAt = now;
  }

  // 타이머 관리
  if (aiCooldownTimer) clearTimeout(aiCooldownTimer);
  if (isDisabled) {
    aiCooldownTimer = setTimeout(syncAICooldownUI, 1000);
  } else {
    aiCooldownTimer = null;
    lastCooldownToastAt = 0;
  }
}


function switchView(viewName) {
  const gardenView = getEl('garden-view');
  const chatView = getEl('chat-view');
  
  if (viewName === 'chat') {
    if (gardenView) gardenView.classList.add('hidden');
    if (chatView) chatView.classList.remove('hidden');
    sessionStorage.setItem('koongya_current_view', 'chat');
  } else {
    if (chatView) chatView.classList.add('hidden');
    if (gardenView) gardenView.classList.remove('hidden');
    sessionStorage.removeItem('koongya_current_view');
    sessionStorage.removeItem('koongya_current_db_id');
  }
}

function appendChatLogItem(chatLog, text, sender) {
  if (!chatLog) return;
  const item = document.createElement('div');
  item.className = 'chat-log-item';
  
  const nameSpan = document.createElement('span');
  nameSpan.className = `chat-log-name ${sender === 'user' ? 'user' : 'ai'}`;
  nameSpan.textContent = sender === 'user' ? '나' : currentKoongyaName;
  
  const textSpan = document.createElement('span');
  textSpan.className = 'chat-log-text';
  textSpan.textContent = `: ${text}`;
  
  item.appendChild(nameSpan);
  item.appendChild(textSpan);
  chatLog.appendChild(item);
  chatLog.scrollTop = chatLog.scrollHeight;
}
async function updateUnlockedList() {
  if (!currentUser) return;
  try {
    const { data } = await supabase.from('archives').select('koongya_type').eq('user_id', currentUser.id);
    console.log('[디버깅] 아카이브 해금 데이터:', data, '현재 유저:', currentUser.id);
    const graduatedIds = data ? data.map((item) => normalizeKoongyaId(item.koongya_type)) : [];
    const newUnlocked = ['onion'];
    KOONGYA_ORDER.forEach((koongya, index) => {
      if (graduatedIds.includes(koongya.id) && index + 1 < KOONGYA_ORDER.length) {
        const nextKoongya = KOONGYA_ORDER[index + 1];
        if (!newUnlocked.includes(nextKoongya.id)) newUnlocked.push(nextKoongya.id);
      }
    });
    unlockedKoongyas = newUnlocked;
    console.log('[디버깅] 최종 해금된 쿵야 리스트:', unlockedKoongyas);
  } catch (err) {
    console.error('해금 로드 에러:', err);
    showToast('해금 로드 실패');
  }
}

async function updateUIForAuth(session) {
  const loginScreen = getEl('login-screen');
  const gardenContainer = document.querySelector('.garden-container');
  const archiveBtn = getEl('archive-btn');
  const topControls = getEl('top-controls');
  if (session) {
    currentUser = session.user;
    if (loginScreen) loginScreen.style.display = 'none';
    if (gardenContainer) {
      gardenContainer.style.display = 'block';
      requestAnimationFrame(() => gardenContainer.classList.add('visible'));
    }
    if (topControls) topControls.classList.remove('hidden');
    else if (archiveBtn) archiveBtn.classList.remove('hidden');
    
    loadGardenFromLocal(renderGarden);
    await Promise.all([loadActiveKoongyas(), updateUnlockedList()]);
    
    // 뷰 복구 로직
    const savedView = sessionStorage.getItem('koongya_current_view');
    const savedDbId = sessionStorage.getItem('koongya_current_db_id');
    
    if (savedView === 'chat' && savedDbId) {
      const welcome = getEl('welcome-message');
      if (welcome) welcome.style.display = 'none';

      // 저장된 ID에 해당하는 셀을 찾아서 채팅창 열기 시도
      setTimeout(() => {
        const cells = document.querySelectorAll('.cell');
        const targetCell = Array.from(cells).find(c => c.getAttribute('data-db-id') === savedDbId);
        if (targetCell) {
          openChatPanel(targetCell);
        } else {
          switchView('garden');
        }
      }, 500); // 그리드 렌더링 대기
    } else {
      switchView('garden');
    }
  } else {
    currentUser = null;
    if (loginScreen) {
      loginScreen.style.display = 'flex';
      loginScreen.classList.remove('hidden');
    }
    if (gardenContainer) {
      gardenContainer.classList.remove('visible');
      gardenContainer.style.display = 'none';
    }
    if (topControls) topControls.classList.add('hidden');
    else if (archiveBtn) archiveBtn.classList.add('hidden');
    hideLoadingOverlay();
  }
}

async function handleEmailLogin() {
  const email = getEl('email-input').value;
  const password = getEl('password-input').value;
  if (!email || !password) {
    showToast('입력해주세요!');
    return;
  }

  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

  if (signInError) {
    if (signInError.message.includes('Invalid login credentials') || signInError.status === 400) {
      console.log('[Auth] 계정이 없어 회원가입을 시도합니다.');
      const { error: signUpError } = await supabase.auth.signUp({ email, password });
      if (signUpError) {
        showToast('실패: ' + signUpError.message);
        return;
      }
      showToast('가입 완료! 자동으로 로그인 중...');
      await supabase.auth.signInWithPassword({ email, password });
    } else {
      showToast('로그인 실패: ' + signInError.message);
    }
  }
}


async function handleLogout() {
  const logoutBtn = getEl('logout-btn');
  if (logoutBtn) logoutBtn.disabled = true;
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    localStorage.removeItem('cached_garden');
    ['chat-panel', 'retrospective-panel', 'archive-panel', 'graduation-modal', 'seed-popup', 'guide-modal'].forEach((id) => {
      const el = getEl(id);
      if (el) el.classList.add('hidden');
    });
    showToast('로그아웃되었습니다.');
  } catch (error) {
    console.error('로그아웃 에러:', error);
    showToast(`로그아웃 실패: ${error.message || '잠시 후 다시 시도해 주세요.'}`);
  } finally {
    if (logoutBtn) logoutBtn.disabled = false;
  }
}

async function loadActiveKoongyas() {
  if (!currentUser) return;
  try {
    const { data, error } = await supabase
      .from('active_koongyas')
      .select('id, cell_index, koongya_type, current_step')
      .eq('user_id', currentUser.id);
    if (error) throw error;
    renderGarden(data);
    saveGardenToLocal(data);
  } catch (error) {
    console.error('로드 에러:', error);
  } finally {
    hideLoadingOverlay();
  }
}

function openSeedPopup() {
  const popup = getEl('seed-popup');
  if (!popup) return;
  
  let popupHtml = '<h3>어떤 쿵야를 심을까요?</h3><div class="seed-list">';
  let hasUnlocked = false;

  KOONGYA_ORDER.forEach((koongya) => {
    if (unlockedKoongyas.includes(koongya.id)) {
      popupHtml += `<div class="seed-item unlocked" onclick="plantSeed('${koongya.id}')">🌱 ${koongya.name} 쿵야</div>`;
      hasUnlocked = true;
    } else {
      popupHtml += `<div class="seed-item locked" title="다른 쿵야를 졸업시키면 해금됩니다.">🔒 ???</div>`;
    }
  });

  if (!hasUnlocked) {
    popupHtml += '<p style="font-size:0.9rem; color:#666;">심을 수 있는 쿵야가 아직 없어요.<br>(Onion 쿵야가 기본 해금되어야 합니다)</p>';
  }

  popupHtml += '</div><button id="close-popup" class="ui-button" style="margin-top: 15px;">닫기</button>';
  popup.innerHTML = popupHtml;
  popup.classList.remove('hidden');
  getEl('close-popup').onclick = () => popup.classList.add('hidden');
}

async function plantSeed(koongyaType) {
  if (!currentUser) {
    showToast('사용자 정보를 잃어버렸습니다. (새로고침 버그)');
    console.error('[디버깅] plantSeed 실행 시 currentUser가 null입니다!');
    return;
  }
  try {
    const { error } = await supabase
      .from('active_koongyas')
      .insert([{ user_id: currentUser.id, koongya_type: koongyaType, cell_index: parseInt(selectedCellIndex), current_step: 1, diary_content: '' }]);
    if (error) throw error;
    await loadActiveKoongyas();
    getEl('seed-popup').classList.add('hidden');
    showToast(`${koongyaType} 쿵야를 심었습니다!`);
  } catch (error) {
    showToast('심기 실패: ' + (error.message || '오류 발생'));
    console.error('쿵야 심기 에러 상세:', error);
  }
}
window.plantSeed = plantSeed;

async function openChatPanel(cell) {
  try {
    const dbId = cell.getAttribute('data-db-id');
    if (!dbId || dbId === 'undefined') {
      await loadActiveKoongyas();
      return;
    }

    currentDbId = dbId;
    currentKoongyaId = cell.getAttribute('data-koongya-id');
    currentStep = parseInt(cell.getAttribute('data-step')) || 1;

    const koongyaData = getKoongyaById(currentKoongyaId);
    currentKoongyaName = koongyaData ? koongyaData.name : '쿵야';

    // 1. 캐릭터 비주얼 업데이트
    const imgEl = getEl('chat-koongya-img');
    if (imgEl) imgEl.src = getKoongyaImagePath(currentKoongyaId, currentStep);
    getEl('chat-koongya-name-display').innerText = currentKoongyaName;
    getEl('chat-koongya-step').innerText = currentStep;

    // 2. 대화 기록 및 스트리밍 영역 초기화
    const chatLog = getEl('chat-log');
    chatLog.innerHTML = "<p style='text-align:center; color:#999;'>기록을 불러오는 중...</p>";
    getEl('active-message-text').innerText = '';

    // 3. 기록 로드 및 뷰 전환
    await loadChatHistory(currentDbId);
    updateRetroButtonVisibility().catch(console.error);
    
    switchView('chat');
    sessionStorage.setItem('koongya_current_db_id', currentDbId);

  } catch (err) {
    console.error('채팅창 열기 에러:', err);
  }
}

async function updateRetroButtonVisibility() {
  const { count, error } = await supabase.from('chat_logs').select('*', { count: 'exact', head: true }).eq('koongya_id', currentDbId).eq('sender', 'user');
  const retroBtn = getEl('retrospective-btn');
  if (retroBtn && !error) {
    let requiredCount = 5;
    if (currentStep === 2) requiredCount = 8;
    else if (currentStep === 3) requiredCount = 11;
    else if (currentStep === 4) requiredCount = 14;
    else if (currentStep === 5) requiredCount = 15;

    if (count >= requiredCount) retroBtn.classList.remove('hidden');
    else retroBtn.classList.add('hidden');
  }
}

async function loadChatHistory(dbId) {
  const chatLog = getEl('chat-log');
  const { data } = await supabase.from('chat_logs').select('*').eq('koongya_id', dbId).order('created_at', { ascending: true }).limit(50);
  if (data) {
    chatLog.innerHTML = '';
    data.forEach((log) => {
      appendChatLogItem(chatLog, log.message, log.sender === 'user' ? 'user' : 'ai');
    });
    chatLog.scrollTop = chatLog.scrollHeight;
  }
}

async function handleSendMessage() {
  if (getAiCooldownRemainingMs() > 0) {
    syncAICooldownUI();
    return;
  }
  
  const chatInput = getEl('chat-input');
  const chatLog = getEl('chat-log');
  const activeMessageText = getEl('active-message-text');
  const loadingDots = getEl('chat-loading-dots');
  const sendBtn = getEl('send-btn');

  const targetDbId = currentDbId;
  const sessionUser = currentUser;

  if (!chatInput || !chatLog || !sessionUser) {
    if (!sessionUser) showToast('로그인이 필요합니다.');
    return;
  }

  const message = clipText(chatInput.value.trim(), AI_LIMITS.MAX_MESSAGE_CHARS);
  if (!message) return;

  try {
    if (sendBtn) sendBtn.disabled = true;
    if (chatInput) chatInput.disabled = true;

    // 1. 유저 메시지 저장 및 로그 업데이트
    await saveChatLog(targetDbId, 'user', message);
    appendChatLogItem(chatLog, message, 'user');
    chatInput.value = '';
    retrospectiveCache = { koongyaId: null, content: null };

    // 2. AI 대기 UI
    if (activeMessageText) activeMessageText.innerText = '';
    if (loadingDots) loadingDots.classList.remove('hidden');

    // 3. AI 스트리밍 답변 생성
    const { data: koongyaDataDb } = await supabase.from('active_koongyas').select('diary_content').eq('id', targetDbId).single();
    let diaryContext = '';
    if (koongyaDataDb?.diary_content) {
      diaryContext = `[이전 일기 요약]\n"${clipText(koongyaDataDb.diary_content, AI_LIMITS.MAX_DIARY_CHARS)}"\n\n`;
    }

    const { data: recentLogs } = await supabase
      .from('chat_logs')
      .select('sender, message')
      .eq('koongya_id', targetDbId)
      .order('created_at', { ascending: false })
      .limit(AI_LIMITS.CHAT_HISTORY_LIMIT);
    const recentContext = buildDialogueSnippet((recentLogs || []).reverse());

    const systemPrompt = buildChatGuide();
    const stream = generateContentStreamWithFallback(`${diaryContext}[최근 대화]
${recentContext}

[요청]
마지막 사용자 발화에 현재 쿵야 말투로 답해.
쿵야:`, systemPrompt);
    
    if (loadingDots) loadingDots.classList.add('hidden');
    
    let fullResponse = '';
    for await (const chunk of stream) {
      fullResponse += chunk;
      if (activeMessageText) activeMessageText.innerText = fullResponse;
    }

    // 4. 최종 답변 저장 및 로그 추가
    await saveChatLog(targetDbId, 'ai', fullResponse);
    appendChatLogItem(chatLog, fullResponse, 'ai');
    updateRetroButtonVisibility().catch(console.error);

  } catch (error) {
    console.error('[Chat] 에러:', error);
    if (parseCooldownSeconds(error) > 0) syncAICooldownUI();
    if (loadingDots) loadingDots.classList.add('hidden');
    showToast(error.message === 'TIMEOUT' ? '응답 시간이 초과되었습니다.' : '오류가 발생했습니다.');
  } finally {
    if (sendBtn && getAiCooldownRemainingMs() <= 0) sendBtn.disabled = false;
    if (chatInput) {
      chatInput.disabled = false;
      chatInput.focus();
    }
  }
}

async function saveChatLog(dbId, sender, message) {
  const { error } = await supabase.from('chat_logs').insert([{ koongya_id: dbId, sender, message }]);
  if (error) {
    console.error('채팅 저장 에러:', error);
    showToast('채팅 저장 실패: ' + error.message);
  }
}

async function generateRetrospectiveDraft() {
  if (retrospectiveGenerationInFlight) return;
  
  if (getAiCooldownRemainingMs() > 0) {
    syncAICooldownUI();
    getEl('active-message-text').innerHTML = '<p class="status-text">쿵야가 조금 지쳤나봐요. 잠시 후 다시 부탁해 주세요.</p>';
    return;
  }

  const regenBtn = getEl('regenerate-insight-btn');
  const targetArea = getEl('active-message-text');
  
  try {
    retrospectiveGenerationInFlight = true;
    if (regenBtn) regenBtn.disabled = true;

    if (retrospectiveCache.koongyaId === currentDbId && retrospectiveCache.content) {
      if (targetArea) targetArea.innerHTML = `<div class="insight-box">${retrospectiveCache.content.replace(/\n/g, '<br>')}</div>`;
      return;
    }

    if (targetArea) targetArea.innerHTML = '<p class="status-text">쿵야가 대화를 글감으로 정리하고 있어요...</p>';

    const { data: logs, error: logsError } = await supabase
      .from('chat_logs')
      .select('sender, message')
      .eq('koongya_id', currentDbId)
      .order('created_at', { ascending: false })
      .limit(AI_LIMITS.RETRO_SOURCE_LOG_LIMIT);

    if (logsError) throw logsError;

    const chatContext = buildRetrospectiveContext((logs || []).reverse());
    const systemPrompt = buildRetrospectiveGuide();
    
    console.log('[Retrospective] 글감 정리 요청 시작');
    const result = await generateContentWithFallback(
      `[대화 기록]\n${chatContext}\n\n[요청]\n대화에서 나온 단편적인 생각들을 하나의 매끄러운 일기 글감으로 압축하고 재배치해 줘.`,
      systemPrompt
    );
    
    const retrospectiveText = result.response.text();
    console.log('[Retrospective] 글감 정리 완료');
    
    retrospectiveCache = { koongyaId: currentDbId, content: retrospectiveText };
    
    // 통합된 UI: 좌측 하단 스트리밍 영역에 정리된 글감 출력
    getEl('dialogue-label').innerText = '정리된 글감';
    if (targetArea) targetArea.innerHTML = `<div class="insight-box">${retrospectiveText.replace(/\n/g, '<br>')}</div>`;

  } catch (error) {
    console.error('[Retrospective] 에러:', error);
    if (parseCooldownSeconds(error) > 0) {
      syncAICooldownUI();
      getEl('active-message-text').innerHTML = '<p class="status-text">쿵야가 조금 지쳤나봐요. 잠시 후 다시 부탁해 주세요.</p>';
    } else {
      getEl('active-message-text').innerHTML = '<p class="status-text">글감 정리에 실패했어요. 다시 한번 말씀해 주세요.</p>';
      showToast('글감 정리 실패: ' + (error.message || '알 수 없는 오류'));
    }
  } finally {
    retrospectiveGenerationInFlight = false;
    if (regenBtn && getAiCooldownRemainingMs() <= 0) {
      regenBtn.disabled = false;
    }
  }
}

function toggleChatMode(mode) {
  const isRetro = mode === 'retro';
  
  // 제목 변경
  const title = getEl('chat-right-title');
  if (title) title.innerText = isRetro ? '회고 및 일기 작성' : '대화 기록';
  
  // 영역 전환
  getEl('chat-log').classList.toggle('hidden', isRetro);
  getEl('chat-diary-area').classList.toggle('hidden', !isRetro);
  
  // 하단 섹션 전환
  getEl('chat-input-section').classList.toggle('hidden', isRetro);
  getEl('chat-retro-section').classList.toggle('hidden', !isRetro);
  
  // 상단 회고 버튼 숨기기
  const retroBtn = getEl('retrospective-btn');
  if (retroBtn) retroBtn.classList.toggle('hidden', isRetro);
  
  // 라벨 및 텍스트 리셋/설정
  if (isRetro) {
    getEl('dialogue-label').innerText = '정리된 글감';
    getEl('active-message-text').innerHTML = '<p class="status-text">쿵야가 오늘 나눈 대화를 글감으로 정리하고 있어요...</p>';
  } else {
    getEl('dialogue-label').innerText = '쿵야의 생각';
    getEl('active-message-text').innerText = '';
  }
}

async function openRetrospective() {
  toggleChatMode('retro');
  generateRetrospectiveDraft();
  const diaryInput = getEl('diary-input');
  diaryInput.value = '불러오는 중...';
  try {
    const { data } = await supabase.from('active_koongyas').select('diary_content').eq('id', currentDbId).single();
    diaryInput.value = data ? data.diary_content : '';
  } catch (err) {
    diaryInput.value = '';
  }
}

async function processGraduation(diaryContent) {
  showToast('🎓 쿵야가 마지막 인사를 준비하고 있어요. 잠시만 기다려주세요!');

  try {
    const { data: logs } = await supabase
      .from('chat_logs')
      .select('sender, message')
      .eq('koongya_id', currentDbId)
      .order('created_at', { ascending: false })
      .limit(AI_LIMITS.GRAD_HISTORY_LIMIT);
    const chatContext = buildDialogueSnippet((logs || []).reverse());
    const safeDiary = clipText(diaryContent, AI_LIMITS.MAX_DIARY_CHARS);

    const result = await generateContentWithFallback(
      `사용자가 너와 나눈 최근 대화와 마지막 일기를 바탕으로, 다음 글을 더 길고 깊게 쓸 수 있게 돕는 '핵심 확장 질문 1개'를 30자 이내로 작성해.\n\n[최근 대화내용]\n"${chatContext}"\n\n[일기]\n"${safeDiary}"`,
      buildChatGuide()
    );
    const coreQuestion = result.response.text().replace(/"/g, '').trim();
    const imagePath = getKoongyaImagePath(currentKoongyaId, 5);

    const { error: archiveError } = await supabase.from('archives').insert([{ user_id: currentUser.id, koongya_type: currentKoongyaId, image_path: imagePath, core_question: coreQuestion, final_diary: diaryContent }]);
    if (archiveError) throw archiveError;

    await supabase.from('active_koongyas').delete().eq('id', currentDbId);

    // 회고 모드 종료
    toggleChatMode('chat');

    getEl('grad-koongya-img').src = imagePath;
    getEl('grad-core-question').innerText = `"${coreQuestion}"`;
    getEl('grad-date').innerText = new Date().toLocaleDateString();
    getEl('graduation-modal').classList.remove('hidden');

    localStorage.removeItem('cached_garden');
    await Promise.all([loadActiveKoongyas(), updateUnlockedList()]);
  } catch (error) {
    if (parseCooldownSeconds(error) > 0) syncAICooldownUI();
    console.error('졸업 에러:', error);
    if (error.message && error.message.includes('503')) {
      showToast('앗, 쿵야가 눈물을 닦느라 늦어지네요! (서버 지연) 10초 뒤에 다시 시도해 주세요.');
    } else {
      showToast('졸업 실패: 요청 처리에 실패했어요. 잠시 후 다시 시도해 주세요.');
    }
    throw error;
  }
}

async function saveDiaryAndEvolve() {
  if (getAiCooldownRemainingMs() > 0) {
    syncAICooldownUI();
    return;
  }
  
  const saveBtn = getEl('save-diary-btn');
  const diaryInput = getEl('diary-input');
  const diaryContent = clipText(diaryInput?.value || '', 2000);

  if (!diaryContent) {
    showToast('일기를 먼저 작성해 주세요!');
    return;
  }

  try {
    if (saveBtn) saveBtn.disabled = true;

    const targetDbId = currentDbId;
    const targetKoongyaName = currentKoongyaName;

    if (currentStep === 5) {
      console.log('[Evolve] 졸업 프로세스 시작');
      await processGraduation(diaryContent);
    } else {
      showToast('일기 저장 완료! 쿵야가 일기를 읽으며 진화 중입니다...');

      const nextStep = currentStep + 1;
      console.log('[Evolve] AI 진화 메시지 생성 중...');
      const result = await generateContentWithFallback(
        `사용자가 방금 너와의 대화를 마친 후 아래와 같은 [최신 회고록]을 남겼어. 이 회고록의 핵심을 1~2문장으로 코멘트하고, 생각 확장 질문 1개를 함께 제시해 줘.\n\n[최신 회고록]\n"${clipText(diaryContent, AI_LIMITS.MAX_DIARY_CHARS)}"`,
        buildChatGuide()
      );
      const aiGreeting = result.response.text();
      console.log('[Evolve] AI 진화 메시지 완료');

      await supabase.from('active_koongyas').update({ current_step: nextStep, diary_content: diaryContent }).eq('id', targetDbId);
      await saveChatLog(targetDbId, 'ai', aiGreeting);
      
      // UI 즉시 업데이트
      currentStep = nextStep;
      const newImgPath = getKoongyaImagePath(currentKoongyaId, currentStep);
      getEl('chat-koongya-img').src = newImgPath;
      getEl('chat-koongya-step').innerText = currentStep;
      
      retrospectiveCache = { koongyaId: null, content: null };
      showToast(`🎉 ${targetKoongyaName} 쿵야가 ${nextStep}단계로 진화했습니다!`);

      // 회고 모드 종료 및 대화창 갱신
      toggleChatMode('chat');
      await Promise.all([loadActiveKoongyas(), loadChatHistory(targetDbId)]);
    }
  } catch (error) {
    console.error('[Evolve] 에러 발생:', error);
    if (parseCooldownSeconds(error) > 0) syncAICooldownUI();
    const errMsg = error.message === 'TIMEOUT' ? '서버 응답 시간이 초과되었습니다.' : '진화 처리 중 오류가 발생했습니다.';
    showToast(errMsg);
  } finally {
    if (saveBtn && getAiCooldownRemainingMs() <= 0) saveBtn.disabled = false;
  }
}

async function loadArchives() {
  if (!currentUser) return;
  const list = getEl('archive-list');
  list.innerHTML = '<p>추억을 불러오는 중...</p>';
  try {
    const { data, error } = await supabase.from('archives').select('*').eq('user_id', currentUser.id).order('graduated_at', { ascending: false });
    if (error) throw error;
    list.innerHTML = '';
    if (!data || data.length === 0) {
      list.innerHTML = '<p>기록이 없어요.</p>';
      return;
    }
    data.forEach((item) => {
      const koongyaData = getKoongyaById(item.koongya_type);
      const imagePath = item.image_path || getKoongyaImagePath(item.koongya_type, 5);
      list.innerHTML += `
                <div class="archive-item">
                    <div class="polaroid">
                        <div class="polaroid-image"><img src="${imagePath}" alt="${koongyaData ? koongyaData.name : item.koongya_type} 쿵야" onerror="this.src='${getKoongyaImagePath(item.koongya_type, 5)}'"></div>
                        <div class="polaroid-caption">
                            <p class="archive-question">"${item.core_question}"</p>
                            <span>${koongyaData ? koongyaData.name : item.koongya_type} - ${new Date(item.graduated_at).toLocaleDateString()}</span>
                            <div class="archive-diary hidden" style="font-size:0.85rem; background:#f0f0f0; padding:15px; border-radius:10px; margin:15px 0; text-align: left; white-space: pre-wrap; line-height: 1.5; color: #333; box-shadow: inset 0 2px 4px rgba(0,0,0,0.05);">${item.final_diary || '기록 없음'}</div>
                            <button class="view-diary-btn" style="margin-top:10px; padding:6px 12px; font-size:0.8rem; background-color: #8bc34a; color: white; border: none; border-radius: 5px; cursor: pointer; font-family: 'NeoDunggeunmo', 'Galmuri11', sans-serif;" onclick="this.previousElementSibling.classList.toggle('hidden')">마지막 일기 보기</button>
                        </div>
                    </div>
                </div>`;
    });
  } catch (err) {
    list.innerHTML = '<p>로드 실패</p>';
  }
}

async function initApp() {
  const bindClick = (id, fn) => {
    const el = getEl(id);
    if (el) el.onclick = fn;
  };
  const bindKey = (id, fn) => {
    const el = getEl(id);
    if (el) el.onkeypress = fn;
  };

  bindClick('email-login-btn', handleEmailLogin);
  bindClick('logout-btn', handleLogout);
  bindClick('send-btn', handleSendMessage);
  
  const chatInput = getEl('chat-input');
  if (chatInput) {
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    });
  }

  bindClick('back-to-garden-btn', () => switchView('garden'));
  bindClick('save-diary-btn', saveDiaryAndEvolve);
  bindClick('close-retrospective', () => {
    toggleChatMode('chat');
  });
  bindClick('regenerate-insight-btn', () => {
    retrospectiveCache = { koongyaId: null, content: null };
    generateRetrospectiveDraft();
  });
  bindClick('close-graduation-modal', () => {
    const m = getEl('graduation-modal');
    if (m) m.classList.add('hidden');
  });
  bindClick('archive-btn', () => {
    const p = getEl('archive-panel');
    if (p) {
      p.classList.remove('hidden');
      loadArchives();
    }
  });
  bindClick('close-archive', () => {
    const p = getEl('archive-panel');
    if (p) p.classList.add('hidden');
  });
  bindClick('guide-btn', () => {
    const m = getEl('guide-modal');
    if (m) m.classList.remove('hidden');
  });
  bindClick('close-guide-btn', () => {
    const m = getEl('guide-modal');
    if (m) m.classList.add('hidden');
  });
  bindClick('retrospective-btn', openRetrospective);

  bindKey('chat-input', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSendMessage();
    }
  });
  syncAICooldownUI();
  bindKey('password-input', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleEmailLogin();
    }
  });

  document.body.addEventListener('click', (e) => {
    try {
      const cell = e.target.closest('.cell');
      if (!cell) return;
      selectedCellIndex = cell.getAttribute('data-index');
      if (cell.classList.contains('empty')) {
        openSeedPopup();
      } else {
        openChatPanel(cell);
      }
    } catch (err) {
      console.error('클릭 이벤트 에러:', err);
    }
  });

  const {
    data: { session }
  } = await supabase.auth.getSession();
  if (session) {
    await updateUIForAuth(session);
  } else {
    await updateUIForAuth(null);
  }

  supabase.auth.onAuthStateChange(async (event, sessionValue) => {
    console.log('[Auth Event]', event);
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') {
      await updateUIForAuth(sessionValue);
    } else if (event === 'SIGNED_OUT') {
      await updateUIForAuth(null);
    }
  });

  setTimeout(() => {
    const welcome = getEl('welcome-message');
    if (welcome) welcome.remove();
  }, 8000);
  setTimeout(hideLoadingOverlay, 5000);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initApp);
else initApp();
