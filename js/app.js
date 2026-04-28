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
    // [최적화] 브라우저 캐시(localStorage)에 키가 있으면 즉시 꺼내서 0초 만에 세팅 (Stale-while-revalidate 패턴)
    const cachedConfig = localStorage.getItem('koongya_config');
    if (cachedConfig) {
        try {
            CONFIG = JSON.parse(cachedConfig);
            console.log("[System] 로컬 캐시에서 설정을 즉시 로드했습니다.");
            
            // 캐시를 믿고 백그라운드에서 조용히 최신 키를 다시 받아와서 업데이트
            fetch('/api/config').then(res => res.json()).then(serverConfig => {
                if (serverConfig.SUPABASE_URL) localStorage.setItem('koongya_config', JSON.stringify(serverConfig));
            }).catch(() => {});
            return;
        } catch(e) {}
    }

    try {
        // 1. 캐시가 없는 최초 접속 시에만 배포 서버(Vercel)를 기다림 (1~2초 지연 발생)
        const response = await fetch('/api/config');
        if (response.ok) {
            const serverConfig = await response.json();
            if (serverConfig.SUPABASE_URL) {
                CONFIG = serverConfig;
                localStorage.setItem('koongya_config', JSON.stringify(serverConfig)); // 다음 접속을 위해 캐싱
                console.log("[System] 서버 보안 설정을 로드했습니다.");
                return;
            }
        }
    } catch (e) {
        console.log("[System] 서버 API 응답 없음. 로컬 모드로 진행합니다.");
    }

    try {
        // 2. 로컬 테스트 환경용
        const module = await import('./config.js');
        if (module.CONFIG) {
            CONFIG = module.CONFIG;
            localStorage.setItem('koongya_config', JSON.stringify(CONFIG));
        }
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
const GEMINI_MODELS = ["gemini-3-flash-preview", "gemini-3.1-flash-lite-preview", "gemini-2.5-flash"];

// [추가] 폴백(Fallback) 헬퍼 함수
async function generateContentWithFallback(prompt) {
    let lastError = null;
    for (const modelName of GEMINI_MODELS) {
        try {
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent(prompt);
            return result; // 성공 시 즉시 반환
        } catch (error) {
            console.warn(`[AI 폴백] ${modelName} 호출 실패. 다음 모델 시도 중...`, error.message);
            lastError = error;

// [핵심 개선] 한도 초과(429) 에러면 다른 모델을 찔러도 어차피 실패하므로 즉시 중단
            if (error.status === 429 || error.message.includes("429") || error.message.includes("quota")) {
                console.warn("[System] API 요청 한도 초과. 폴백을 중단합니다.");
                break; 
            }
        }
    }
    throw lastError || new Error("모든 AI 모델 호출에 실패했습니다.");
}

// ========================================== 
// 2. 전역 상태 및 DOM 요소 선언 
// ========================================== 
const KOONGYA_ORDER = [
    { id: 'onion', name: '양파', description: '맑은 눈의 광인. 겉으로는 엄청 해맑고 순수해 보이지만, 대화해보면 어딘가 핀트가 엇나간 광기가 느껴지는 말을 해. 앞뒤가 안 맞거나 해맑게 섬뜩한 소리를 하는 게 특징이야.' },
    { id: 'riceball', name: '주먹밥', description: '항상 불운하고 주눅들어 있지만 남에게는 과도하게 친절하고 미안해하는 안습한 성격. "내가 그렇지 뭐...", "미안해..." 같은 자조적인 태도를 보이며 눈물이 많아. 절대로 무조건적인 긍정이나 응원을 하지 않고, 자기 신세를 한탄해.' },
    { id: 'radish', name: '무시', description: '모든 것에 무심하고 시크한 락스타. 말수가 적고 단답형으로 툭툭 내뱉어. 상대방의 말에 크게 동요하지 않으며 열정이나 호들갑을 매우 귀찮아해.' },
    { id: 'halfboiled', name: '반계', description: '과도하게 열정적이고 파이팅이 넘쳐! 모든 문장을 느낌표로 끝낼 정도로 에너지가 과해서 상대방을 오히려 피곤하게 만드는 스타일이야. 무조건 할 수 있다고 외쳐.' },
    { id: 'bellpepper', name: '피망', description: '자신만의 세계가 뚜렷한 힙스터 예술가. 일상적인 대화도 예술적이고 난해한 비유를 섞어 말하며, 평범하고 진부한 생각들을 속으로 무시하는 경향이 있어.' },
    { id: 'celery', name: '셀러리', description: '허세가 가득 찬 스타트업 대표/매니저 스타일. 자기가 세상을 다 아는 것처럼 훈수 두기를 좋아하고, 쓸데없는 비즈니스/트렌드 용어를 섞어 쓰며 잘난 척을 해.' },
    { id: 'garlic', name: '마늘', description: '냉혹하고 뼈 때리는 독설가. 무조건적인 위로나 공감을 절대 해주지 않고, 상대방의 변명이나 나약함을 팩트 폭력으로 산산조각 내는 날카로운 지적을 해.' }
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
    // 모든 셀 비우기
    cells.forEach(cell => { 
        cell.classList.add('empty'); 
        cell.classList.remove('has-koongya'); 
        cell.innerHTML = '';
        cell.removeAttribute('data-db-id');
    });

    data.forEach(item => {
        const cell = document.querySelector(`.cell[data-index="${item.cell_index}"]`);
        if (cell) {
            cell.classList.remove('empty'); 
            cell.classList.add('has-koongya');
            cell.setAttribute('data-koongya-id', item.koongya_type);
            cell.setAttribute('data-db-id', item.id); // 고유 ID 심기
            cell.setAttribute('data-step', item.current_step);
            cell.innerHTML = `<img src="assets/images/${item.koongya_type}/step${item.current_step}.png" class="koongya-sprite" loading="lazy">`;
        }
    });
}

async function updateUnlockedList() {
    if (!currentUser) return;
    try {
        // [버그 수정] 모든 기록이 아닌 '나(currentUser.id)'의 졸업 기록만 가져오도록 필터링 추가
        const { data } = await supabase.from('archives').select('koongya_type').eq('user_id', currentUser.id);
        console.log("[디버깅] 아카이브 해금 데이터:", data, "현재 유저:", currentUser.id);
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
        console.log("[디버깅] 최종 해금된 쿵야 리스트:", unlockedKoongyas);
    } catch (err) { console.error("해금 로드 에러:", err); showToast("해금 로드 실패"); }
}

async function updateUIForAuth(session) {
    const loginScreen = getEl('login-screen');
    const gardenContainer = document.querySelector('.garden-container');
    const archiveBtn = getEl('archive-btn');
    const topControls = getEl('top-controls');
    if (session) {
        currentUser = session.user;
        if (loginScreen) loginScreen.style.display = 'none';
        if (gardenContainer) { gardenContainer.style.display = 'block'; requestAnimationFrame(() => gardenContainer.classList.add('visible')); }
        if (topControls) topControls.classList.remove('hidden');
        else if (archiveBtn) archiveBtn.classList.remove('hidden');
        loadGardenFromLocal();
        await Promise.all([loadActiveKoongyas(), updateUnlockedList()]);
    } else {
        currentUser = null;
        if (loginScreen) { loginScreen.style.display = 'flex'; loginScreen.classList.remove('hidden'); }
        if (gardenContainer) { gardenContainer.classList.remove('visible'); gardenContainer.style.display = 'none'; }
        if (topControls) topControls.classList.add('hidden');
        else if (archiveBtn) archiveBtn.classList.add('hidden');
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
    if (!currentUser) {
        showToast("사용자 정보를 잃어버렸습니다. (새로고침 버그)");
        console.error("[디버깅] plantSeed 실행 시 currentUser가 null입니다!");
        return;
    }
    try {
        const { error } = await supabase.from('active_koongyas').insert([{ user_id: currentUser.id, koongya_type: koongyaType, cell_index: parseInt(selectedCellIndex), current_step: 1, diary_content: "" }]);
        if (error) throw error;
        await loadActiveKoongyas();
        getEl('seed-popup').classList.add('hidden');
        showToast(`${koongyaType} 쿵야를 심었습니다!`);
    } catch (error) { 
        showToast("심기 실패: " + (error.message || "오류 발생"));
        console.error("쿵야 심기 에러 상세:", error);
    }
}
window.plantSeed = plantSeed;

async function openChatPanel(cell) {
    try {
        const dbId = cell.getAttribute('data-db-id');
        // [수정] ID가 없으면 정원을 다시 로드하고 중단
        if (!dbId || dbId === "undefined") { 
            await loadActiveKoongyas(); 
            return; 
        }
        
        currentDbId = dbId;
        currentKoongyaId = cell.getAttribute('data-koongya-id');
        currentStep = parseInt(cell.getAttribute('data-step')) || 1;
        
        const koongyaData = KOONGYA_ORDER.find(k => k.id === currentKoongyaId);
        currentKoongyaName = koongyaData ? koongyaData.name : "쿵야";
        
        getEl('chat-koongya-name').innerText = currentKoongyaName;
        const chatLog = getEl('chat-log');
        
        // [수정] 대화창을 열 때 이전 데이터 잔상을 즉시 지움
        chatLog.innerHTML = "<p style='text-align:center; color:#999;'>불러오는 중...</p>"; 
        
        await loadChatHistory(currentDbId);
        updateRetroButtonVisibility().catch(e => console.error(e));
        getEl('chat-panel').classList.remove('hidden'); 
    } catch (err) { 
        console.error("채팅창 열기 에러:", err);
    }
}

async function updateRetroButtonVisibility() {
    const { count, error } = await supabase.from('chat_logs').select('*', { count: 'exact', head: true }).eq('koongya_id', currentDbId).eq('sender', 'user');
    const retroBtn = getEl('retrospective-btn');
    if (retroBtn && !error) {
        let requiredCount = 5; // 1단계: 누적 5번
        if (currentStep === 2) requiredCount = 8; // 누적 8번 (5+3)
        else if (currentStep === 3) requiredCount = 11; // 누적 11번 (8+3)
        else if (currentStep === 4) requiredCount = 14; // 누적 14번 (11+3)
        else if (currentStep === 5) requiredCount = 15; // 누적 15번 (14+1)
        
        if (count >= requiredCount) retroBtn.classList.remove('hidden');
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
    
    // [중요] 함수 실행 시점의 상태를 변수에 고정 (캡처)
    const targetDbId = currentDbId; 
    const targetKoongyaId = currentKoongyaId;
    const targetKoongyaName = currentKoongyaName;
    const sessionUser = currentUser;

    if (!chatInput || !chatLog || !sessionUser) {
        if (!sessionUser) showToast("로그인이 필요합니다.");
        return;
    }

    const message = chatInput.value.trim();
    if (!message) return;

    if (sendBtn) sendBtn.disabled = true;
    if (chatInput) chatInput.disabled = true;

    // 1. 유저 메시지 저장 및 화면 표시
    await saveChatLog(targetDbId, 'user', message);
    
    // 현재 내가 보고 있는 쿵야와 메시지를 보낸 쿵야가 같을 때만 화면에 표시
    if (currentDbId === targetDbId) {
        chatLog.innerHTML += `<div class="chat-bubble chat-bubble-user">${message}</div>`;
        chatLog.scrollTop = chatLog.scrollHeight;
        if (loadingUI) loadingUI.classList.remove('hidden');
    }
    
    chatInput.value = "";
    updateRetroButtonVisibility().catch(e => console.error(e));

    try {
        // 2. AI 응답을 위한 컨텍스트 준비 (고정된 targetDbId 사용)
        const { data: logs } = await supabase.from('chat_logs')
            .select('sender, message')
            .eq('koongya_id', targetDbId)
            .order('created_at', { ascending: true })
            .limit(10);

        let chatContext = "";
        if (logs && logs.length > 0) {
            chatContext = logs.map(l => `${l.sender === 'user' ? '사용자' : '쿵야'}: ${l.message}`).join("\n") + "\n";
        }
        
        const { data: koongyaDataDb } = await supabase.from('active_koongyas')
            .select('diary_content')
            .eq('id', targetDbId)
            .single();

        let diaryContext = "";
        if (koongyaDataDb && koongyaDataDb.diary_content) {
            diaryContext = `[사용자의 이전 일기 요약]\n"${koongyaDataDb.diary_content}"\n이 내용을 기억하고 공감하는 뉘앙스를 조금 섞어서 대화해.\n\n`;
        }
        
        const koongyaInfo = KOONGYA_ORDER.find(k => k.id === targetKoongyaId);
        const systemPrompt = `너는 ${targetKoongyaName} 쿵야야. 성격: ${koongyaInfo.description}. [절대 규칙] 1. 이모지 금지. 2. 마크다운(**, # 등) 금지. 3. 순수 텍스트만 사용. 4. ~쿵, ~야 등 쿵야체 사용.`;
        
        // 3. AI 응답 생성
        const result = await generateContentWithFallback(`${systemPrompt}\n\n${diaryContext}[이전 대화]\n${chatContext}\n[현재 대화]\n사용자: "${message}"\n쿵야:`);
        const responseText = result.response.text();

        // 4. AI 메시지 저장 (고정된 targetDbId 사용)
        await saveChatLog(targetDbId, 'ai', responseText);

        // 5. 화면 업데이트 (여전히 해당 쿵야 창을 열어두고 있을 때만)
        if (currentDbId === targetDbId) {
            if (loadingUI) loadingUI.classList.add('hidden');
            chatLog.innerHTML += `<div class="chat-bubble chat-bubble-ai">${responseText}</div>`;
            chatLog.scrollTop = chatLog.scrollHeight;
            updateRetroButtonVisibility().catch(e => console.error(e));
        } else {
            showToast(`${targetKoongyaName} 쿵야가 답장을 보냈어요!`);
        }
    } catch (error) { 
        if (currentDbId === targetDbId && loadingUI) loadingUI.classList.add('hidden'); 
        showToast("에러: " + (error.message || "알 수 없는 오류"));
    } finally { 
        // [개선 2] 응답이 끝나면 버튼과 입력창을 다시 열어줌
        if (sendBtn) sendBtn.disabled = false; 
        if (chatInput) {
            chatInput.disabled = false;
            // 사용자가 마우스를 다시 클릭할 필요 없이 바로 타자 칠 수 있게 포커스 이동
            chatInput.focus(); 
        }
    }
}

async function saveChatLog(dbId, sender, message) { 
    const { error } = await supabase.from('chat_logs').insert([{ koongya_id: dbId, sender, message }]); 
    if (error) {
        console.error("채팅 저장 에러:", error);
        showToast("채팅 저장 실패: " + error.message);
    }
}

async function generateAIInsight() {
    const aiKeywordsContainer = getEl('ai-keywords');
    const regenBtn = getEl('regenerate-insight-btn');
    if (!aiKeywordsContainer) return;
    if (regenBtn) regenBtn.disabled = true;
    aiKeywordsContainer.innerHTML = "<p>분석 중...</p>";
    try {
        const { data: logs } = await supabase.from('chat_logs').select('sender, message').eq('koongya_id', currentDbId).order('created_at', { ascending: true }).limit(10);
        const chatContext = logs.map(l => `${l.sender === 'user' ? '사용자' : '쿵야'}: ${l.message}`).join("\n");
        const koongyaDesc = KOONGYA_ORDER.find(k => k.id === currentKoongyaId).description;
        const systemPrompt = `너는 ${currentKoongyaName} 쿵야야. 성격: ${koongyaDesc}\n사용자와 나눈 대화를 바탕으로, 오늘 사용자의 기분이나 대화의 핵심을 너의 성격이 100% 묻어나는 말투로 2~3문장 짧게 코멘트해줘. 무조건적인 위로 말고 캐릭터 성격에 맞는 반응을 보여줘. [절대 규칙] 1. 마크다운(**, # 등) 금지. 2. 순수 텍스트만 사용. 3. ~쿵, ~야 등 쿵야체 사용.`;
        const result = await generateContentWithFallback(`${systemPrompt}\n\n[대화 기록]\n${chatContext}`);
        
        aiKeywordsContainer.innerHTML = `<div class="insight-box">${result.response.text().replace(/\n/g, '<br>')}</div>`;
    } catch (error) { 
        console.error("AI 회고 분석 에러:", error);
        if (error.message && error.message.includes("429")) {
            aiKeywordsContainer.innerHTML = "<p>분석 실패: AI가 잠시 생각할 시간이 필요해요 (1분 후 다시 시도해 주세요).</p>"; 
        } else {
            aiKeywordsContainer.innerHTML = "<p>분석 실패: " + (error.message || "오류") + "</p>"; 
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
        const koongyaDesc = KOONGYA_ORDER.find(k => k.id === currentKoongyaId).description;
        const prompt = `너는 ${currentKoongyaName} 쿵야야. 성격: ${koongyaDesc}\n사용자가 너와 나눈 대화와 마지막으로 작성한 일기를 읽고, 사용자가 앞으로 나아가기 위해 스스로 던져봐야 할 '핵심 질문 1개'를 너의 성격이 짙게 묻어나는 말투로 20자 이내로 짧게 작성해. 절대 이모지나 마크다운 금지. 순수 텍스트만 사용. ~쿵, ~야 체 사용.\n\n[대화내용]\n"${chatContext}"\n\n[일기]\n"${diaryContent}"`;
        const result = await generateContentWithFallback(prompt);
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
                            <span>${koongyaData ? koongyaData.name : item.koongya_type} - ${new Date(item.graduated_at).toLocaleDateString()}</span>
                            <div class="archive-diary hidden" style="font-size:0.85rem; background:#f0f0f0; padding:15px; border-radius:10px; margin:15px 0; text-align: left; white-space: pre-wrap; line-height: 1.5; color: #333; box-shadow: inset 0 2px 4px rgba(0,0,0,0.05);">${item.final_diary || "기록 없음"}</div>
                            <button class="view-diary-btn" style="margin-top:10px; padding:6px 12px; font-size:0.8rem; background-color: #8bc34a; color: white; border: none; border-radius: 5px; cursor: pointer; font-family: 'NeoDunggeunmo', 'Galmuri11', sans-serif;" onclick="this.previousElementSibling.classList.toggle('hidden')">마지막 일기 보기</button>
                        </div>
                    </div>
                </div>`;
        });
    } catch (err) { list.innerHTML = "<p>로드 실패</p>"; }
}

async function initApp() {
    const bindClick = (id, fn) => { const el = getEl(id); if (el) el.onclick = fn; };
    const bindKey = (id, fn) => { const el = getEl(id); if (el) el.onkeypress = fn; };

    // 버튼 이벤트 바인딩
    bindClick('email-login-btn', handleEmailLogin);
    bindClick('google-login-btn', handleGoogleLogin);
    bindClick('send-btn', handleSendMessage);
    bindClick('close-chat', () => { const p = getEl('chat-panel'); if(p) p.classList.add('hidden'); });
    bindClick('save-diary-btn', saveDiaryAndEvolve);
    bindClick('close-retrospective', () => { const p = getEl('retrospective-panel'); if(p) p.classList.add('hidden'); });
    bindClick('regenerate-insight-btn', generateAIInsight);
    bindClick('close-graduation-modal', () => { const m = getEl('graduation-modal'); if(m) m.classList.add('hidden'); });
    bindClick('archive-btn', () => { const p = getEl('archive-panel'); if(p) { p.classList.remove('hidden'); loadArchives(); } });
    bindClick('close-archive', () => { const p = getEl('archive-panel'); if(p) p.classList.add('hidden'); });
    bindClick('guide-btn', () => { const m = getEl('guide-modal'); if(m) m.classList.remove('hidden'); });
    bindClick('close-guide-btn', () => { const m = getEl('guide-modal'); if(m) m.classList.add('hidden'); });
    bindClick('retrospective-btn', openRetrospective);

    bindKey('chat-input', (e) => { if (e.key === 'Enter') { e.preventDefault(); handleSendMessage(); } });
    bindKey('password-input', (e) => { if (e.key === 'Enter') { e.preventDefault(); handleEmailLogin(); } });
    
    // 정원 클릭 이벤트 위임
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
            console.error("클릭 이벤트 에러:", err);
        }
    });

    // [개선] 새로고침 시 세션 즉시 확인
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        await updateUIForAuth(session);
    } else {
        await updateUIForAuth(null);
    }

    // 인증 상태 변화 감지
    supabase.auth.onAuthStateChange(async (event, session) => {
        console.log("[Auth Event]", event);
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') {
            await updateUIForAuth(session);
        } else if (event === 'SIGNED_OUT') {
            await updateUIForAuth(null);
        }
    });
    
    setTimeout(() => { const welcome = getEl('welcome-message'); if (welcome) welcome.remove(); }, 8000);
    setTimeout(hideLoadingOverlay, 5000);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initApp);
else initApp();