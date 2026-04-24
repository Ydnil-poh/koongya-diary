import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
import { GoogleGenerativeAI } from 'https://esm.run/@google/generative-ai';

// ==========================================
// 1. 설정 및 클라이언트 초기화 (동적 임포트)
// ==========================================
let CONFIG = {
    SUPABASE_URL: '',
    SUPABASE_ANON_KEY: '',
    GEMINI_API_KEY: ''
};

async function initializeConfig() {
    try {
        // 1. 먼저 배포 서버(Vercel)의 보안 API에 키를 물어봅니다.
        const response = await fetch('/api/config');
        if (response.ok) {
            const serverConfig = await response.json();
            // 서버에 실제 값이 들어있을 때만 교체
            if (serverConfig.SUPABASE_URL) {
                CONFIG = serverConfig;
                console.log("[System] 서버 보안 설정을 로드했습니다.");
                return;
            }
        }
    } catch (e) {
        console.log("[System] 서버 API 응답 없음. 로컬 모드로 진행합니다.");
    }

    try {
        // 2. 서버에 없으면 로컬의 config.js를 사용합니다.
        const module = await import('./config.js');
        if (module.CONFIG) CONFIG = module.CONFIG;
        console.log("[System] 로컬 설정 파일을 로드했습니다.");
    } catch (e) {
        console.error("[System] 설정을 불러올 수 없습니다. API 키를 확인해주세요.");
    }
}

await initializeConfig();

const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'koongya-diary-auth' }
});
const genAI = new GoogleGenerativeAI(CONFIG.GEMINI_API_KEY);
const GEMINI_MODEL = "gemini-3-flash-preview"; 

// ========================================== 
// 2. 전역 상태 및 DOM 요소 선언 
// ========================================== 
const KOONGYA_ORDER = [
    { id: 'onion', name: '양파', description: '맑은 눈의 광인' },
    { id: 'riceball', name: '주먹밥', description: '안습/친절' },
    { id: 'radish', name: '무시', description: '무심/락스타' },
    { id: 'halfboiled', name: '반계', description: '열정/긍정' },
    { id: 'bellpepper', name: '피망', description: '힙스터/예술가' },
    { id: 'celery', name: '셀러리', description: '허세 매니저' },
    { id: 'garlic', name: '마늘', description: '독설/최종 교정자' }
];

let currentUser = null;
let unlockedKoongyas = ['onion'];
let selectedCellIndex = null;
let currentDbId = null;
let currentKoongyaId = null;
let currentStep = 1;
let currentKoongyaName = "";

function getEl(id) { return document.getElementById(id); }

function showToast(message) {
    const container = getEl('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerText = message;
    container.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 3000);
}

function hideLoadingOverlay() {
    const overlay = getEl('loading-overlay');
    if (overlay && overlay.style.display !== 'none') {
        overlay.style.display = 'none';
        console.log("[Performance] 로딩 완료");
    }
}

function saveGardenToLocal(data) { localStorage.setItem('cached_garden', JSON.stringify(data)); }
function loadGardenFromLocal() {
    const cached = localStorage.getItem('cached_garden');
    if (cached) {
        const data = JSON.parse(cached);
        renderGarden(data);
        hideLoadingOverlay();
    }
}

function renderGarden(data) {
    const cells = document.querySelectorAll('.cell');
    cells.forEach(cell => { cell.classList.add('empty'); cell.classList.remove('has-koongya'); cell.innerHTML = ''; });
    data.forEach(item => {
        const cell = document.querySelector(`.cell[data-index="${item.cell_index}"]`);
        if (cell) {
            cell.classList.remove('empty'); cell.classList.add('has-koongya');
            cell.setAttribute('data-koongya-id', item.koongya_type);
            cell.setAttribute('data-step', item.current_step);
            cell.setAttribute('data-db-id', item.id);
            cell.innerHTML = `<img src="assets/images/${item.koongya_type}/step${item.current_step}.png" class="koongya-sprite" loading="lazy">`;
        }
    });
}

async function updateUnlockedList() {
    if (!currentUser) return;
    try {
        const { data } = await supabase.from('archives').select('koongya_type');
        const graduatedIds = data ? data.map(item => item.koongya_type) : [];
        let newUnlocked = ['onion'];
        KOONGYA_ORDER.forEach((koongya, index) => {
            if (graduatedIds.includes(koongya.id)) {
                if (index + 1 < KOONGYA_ORDER.length) {
                    const nextKoongya = KOONGYA_ORDER[index + 1];
                    if (!newUnlocked.includes(nextKoongya.id)) newUnlocked.push(nextKoongya.id);
                }
            }
        });
        unlockedKoongyas = newUnlocked;
    } catch (err) { console.error("해금 로드 에러:", err); }
}

async function updateUIForAuth(session) {
    const loginScreen = getEl('login-screen');
    const gardenContainer = document.querySelector('.garden-container');
    const archiveBtn = getEl('archive-btn');
    if (session) {
        currentUser = session.user;
        if (loginScreen) loginScreen.style.display = 'none';
        if (gardenContainer) { gardenContainer.style.display = 'block'; requestAnimationFrame(() => gardenContainer.classList.add('visible')); }
        if (archiveBtn) archiveBtn.classList.remove('hidden');
        setupGardenEventListeners();
        loadGardenFromLocal();
        await Promise.all([loadActiveKoongyas(), updateUnlockedList()]);
    } else {
        currentUser = null;
        if (loginScreen) { loginScreen.style.display = 'flex'; loginScreen.classList.remove('hidden'); }
        if (gardenContainer) { gardenContainer.classList.remove('visible'); gardenContainer.style.display = 'none'; }
        if (archiveBtn) archiveBtn.classList.add('hidden');
        hideLoadingOverlay();
    }
}

async function handleEmailLogin() {
    const email = getEl('email-input').value;
    const password = getEl('password-input').value;
    if (!email || !password) { showToast("입력해주세요!"); return; }
    
    // 1. 먼저 로그인을 시도합니다.
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    
    if (signInError) {
        // 2. 만약 계정이 없다면(Invalid login credentials), 가입을 시도합니다.
        if (signInError.message.includes("Invalid login credentials") || signInError.status === 400) {
            console.log("[Auth] 계정이 없어 회원가입을 시도합니다.");
            const { error: signUpError } = await supabase.auth.signUp({ email, password });
            if (signUpError) {
                showToast("실패: " + signUpError.message);
                return;
            }
            showToast("가입 완료! 자동으로 로그인 중...");
            // 가입 후 바로 로그인 시도
            await supabase.auth.signInWithPassword({ email, password });
        } else {
            showToast("로그인 실패: " + signInError.message);
        }
    }
}

async function handleGoogleLogin() {
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
}

function setupGardenEventListeners() {
    const gridContainer = getEl('grid-container');
    if (!gridContainer || gridContainer.dataset.listenersSet) return;
    gridContainer.onclick = (e) => {
        const cell = e.target.closest('.cell');
        if (!cell) return;
        selectedCellIndex = cell.getAttribute('data-index');
        if (cell.classList.contains('empty')) openSeedPopup();
        else openChatPanel(cell);
    };
    gridContainer.dataset.listenersSet = "true";
}

async function loadActiveKoongyas() {
    if (!currentUser) return;
    try {
        const { data, error } = await supabase.from('active_koongyas').select('id, cell_index, koongya_type, current_step').eq('user_id', currentUser.id);
        if (error) throw error;
        renderGarden(data);
        saveGardenToLocal(data);
    } catch (error) { console.error("로드 에러:", error); }
    finally { hideLoadingOverlay(); }
}

function openSeedPopup() {
    const popup = getEl('seed-popup');
    if (!popup) return;
    let popupHtml = '<h3>어떤 쿵야를 심을까요?</h3><div class="seed-list">';
    KOONGYA_ORDER.forEach((koongya) => {
        if (unlockedKoongyas.includes(koongya.id)) popupHtml += `<div class="seed-item unlocked" onclick="plantSeed('${koongya.id}')">🌱 ${koongya.name} 쿵야</div>`;
        else popupHtml += `<div class="seed-item locked" title="다른 쿵야를 졸업시키면 해금됩니다.">🔒 ???</div>`;
    });
    popupHtml += '</div><button id="close-popup" class="ui-button" style="margin-top: 15px;">닫기</button>';
    popup.innerHTML = popupHtml;
    popup.classList.remove('hidden');
    getEl('close-popup').onclick = () => popup.classList.add('hidden');
}

async function plantSeed(koongyaType) {
    if (!currentUser) return;
    try {
        const { error } = await supabase.from('active_koongyas').insert([{ user_id: currentUser.id, koongya_type: koongyaType, cell_index: parseInt(selectedCellIndex), current_step: 1, diary_content: "" }]);
        if (error) throw error;
        await loadActiveKoongyas();
        getEl('seed-popup').classList.add('hidden');
        showToast(`${koongyaType} 쿵야를 심었습니다!`);
    } catch (error) { showToast("오류 발생"); }
}
window.plantSeed = plantSeed;

async function openChatPanel(cell) {
    try {
        currentDbId = cell.getAttribute('data-db-id');
        currentKoongyaId = cell.getAttribute('data-koongya-id');
        currentStep = parseInt(cell.getAttribute('data-step')) || 1;
        if (!currentDbId) { await loadActiveKoongyas(); return; }
        const koongyaData = KOONGYA_ORDER.find(k => k.id === currentKoongyaId);
        currentKoongyaName = koongyaData ? koongyaData.name : "쿵야";
        updateRetroButtonVisibility().catch(e => console.error(e));
        getEl('chat-koongya-name').innerText = currentKoongyaName;
        const chatLog = getEl('chat-log');
        chatLog.innerHTML = "<p style='text-align:center; color:#999;'>불러오는 중...</p>"; 
        await loadChatHistory(currentDbId);
        getEl('chat-panel').classList.remove('hidden'); 
    } catch (err) { showToast("실패"); }
}

async function updateRetroButtonVisibility() {
    const { count } = await supabase.from('chat_logs').select('*', { count: 'exact', head: true }).eq('koongya_id', currentDbId).eq('sender', 'user');
    const retroBtn = getEl('retrospective-btn');
    if (retroBtn) {
        if (count >= 5) retroBtn.classList.remove('hidden');
        else retroBtn.classList.add('hidden');
    }
}

async function loadChatHistory(dbId) {
    const chatLog = getEl('chat-log');
    const { data } = await supabase.from('chat_logs').select('*').eq('koongya_id', dbId).order('created_at', { ascending: true }).limit(50);
    if (data) {
        chatLog.innerHTML = "";
        data.forEach(log => {
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
    if (!chatInput || !chatLog) return;
    const message = chatInput.value.trim();
    if (!message) return;
    if (sendBtn) sendBtn.disabled = true;
    await saveChatLog(currentDbId, 'user', message);
    chatLog.innerHTML += `<div class="chat-bubble chat-bubble-user">${message}</div>`;
    chatLog.scrollTop = chatLog.scrollHeight;
    chatInput.value = "";
    updateRetroButtonVisibility();
    if (loadingUI) loadingUI.classList.remove('hidden');
    try {
        const model = genAI.getGenerativeModel({ model: GEMINI_MODEL }); 
        const systemPrompt = `너는 ${currentKoongyaName} 쿵야야. 성격: ${KOONGYA_ORDER.find(k => k.id === currentKoongyaId).description}. [절대 규칙] 1. 이모지 금지. 2. 마크다운(**, # 등) 금지. 3. 순수 텍스트만 사용.`;
        const result = await model.generateContent(`${systemPrompt}\n\n사용자: "${message}"`);
        if (loadingUI) loadingUI.classList.add('hidden');
        const responseText = result.response.text();
        chatLog.innerHTML += `<div class="chat-bubble chat-bubble-ai">${responseText}</div>`;
        chatLog.scrollTop = chatLog.scrollHeight;
        await saveChatLog(currentDbId, 'ai', responseText);
    } catch (error) { 
        if (loadingUI) loadingUI.classList.add('hidden'); 
        showToast("에러: " + error.message);
    } finally { if (sendBtn) sendBtn.disabled = false; }
}

async function saveChatLog(dbId, sender, message) { await supabase.from('chat_logs').insert([{ koongya_id: dbId, sender, message }]); }

async function generateAIInsight() {
    const aiKeywordsContainer = getEl('ai-keywords');
    const regenBtn = getEl('regenerate-insight-btn');
    if (!aiKeywordsContainer) return;
    if (regenBtn) regenBtn.disabled = true;
    aiKeywordsContainer.innerHTML = "<p>분석 중...</p>";
    try {
        const { data: logs } = await supabase.from('chat_logs').select('sender, message').eq('koongya_id', currentDbId).order('created_at', { ascending: true }).limit(10);
        const chatContext = logs.map(l => `${l.sender === 'user' ? '사용자' : '쿵야'}: ${l.message}`).join("\n");
        const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
        const result = await model.generateContent(`다음 대화를 분석해줘. 마크다운 금지. 순수 텍스트로만 답변.\n\n${chatContext}`);
        aiKeywordsContainer.innerHTML = `<div class="insight-box">${result.response.text().replace(/\n/g, '<br>')}</div>`;
    } catch (error) { aiKeywordsContainer.innerHTML = "<p>실패</p>"; }
    finally { if (regenBtn) regenBtn.disabled = false; }
}

async function openRetrospective() {
    getEl('chat-panel').classList.add('hidden');
    getEl('retrospective-panel').classList.remove('hidden');
    generateAIInsight();
    const diaryInput = getEl('diary-input');
    diaryInput.value = "불러오는 중...";
    try {
        const { data } = await supabase.from('active_koongyas').select('diary_content').eq('id', currentDbId).single();
        diaryInput.value = data ? data.diary_content : "";
    } catch (err) { diaryInput.value = ""; }
}

async function processGraduation(diaryContent) {
    showToast("쿵야의 마지막 인사를 준비 중입니다...");
    try {
        const { data: logs } = await supabase.from('chat_logs').select('sender, message').eq('koongya_id', currentDbId).order('created_at', { ascending: true }).limit(15);
        const chatContext = logs.map(l => `${l.sender === 'user' ? '사용자' : '쿵야'}: ${l.message}`).join("\n");
        const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
        const prompt = `졸업 질문 1개. 마크다운 금지. 20자 이내. 대화내용: "${chatContext}"와 일기: "${diaryContent}" 참고.`;
        const result = await model.generateContent(prompt);
        const coreQuestion = result.response.text().replace(/"/g, '').trim();
        const imagePath = `assets/images/${currentKoongyaId}/step5.png`;
        const { error: archiveError } = await supabase.from('archives').insert([{ user_id: currentUser.id, koongya_type: currentKoongyaId, image_path: imagePath, core_question: coreQuestion, final_diary: diaryContent }]);
        if (archiveError) throw archiveError;
        await supabase.from('active_koongyas').delete().eq('id', currentDbId);
        getEl('grad-koongya-img').src = imagePath;
        getEl('grad-core-question').innerText = `"${coreQuestion}"`;
        getEl('grad-date').innerText = new Date().toLocaleDateString();
        getEl('graduation-modal').classList.remove('hidden');
        localStorage.removeItem('cached_garden');
        await Promise.all([loadActiveKoongyas(), updateUnlockedList()]);
    } catch (error) { showToast("졸업 실패: " + error.message); }
}

async function saveDiaryAndEvolve() {
    const saveBtn = getEl('save-diary-btn');
    const diaryContent = getEl('diary-input').value;
    if (!diaryContent) { showToast("입력해주세요!"); return; }
    if (saveBtn) saveBtn.disabled = true;
    try {
        if (currentStep === 5) {
            getEl('retrospective-panel').classList.add('hidden');
            await processGraduation(diaryContent);
        } else {
            const nextStep = currentStep + 1;
            await supabase.from('active_koongyas').update({ current_step: nextStep, diary_content: diaryContent }).eq('id', currentDbId);
            showToast("진화 성공!");
            getEl('retrospective-panel').classList.add('hidden');
            await loadActiveKoongyas();
        }
    } finally { if (saveBtn) saveBtn.disabled = false; }
}

async function loadArchives() {
    if (!currentUser) return;
    const list = getEl('archive-list');
    list.innerHTML = "<p>추억을 불러오는 중...</p>";
    try {
        const { data, error } = await supabase.from('archives').select('*').eq('user_id', currentUser.id).order('graduated_at', { ascending: false });
        if (error) throw error;
        list.innerHTML = "";
        if (!data || data.length === 0) { list.innerHTML = "<p>기록이 없어요.</p>"; return; }
        data.forEach(item => {
            const koongyaData = KOONGYA_ORDER.find(k => k.id === item.koongya_type);
            list.innerHTML += `
                <div class="archive-item">
                    <div class="polaroid">
                        <div class="polaroid-image"><img src="${item.image_path}" alt="${item.koongya_type}" onerror="this.src='https://via.placeholder.com/150'"></div>
                        <div class="polaroid-caption">
                            <p class="archive-question">"${item.core_question}"</p>
                            <div class="archive-diary hidden" style="font-size:0.8rem; background:#f0f0f0; padding:10px; border-radius:5px; margin:10px 0;">${item.final_diary || "기록 없음"}</div>
                            <span>${koongyaData ? koongyaData.name : item.koongya_type} - ${new Date(item.graduated_at).toLocaleDateString()}</span>
                            <button class="view-diary-btn" style="margin-top:10px; padding:4px 8px; font-size:0.7rem;" onclick="this.previousElementSibling.classList.toggle('hidden')">일기 보기/닫기</button>
                        </div>
                    </div>
                </div>`;
        });
    } catch (err) { list.innerHTML = "<p>로드 실패</p>"; }
}

async function initApp() {
    getEl('email-login-btn').onclick = handleEmailLogin;
    getEl('google-login-btn').onclick = handleGoogleLogin;
    getEl('send-btn').onclick = handleSendMessage;
    getEl('close-chat').onclick = () => getEl('chat-panel').classList.add('hidden');
    getEl('save-diary-btn').onclick = saveDiaryAndEvolve;
    getEl('close-retrospective').onclick = () => getEl('retrospective-panel').classList.add('hidden');
    getEl('regenerate-insight-btn').onclick = generateAIInsight;
    getEl('close-graduation-modal').onclick = () => getEl('graduation-modal').classList.add('hidden');
    getEl('archive-btn').onclick = () => { getEl('archive-panel').classList.remove('hidden'); loadArchives(); };
    getEl('close-archive').onclick = () => getEl('archive-panel').classList.add('hidden');
    getEl('chat-input').onkeypress = (e) => { if (e.key === 'Enter') { e.preventDefault(); handleSendMessage(); } };
    getEl('password-input').onkeypress = (e) => { if (e.key === 'Enter') { e.preventDefault(); handleEmailLogin(); } };
    getEl('retrospective-btn').onclick = openRetrospective;
    setTimeout(() => { const welcome = getEl('welcome-message'); if (welcome) welcome.remove(); }, 8000);
    setTimeout(hideLoadingOverlay, 5000);
    supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') await updateUIForAuth(session);
        else if (event === 'SIGNED_OUT') await updateUIForAuth(null);
    });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initApp);
else initApp();