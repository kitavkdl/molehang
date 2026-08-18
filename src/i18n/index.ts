/**
 * 한국어 / 영어.
 *
 * 기본은 한국어다. 브라우저 언어가 영어면 영어로 시작하고, 유저가 고르면 그게 우선한다.
 *
 * 규칙: **UI 문자열을 컴포넌트에 직접 쓰지 않는다.** 전부 여기 키로 넣는다.
 * 숫자·이름처럼 치환이 필요한 자리는 {n} 형태를 쓴다.
 */
export const LOCALES = ['ko', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

const STORE_KEY = 'molehang.locale';

type Dict = Record<string, string>;

const KO: Dict = {
  'app.title': '몰래항',

  // 자원
  'res.name': '고철',
  'res.perSecond': '초당 +{n}',
  'res.untilFull': '가득 차기까지 {t}',
  'res.full': '가득 찼어요 — 넘치기 전에 수거하세요',
  'res.collect': '수거',
  'res.collectSub': '{n} 담기',
  'res.collectIdle': '아직 모이는 중',

  // 배
  'ship.parts': '파츠 {n}',
  'ship.slots': '자리 {used}/{max}',
  'ship.slotsFull': '자리가 없어요',

  // 뽑기
  'gacha.title': '부품 뽑기',
  'gacha.small': '작은 부품',
  'gacha.medium': '중간 부품',
  'gacha.large': '대형 부품',
  'gacha.cost': '고철 {n}',
  'gacha.spin': '돌리기',
  'gacha.spinning': '돌리는 중…',
  'gacha.result': '{name} 획득!',
  'gacha.mustEquip': '나온 부품은 반드시 장착됩니다',
  'gacha.needRoom': '자리가 부족해요. 뺄 부품을 고르세요.',
  'gacha.cantAfford': '고철이 부족해요',
  'gacha.equip': '장착하기',
  'gacha.replace': '{name} 빼고 장착',

  // 기록 시트
  'sheet.title': '항해 기록',
  'sheet.statLifetime': '누적 고철',
  'sheet.statCollects': '수거',
  'sheet.statParts': '파츠',
  'sheet.sectionShip': '지금 이 배',
  'sheet.sectionCrew': '선단',
  'sheet.sectionTitles': '칭호',
  'sheet.sectionLog': '수거 기록',
  'sheet.condition': '달성 조건 · {hint}',
  'sheet.empty': '아직 수거한 적이 없어요.\n수업이 지루해질 때쯤 다시 오세요.',
  'sheet.noParts': '아직 아무것도 안 붙었어요',
  'sheet.replayTutorial': '튜토리얼 다시 보기',
  'sheet.times': '{n}회',
  'sheet.now': '지금',

  // 선단
  'crew.chip': '선원 {n}',
  'crew.code': '초대 코드',
  'crew.copy': '초대 링크 복사',
  'crew.copied': '복사했어요!',
  'crew.join': '코드로 합류',
  'crew.leadSolo': '혼자서도 문제없지만, 친구가 합류하면 더 빨리 쌓이고 부품도 나눠 받아요.',
  'crew.leadTogether':
    '같이 있는 동안 축적 속도 {bonus}. 선원이 수거하면 그 부품 하나가 내 배에도 붙어요.',
  'crew.note':
    '지금은 같은 브라우저의 다른 탭·창끼리만 이어집니다. 다른 기기의 친구와 연결하려면 로그인이 필요해요.',
  'crew.me': '나',
  'crew.sailing': '항해 중',
  'crew.giftFrom': '{name}의 수거',

  // 공통
  'common.close': '닫기',
  'common.cancel': '취소',
  'common.confirm': '확인',
  'common.language': '언어',
};

const EN: Dict = {
  'app.title': 'Molehang',

  'res.name': 'Scrap',
  'res.perSecond': '+{n}/s',
  'res.untilFull': 'Full in {t}',
  'res.full': "It's full — collect before it overflows",
  'res.collect': 'COLLECT',
  'res.collectSub': 'Take {n}',
  'res.collectIdle': 'Still piling up',

  'ship.parts': '{n} parts',
  'ship.slots': 'Space {used}/{max}',
  'ship.slotsFull': 'No space left',

  'gacha.title': 'Part Draw',
  'gacha.small': 'Small Part',
  'gacha.medium': 'Medium Part',
  'gacha.large': 'Large Part',
  'gacha.cost': '{n} scrap',
  'gacha.spin': 'SPIN',
  'gacha.spinning': 'Spinning…',
  'gacha.result': 'Got {name}!',
  'gacha.mustEquip': 'Whatever you draw gets bolted on',
  'gacha.needRoom': 'Not enough space. Pick something to remove.',
  'gacha.cantAfford': 'Not enough scrap',
  'gacha.equip': 'Bolt it on',
  'gacha.replace': 'Remove {name} & install',

  'sheet.title': 'Logbook',
  'sheet.statLifetime': 'Total scrap',
  'sheet.statCollects': 'Collects',
  'sheet.statParts': 'Parts',
  'sheet.sectionShip': 'This ship',
  'sheet.sectionCrew': 'Crew',
  'sheet.sectionTitles': 'Titles',
  'sheet.sectionLog': 'Collection log',
  'sheet.condition': 'Unlock · {hint}',
  'sheet.empty': "You haven't collected anything yet.\nCome back when class gets boring.",
  'sheet.noParts': 'Nothing bolted on yet',
  'sheet.replayTutorial': 'Replay tutorial',
  'sheet.times': '{n}x',
  'sheet.now': 'now',

  'crew.chip': '{n} aboard',
  'crew.code': 'Invite code',
  'crew.copy': 'Copy invite link',
  'crew.copied': 'Copied!',
  'crew.join': 'Join with code',
  'crew.leadSolo': "Fine on your own — but with friends it piles up faster and parts get shared.",
  'crew.leadTogether':
    'While you are online together: {bonus} rate. When a crewmate collects, one of their parts lands on your ship too.',
  'crew.note':
    'Right now this only links tabs in the same browser. Sign in to connect with friends on other devices.',
  'crew.me': 'You',
  'crew.sailing': 'Sailing',
  'crew.giftFrom': "{name}'s haul",

  'common.close': 'Close',
  'common.cancel': 'Cancel',
  'common.confirm': 'OK',
  'common.language': 'Language',
};

const DICTS: Record<Locale, Dict> = { ko: KO, en: EN };

let current: Locale = detect();
const listeners = new Set<(l: Locale) => void>();

function detect(): Locale {
  try {
    const saved = globalThis.localStorage?.getItem(STORE_KEY);
    if (saved === 'ko' || saved === 'en') return saved;
  } catch {
    // 저장소를 못 읽어도 기본값으로 굴러간다
  }
  // 기본은 한국어. 브라우저가 영어일 때만 영어.
  const nav = globalThis.navigator?.language ?? 'ko';
  return nav.toLowerCase().startsWith('en') ? 'en' : 'ko';
}

export function locale(): Locale {
  return current;
}

export function setLocale(next: Locale): void {
  if (next === current) return;
  current = next;
  try {
    globalThis.localStorage?.setItem(STORE_KEY, next);
  } catch {
    // 저장 실패해도 이번 세션에는 적용된다
  }
  document.documentElement.lang = next;
  for (const fn of listeners) fn(next);
  applyStatic();
}

export function onLocaleChange(fn: (l: Locale) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 번역. 없는 키는 키 자체를 돌려줘 눈에 띄게 한다. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const raw = DICTS[current][key] ?? DICTS.ko[key] ?? key;
  if (vars === undefined) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name: string) =>
    Object.hasOwn(vars, name) ? String(vars[name]) : `{${name}}`,
  );
}

/** `data-i18n` 이 달린 정적 요소를 현재 언어로 채운다 */
export function applyStatic(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = el.dataset.i18n;
    if (key !== undefined) el.textContent = t(key);
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-aria]')) {
    const key = el.dataset.i18nAria;
    if (key !== undefined) el.setAttribute('aria-label', t(key));
  }
}
