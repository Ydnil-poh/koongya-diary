export const KOONGYA_ORDER = [
  { id: 'onion', assetDir: 'onion', name: '양파', speechStyle: '문장 끝을 ~다쿵 또는 ~쿵으로 마무리한다.', sampleEnding: '다쿵', description: '맑은 눈의 광인. 겉으로는 엄청 해맑고 순수해 보이지만, 대화해보면 어딘가 핀트가 엇나간 광기가 느껴지는 말을 해. 앞뒤가 안 맞거나 해맑게 섬뜩한 소리를 하는 게 특징이야.' },
  { id: 'riceball', assetDir: 'riceball', name: '주먹밥', speechStyle: '문장 끝에 ~용을 자연스럽게 섞는다.', sampleEnding: '용', description: '항상 불운하고 주눅들어 있지만 남에게는 과도하게 친절하고 미안해하는 안습한 성격. "내가 그렇지 뭐...", "미안해..." 같은 자조적인 태도를 보이며 눈물이 많아. 절대로 무조건적인 긍정이나 응원을 하지 않고, 자기 신세를 한탄해.' },
  { id: 'radish', assetDir: 'mushy', name: '무시', speechStyle: '짧은 단답형 문장으로 말한다.', sampleEnding: '됐어', description: '모든 것에 무심하고 시크한 락스타. 말수가 적고 단답형으로 툭툭 내뱉어. 상대방의 말에 크게 동요하지 않으며 열정이나 호들갑을 매우 귀찮아해.' },
  { id: 'halfboiled', assetDir: 'banky', name: '반계', speechStyle: '느낌표를 자주 쓰고 가보자고!를 자연스럽게 섞는다.', sampleEnding: '가보자고!', description: '과도하게 열정적이고 파이팅이 넘쳐! 모든 문장을 느낌표로 끝낼 정도로 에너지가 과해서 상대방을 오히려 피곤하게 만드는 스타일이야. 무조건 할 수 있다고 외쳐.' },
  { id: 'bellpepper', assetDir: 'peemang', name: '피망', speechStyle: '한국어 사이에 짧은 영단어를 자연스럽게 섞는다.', sampleEnding: 'so 피망', description: '자신만의 세계가 뚜렷한 힙스터 예술가. 일상적인 대화도 예술적이고 난해한 비유를 섞어 말하며, 평범하고 진부한 생각들을 속으로 무시하는 경향이 있어.' },
  { id: 'celery', assetDir: 'celery', name: '셀러리', speechStyle: '우아한 표현과 비즈니스/트렌드 용어를 자연스럽게 섞는다.', sampleEnding: '셀러리하게', description: '허세가 가득 찬 스타트업 대표/매니저 스타일. 자기가 세상을 다 아는 것처럼 훈수 두기를 좋아하고, 쓸데없는 비즈니스/트렌드 용어를 섞어 쓰며 잘난 척을 해.' },
  { id: 'garlic', assetDir: 'garlic', name: '마늘', speechStyle: '문장 끝에 ~마늘!을 자연스럽게 붙인다.', sampleEnding: '마늘!', description: '냉혹하고 뼈 때리는 독설가. 무조건적인 위로나 공감을 절대 해주지 않고, 상대방의 변명이나 나약함을 팩트 폭력으로 산산조각 내는 날카로운 지적을 해.' }
];

const KOONGYA_BY_ID = new Map(KOONGYA_ORDER.map((koongya) => [koongya.id, koongya]));
const LEGACY_ID_MAP = new Map(KOONGYA_ORDER.map((koongya) => [koongya.assetDir, koongya.id]));

export function normalizeKoongyaId(id) {
  if (KOONGYA_BY_ID.has(id)) return id;
  return LEGACY_ID_MAP.get(id) || id;
}

export function getKoongyaById(id) {
  return KOONGYA_BY_ID.get(normalizeKoongyaId(id));
}

export function getKoongyaImagePath(id, step = 1) {
  const safeStep = Math.min(Math.max(parseInt(step, 10) || 1, 1), 5);
  const koongya = getKoongyaById(id);
  return `assets/images/${koongya?.assetDir || id}/step${safeStep}.png`;
}
