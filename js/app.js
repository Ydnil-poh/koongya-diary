import { KOONGYA_ORDER } from './data/koongyas.js';
import { supabase, generateContentWithFallback } from './services/clients.js';
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
let insightCache = { koongyaId: null, content: null };

const AI_LIMITS = {
  CHAT_HISTORY_LIMIT: 6,
  RETRO_HISTORY_LIMIT: 6,
  GRAD_HISTORY_LIMIT: 8,
  MAX_MESSAGE_CHARS: 280,
  MAX_DIARY_CHARS: 500
};

function clipText(value, maxChars) {
  if (!value) return '';
  return value.length > maxChars ? `${value.slice(0, maxChars)}…` : value;
}

function buildChatContext(logs) {
  if (!logs || logs.length === 0) return '';
  return logs
    .map((log) => `${log.sender === 'user' ? '사용자' : '쿵야'}: ${clipText(log.message, AI_LIMITS.MAX_MESSAGE_CHARS)}`)
    .join('\n');
}

function buildPersonaGuide(koongyaName, koongyaDescription) {
  return `너는 ${koongyaName} 쿵야야. 성격 특징은 "${koongyaDescription}".
[대화 목표]
1) 사용자의 짧은 생각을 한 단계 확장해 긴 글감으로 발전시키는 데 도움을 줘.
2) 답변 끝에 생각을 확장할 수 있는 구체 질문 1개를 반드시 던져줘.
3) 캐릭터 말투는 은은하게 유지하되, 과장된 역할극은 피하고 코칭/피드백 품질을 우선해.
[형식 규칙]
- 마크다운 기호(**, #)는 쓰지 말고 순수 텍스트로 작성해.`;
}

async function updateUnlockedList() {
  if (!currentUser) return;
  try {
    const { data } = await supabase.from('archives').select('koongya_type').eq('user_id', currentUser.id);
    console.log('[디버깅] 아카이브 해금 데이터:', data, '현재 유저:', currentUser.id);
    const graduatedIds = data ? data.map((item) => item.koongya_type) : [];
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

async function handleGoogleLogin() {
  await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
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
  KOONGYA_ORDER.forEach((koongya) => {
    if (unlockedKoongyas.includes(koongya.id)) popupHtml += `<div class="seed-item unlocked" onclick="plantSeed('${koongya.id}')">🌱 ${koongya.name} 쿵야</div>`;
    else popupHtml += '<div class="seed-item locked" title="다른 쿵야를 졸업시키면 해금됩니다.">🔒 ???</div>';
  });
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

    const koongyaData = KOONGYA_ORDER.find((k) => k.id === currentKoongyaId);
    currentKoongyaName = koongyaData ? koongyaData.name : '쿵야';

    getEl('chat-koongya-name').innerText = currentKoongyaName;
    const chatLog = getEl('chat-log');
    chatLog.innerHTML = "<p style='text-align:center; color:#999;'>불러오는 중...</p>";

    await loadChatHistory(currentDbId);
    updateRetroButtonVisibility().catch((e) => console.error(e));
    getEl('chat-panel').classList.remove('hidden');
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
      const bubbleClass = log.sender === 'user' ? 'chat-bubble-user' : 'chat-bubble-ai';
      chatLog.innerHTML += `<div class="chat-bubble ${bubbleClass}">${log.message}</div>`;
    });
    chatLog.scrollTop = chatLog.scrollHeight;
  }
}

async function handleSendMessage() {
  const chatInput = getEl('chat-input');
  const chatLog = getEl('chat-log');
  const loadingUI = getEl('chat-loading');
  const sendBtn = getEl('send-btn');

  const targetDbId = currentDbId;
  const targetKoongyaId = currentKoongyaId;
  const targetKoongyaName = currentKoongyaName;
  const sessionUser = currentUser;

  if (!chatInput || !chatLog || !sessionUser) {
    if (!sessionUser) showToast('로그인이 필요합니다.');
    return;
  }

  const message = clipText(chatInput.value.trim(), AI_LIMITS.MAX_MESSAGE_CHARS);
  if (!message) return;

  if (sendBtn) sendBtn.disabled = true;
  if (chatInput) chatInput.disabled = true;

  await saveChatLog(targetDbId, 'user', message);
  insightCache = { koongyaId: null, content: null };

  if (currentDbId === targetDbId) {
    chatLog.innerHTML += `<div class="chat-bubble chat-bubble-user">${message}</div>`;
    chatLog.scrollTop = chatLog.scrollHeight;
    if (loadingUI) loadingUI.classList.remove('hidden');
  }

  chatInput.value = '';
  updateRetroButtonVisibility().catch((e) => console.error(e));

  try {
    const { data: logs } = await supabase
      .from('chat_logs')
      .select('sender, message')
      .eq('koongya_id', targetDbId)
      .order('created_at', { ascending: false })
      .limit(AI_LIMITS.CHAT_HISTORY_LIMIT);
    const chatContext = buildChatContext((logs || []).reverse());

    const { data: koongyaDataDb } = await supabase.from('active_koongyas').select('diary_content').eq('id', targetDbId).single();

    let diaryContext = '';
    if (koongyaDataDb && koongyaDataDb.diary_content) {
      diaryContext = `[사용자의 이전 일기 요약]\n"${clipText(koongyaDataDb.diary_content, AI_LIMITS.MAX_DIARY_CHARS)}"\n이 내용을 기억하고 공감하는 뉘앙스를 조금 섞어서 대화해.\n\n`;
    }

    const koongyaInfo = KOONGYA_ORDER.find((k) => k.id === targetKoongyaId);
    const systemPrompt = buildPersonaGuide(targetKoongyaName, koongyaInfo.description);

    const result = await generateContentWithFallback(`${systemPrompt}\n\n${diaryContext}[최근 대화]\n${chatContext}\n[현재 대화]\n사용자: "${message}"\n쿵야:`);
    const responseText = result.response.text();

    await saveChatLog(targetDbId, 'ai', responseText);

    if (currentDbId === targetDbId) {
      if (loadingUI) loadingUI.classList.add('hidden');
      chatLog.innerHTML += `<div class="chat-bubble chat-bubble-ai">${responseText}</div>`;
      chatLog.scrollTop = chatLog.scrollHeight;
      updateRetroButtonVisibility().catch((e) => console.error(e));
    } else {
      showToast(`${targetKoongyaName} 쿵야가 답장을 보냈어요!`);
    }
  } catch (error) {
    if (currentDbId === targetDbId && loadingUI) loadingUI.classList.add('hidden');
    showToast('에러: ' + (error.message || '알 수 없는 오류'));
  } finally {
    if (sendBtn) sendBtn.disabled = false;
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

async function generateAIInsight() {
  const aiKeywordsContainer = getEl('ai-keywords');
  const regenBtn = getEl('regenerate-insight-btn');
  if (!aiKeywordsContainer) return;
  if (regenBtn) regenBtn.disabled = true;
  if (insightCache.koongyaId === currentDbId && insightCache.content) {
    aiKeywordsContainer.innerHTML = `<div class="insight-box">${insightCache.content.replace(/\n/g, '<br>')}</div>`;
    return;
  }
  aiKeywordsContainer.innerHTML = '<p>분석 중...</p>';
  try {
    const { data: logs } = await supabase
      .from('chat_logs')
      .select('sender, message')
      .eq('koongya_id', currentDbId)
      .order('created_at', { ascending: false })
      .limit(AI_LIMITS.RETRO_HISTORY_LIMIT);
    const chatContext = buildChatContext((logs || []).reverse());
    const koongyaDesc = KOONGYA_ORDER.find((k) => k.id === currentKoongyaId).description;
    const systemPrompt = buildPersonaGuide(currentKoongyaName, koongyaDesc);
    const result = await generateContentWithFallback(
      `${systemPrompt}\n\n[대화 기록]\n${chatContext}\n\n[요청]\n대화를 바탕으로 2~3문장 코멘트 + 글감을 확장할 질문 1개를 제시해줘.`
    );
    const insightText = result.response.text();
    insightCache = { koongyaId: currentDbId, content: insightText };
    aiKeywordsContainer.innerHTML = `<div class="insight-box">${insightText.replace(/\n/g, '<br>')}</div>`;
  } catch (error) {
    console.error('AI 회고 분석 에러:', error);
    if (error.message && error.message.includes('429')) {
      aiKeywordsContainer.innerHTML = '<p>분석 실패: AI가 잠시 생각할 시간이 필요해요 (1분 후 다시 시도해 주세요).</p>';
    } else {
      aiKeywordsContainer.innerHTML = '<p>분석 실패: ' + (error.message || '오류') + '</p>';
    }
  } finally {
    if (regenBtn) regenBtn.disabled = false;
  }
}

async function openRetrospective() {
  getEl('chat-panel').classList.add('hidden');
  getEl('retrospective-panel').classList.remove('hidden');
  generateAIInsight();
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
  const retroPanel = getEl('retrospective-panel');
  showToast('🎓 쿵야가 마지막 인사를 준비하고 있어요. 잠시만 기다려주세요!');

  try {
    const { data: logs } = await supabase
      .from('chat_logs')
      .select('sender, message')
      .eq('koongya_id', currentDbId)
      .order('created_at', { ascending: false })
      .limit(AI_LIMITS.GRAD_HISTORY_LIMIT);
    const chatContext = buildChatContext((logs || []).reverse());
    const koongyaDesc = KOONGYA_ORDER.find((k) => k.id === currentKoongyaId).description;
    const safeDiary = clipText(diaryContent, AI_LIMITS.MAX_DIARY_CHARS);

    const prompt = `${buildPersonaGuide(currentKoongyaName, koongyaDesc)}\n사용자가 너와 나눈 최근 대화와 마지막 일기를 바탕으로, 다음 글을 더 길고 깊게 쓸 수 있게 돕는 '핵심 확장 질문 1개'를 30자 이내로 작성해.\n\n[최근 대화내용]\n"${chatContext}"\n\n[일기]\n"${safeDiary}"`;

    const result = await generateContentWithFallback(prompt);
    const coreQuestion = result.response.text().replace(/"/g, '').trim();
    const imagePath = `assets/images/${currentKoongyaId}/step5.png`;

    const { error: archiveError } = await supabase.from('archives').insert([{ user_id: currentUser.id, koongya_type: currentKoongyaId, image_path: imagePath, core_question: coreQuestion, final_diary: diaryContent }]);
    if (archiveError) throw archiveError;

    await supabase.from('active_koongyas').delete().eq('id', currentDbId);

    if (retroPanel) retroPanel.classList.add('hidden');

    getEl('grad-koongya-img').src = imagePath;
    getEl('grad-core-question').innerText = `"${coreQuestion}"`;
    getEl('grad-date').innerText = new Date().toLocaleDateString();
    getEl('graduation-modal').classList.remove('hidden');

    localStorage.removeItem('cached_garden');
    await Promise.all([loadActiveKoongyas(), updateUnlockedList()]);
  } catch (error) {
    console.error('졸업 에러:', error);
    if (error.message && error.message.includes('503')) {
      showToast('앗, 쿵야가 눈물을 닦느라 늦어지네요! (서버 지연) 10초 뒤에 다시 시도해 주세요.');
    } else {
      showToast('졸업 실패: ' + (error.message || '알 수 없는 오류'));
    }
    throw error;
  }
}

async function saveDiaryAndEvolve() {
  const saveBtn = getEl('save-diary-btn');
  const diaryContent = clipText(getEl('diary-input').value, 2000);
  const retroPanel = getEl('retrospective-panel');

  if (!diaryContent) {
    showToast('일기를 먼저 작성해 주세요!');
    return;
  }
  if (saveBtn) saveBtn.disabled = true;

  const targetDbId = currentDbId;
  const targetKoongyaId = currentKoongyaId;
  const targetKoongyaName = currentKoongyaName;

  try {
    if (currentStep === 5) {
      await processGraduation(diaryContent);
    } else {
      if (retroPanel) retroPanel.classList.add('hidden');
      showToast('일기 저장 완료! 쿵야가 일기를 읽으며 진화 중입니다...');

      const nextStep = currentStep + 1;
      const koongyaDesc = KOONGYA_ORDER.find((k) => k.id === targetKoongyaId).description;

      const prompt = `${buildPersonaGuide(targetKoongyaName, koongyaDesc)}
사용자가 방금 너와의 대화를 마친 후 아래와 같은 [최신 회고록]을 남겼어.

[최신 회고록]
"${clipText(diaryContent, AI_LIMITS.MAX_DIARY_CHARS)}"

이 회고록의 핵심을 1~2문장으로 코멘트하고, 다음 회고를 더 길게 쓸 수 있도록 생각 확장 질문 1개를 함께 제시해 줘.`;

      const result = await generateContentWithFallback(prompt);
      const aiGreeting = result.response.text();

      await supabase.from('active_koongyas').update({ current_step: nextStep, diary_content: diaryContent }).eq('id', targetDbId);

      await saveChatLog(targetDbId, 'ai', aiGreeting);
      insightCache = { koongyaId: null, content: null };

      showToast(`🎉 ${targetKoongyaName} 쿵야가 ${nextStep}단계로 진화했습니다!`);

      await loadActiveKoongyas();
    }
  } catch (error) {
    console.error('진화 에러:', error);

    if (currentStep !== 5 && retroPanel) {
      retroPanel.classList.remove('hidden');
    }

    if (error.message && error.message.includes('503')) {
      showToast('앗! 서버가 잠시 혼잡해요. (10초 뒤 버튼을 다시 눌러주세요)');
    } else {
      showToast('진화 중 오류가 발생했어요.');
    }
  } finally {
    if (saveBtn) saveBtn.disabled = false;
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
      const koongyaData = KOONGYA_ORDER.find((k) => k.id === item.koongya_type);
      list.innerHTML += `
                <div class="archive-item">
                    <div class="polaroid">
                        <div class="polaroid-image"><img src="${item.image_path}" alt="${item.koongya_type}" onerror="this.src='https://via.placeholder.com/150'"></div>
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
  bindClick('google-login-btn', handleGoogleLogin);
  bindClick('send-btn', handleSendMessage);
  bindClick('close-chat', () => {
    const p = getEl('chat-panel');
    if (p) p.classList.add('hidden');
  });
  bindClick('save-diary-btn', saveDiaryAndEvolve);
  bindClick('close-retrospective', () => {
    const p = getEl('retrospective-panel');
    if (p) p.classList.add('hidden');
  });
  bindClick('regenerate-insight-btn', () => {
    insightCache = { koongyaId: null, content: null };
    generateAIInsight();
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
