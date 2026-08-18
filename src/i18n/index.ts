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
  'gacha.statSlots': '자리',
  'gacha.statRate': '생산',
  'gacha.statEffect': '효과',

  // 기록 시트
  'sheet.title': '항해 기록',
  'sheet.sectionAvatar': '선장 아바타',
  'avatar.lead':
    '갑판에 서 있는 작은 선장이 나예요. 선단으로 같이 접속하면 친구들도 내 갑판에 나란히 섭니다.',
  'avatar.hat': '모자',
  'avatar.outfit': '옷 색',
  'avatar.hat.none': '맨머리',
  'avatar.hat.cap': '챙 모자',
  'avatar.hat.tricorn': '삼각모',
  'avatar.hat.bucket': '밀짚모자',
  'sheet.statLifetime': '누적 고철',
  'sheet.statCollects': '수거',
  'sheet.statParts': '파츠',
  'sheet.sectionShip': '지금 이 배',
  'sheet.sectionTheme': '바다 테마',
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
  'crew.joinPrompt': '친구에게 받은 6자리 초대 코드를 입력하세요',
  'crew.copyFallback': '이 링크를 친구에게 보내세요',
  'crew.badCode': '코드가 올바르지 않아요. 6자리를 다시 확인해 주세요.',

  'log.first': '첫 수거',
  'log.gathered': '{t} 모음',

  // 테마
  'theme.draw': '테마 뽑기',
  'theme.note': '바다 색이 통째로 바뀝니다',
  'theme.lead': '같은 바다가 지겨우면 다른 바다로. 뽑은 테마는 언제든 바꿔 낄 수 있어요.',
  'theme.allOwned': '테마를 전부 모았어요.',
  'theme.applied': '바로 적용했어요',
  'theme.soldOut': '더 뽑을 테마가 없어요',

  // 배치
  'arrange.toggle': '배치',
  'arrange.hint': '테두리가 뜬 부품을 끌어서 옮기세요 — 각자 정해진 구역 안에서만 움직여요',
  'arrange.moving': '{name} 옮기는 중',
  'arrange.done': '완료',
  'arrange.reset': '자동 정렬',
  'arrange.settling': '허공엔 못 붙여요 — 닿는 자리까지 내려앉아요',

  // 망원경
  'scope.aria': '망원경 배율',
  'scope.reset': '기본 배율로',
  'scope.value': '{n}배',

  // 항해모드
  'voyage.toggle': '항해',
  'voyage.hint': 'WASD·방향키, 또는 화면을 끌어서 항해하세요 — 암초를 조심!',
  'voyage.done': '정박',
  'voyage.hit': '암초에 긁혔다!',
  'voyage.speed': '{n}노트',

  // 방치 컨텐츠 — 돌아왔을 때 배에 생긴 일
  'idle.moss': '자리를 비운 사이 이끼가 앉았다 (+{n})',
  'idle.gullNest': '갈매기가 둥지를 틀었다',
  'idle.ghost': '오래 비운 배에 유령이 눌러앉았다',

  // 계정
  'auth.guest': '게스트',
  'auth.account': '계정',
  'auth.title': '계정',
  'auth.guestLead':
    '게스트로도 전부 즐길 수 있어요. 다만 게스트 기록은 창을 닫으면 사라집니다. ' +
    '로그인하면 지금 이 배가 그대로 계정으로 옮겨 가고, 기기를 옮겨도 남아요.',
  'auth.email': '이메일',
  'auth.sendCode': '인증코드 받기',
  'auth.codeLabel': '인증코드 6자리',
  'auth.verify': '확인',
  'auth.resend': '코드 다시 보내기',
  'auth.changeEmail': '이메일 바꾸기',
  'auth.newShip': '새 배 만들기',
  'auth.signOut': '로그아웃',
  'auth.badEmail': '이메일 주소를 다시 확인해 주세요',
  'auth.badCode': '6자리 숫자를 입력해 주세요',
  'auth.sending': '코드를 보내는 중…',
  'auth.verifying': '확인 중…',
  'auth.codeSent': '{email} 로 6자리 코드를 보냈어요. 메일함을 확인하세요.',
  'auth.signedInAs': '{email} 로 로그인했어요',
  'auth.loading': '불러오는 중…',
  'auth.importFailed': '배를 계정으로 옮기지 못했어요. 이 탭을 닫지 말고 잠시 후 다시 시도해 주세요.',
  'auth.importedName': '게스트에서 가져온 배',
  'auth.newShipPrompt': '새 배 이름을 지어 주세요',
  'auth.newShipDefault': '두 번째 배',
  'auth.shipFailed': '배를 만들지 못했어요. 잠시 후 다시 시도해 주세요.',

  // 튜토리얼
  'tutorial.next': '다음',
  'tutorial.start': '시작하기',
  'tutorial.skip': '건너뛰기',
  'tutorial.welcome.title': '몰래항에 온 걸 환영해요',
  'tutorial.welcome.body':
    '수업이나 회의가 지루한 동안, 이 바다에서는 고철이 알아서 쌓입니다. 할 일은 가끔 들러 수거하는 것뿐이에요.',
  'tutorial.idle.title': '고철은 저절로 쌓여요',
  'tutorial.idle.body':
    '창을 닫아 두어도 시간은 흐릅니다. 왼쪽의 "초당 +N"이 지금 버는 속도예요. 다만 상한이 있어서, 가득 차면 더는 쌓이지 않습니다.',
  'tutorial.collect.title': '가득 차기 전에 수거',
  'tutorial.collect.body':
    '넘친 고철은 그냥 사라집니다. 수거한 고철은 지갑으로 들어가고, 그 고철로 부품을 뽑아요.',
  'tutorial.draw.title': '부품은 뽑기로',
  'tutorial.draw.body':
    '작은·중간·대형 세 가지 뽑기가 있어요. 등급이 높을수록 비싸지만 생산량이 훨씬 큽니다. 돌림판이 멈추면 나온 부품은 **반드시** 장착됩니다.',
  'tutorial.space.title': '자리가 모자랍니다',
  'tutorial.space.body':
    '이게 이 게임의 유일한 고민이에요. 배에 붙일 자리는 한정돼 있고, 큰 부품일수록 자리를 많이 먹습니다. 자리가 없는데 뽑으면, 무엇을 뽑아낼지 그 자리에서 골라야 해요.',
  'tutorial.crew.title': '친구와 같이 켜 두면',
  'tutorial.crew.body':
    '초대 코드로 선단을 만들면 같이 접속해 있는 동안 축적이 빨라지고, 친구가 수거할 때마다 나에게도 고철이 떨어집니다.',

  // 토스트
  'toast.installed': '장착',
  'toast.replaced': '{name} 빼고 장착',
  'toast.newTitle': '새 칭호',

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
  'gacha.statSlots': 'Space',
  'gacha.statRate': 'Rate',
  'gacha.statEffect': 'Effect',

  'sheet.title': 'Logbook',
  'sheet.sectionAvatar': 'Captain avatar',
  'avatar.lead':
    "That little captain on deck is you. Crewmates sailing with you stand on your deck too.",
  'avatar.hat': 'Hat',
  'avatar.outfit': 'Outfit',
  'avatar.hat.none': 'Bare head',
  'avatar.hat.cap': 'Cap',
  'avatar.hat.tricorn': 'Tricorn',
  'avatar.hat.bucket': 'Straw hat',
  'sheet.statLifetime': 'Total scrap',
  'sheet.statCollects': 'Collects',
  'sheet.statParts': 'Parts',
  'sheet.sectionShip': 'This ship',
  'sheet.sectionTheme': 'Sea themes',
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
  'crew.joinPrompt': 'Enter the 6-character invite code',
  'crew.copyFallback': 'Send this link to your friend',
  'crew.badCode': "That code isn't right. Check the 6 characters.",

  'log.first': 'First collect',
  'log.gathered': 'gathered over {t}',

  'theme.draw': 'Draw a sea',
  'theme.note': 'The whole sea changes colour',
  'theme.lead': 'Tired of this sea? Draw another. Switch between the ones you own any time.',
  'theme.allOwned': "You've collected every sea.",
  'theme.applied': 'Applied right away',
  'theme.soldOut': 'No seas left to draw',

  'arrange.toggle': 'Arrange',
  'arrange.hint': 'Drag any outlined part — each one stays inside its own area',
  'arrange.moving': 'Moving {name}',
  'arrange.done': 'Done',
  'arrange.reset': 'Auto-arrange',
  'arrange.settling': "Nothing floats — it drops until it's touching something",

  'scope.aria': 'Telescope zoom',
  'scope.reset': 'Back to 1x',
  'scope.value': '{n}x',

  'voyage.toggle': 'Sail',
  'voyage.hint': 'Sail with WASD/arrows, or drag the screen — mind the reefs!',
  'voyage.done': 'Drop anchor',
  'voyage.hit': 'Scraped a reef!',
  'voyage.speed': '{n} kn',

  'idle.moss': 'Moss settled in while you were away (+{n})',
  'idle.gullNest': 'A gull built a nest',
  'idle.ghost': 'A ghost moved into the empty ship',

  'auth.guest': 'Guest',
  'auth.account': 'Account',
  'auth.title': 'Account',
  'auth.guestLead':
    'Everything works as a guest, but guest progress is gone once you leave the site. ' +
    'Sign in and the ship you have right now comes with you — on any device.',
  'auth.email': 'Email',
  'auth.sendCode': 'Send code',
  'auth.codeLabel': '6-digit code',
  'auth.verify': 'Verify',
  'auth.resend': 'Resend code',
  'auth.changeEmail': 'Change email',
  'auth.newShip': 'New ship',
  'auth.signOut': 'Sign out',
  'auth.badEmail': 'Please check that email address',
  'auth.badCode': 'Enter the 6 digits',
  'auth.sending': 'Sending the code…',
  'auth.verifying': 'Checking…',
  'auth.codeSent': 'Sent a 6-digit code to {email}. Check your inbox.',
  'auth.signedInAs': 'Signed in as {email}',
  'auth.loading': 'Loading…',
  'auth.importFailed': "Couldn't move the ship to your account. Keep this tab open and try again.",
  'auth.importedName': 'Ship from guest',
  'auth.newShipPrompt': 'Name your new ship',
  'auth.newShipDefault': 'Second ship',
  'auth.shipFailed': "Couldn't create the ship. Try again in a moment.",

  'tutorial.next': 'Next',
  'tutorial.start': 'Start',
  'tutorial.skip': 'Skip',
  'tutorial.welcome.title': 'Welcome to Molehang',
  'tutorial.welcome.body':
    'While class or the meeting drags on, scrap piles up out here on its own. All you do is drop by and collect it.',
  'tutorial.idle.title': 'Scrap piles up by itself',
  'tutorial.idle.body':
    'Time passes even with the tab closed. The "+N/s" on the left is your current rate. There is a cap though — once full, nothing more accumulates.',
  'tutorial.collect.title': 'Collect before it overflows',
  'tutorial.collect.body':
    'Overflow is simply lost. Collected scrap goes into your wallet, and you spend it drawing parts.',
  'tutorial.draw.title': 'Parts come from draws',
  'tutorial.draw.body':
    'Small, medium and large draws. Higher tiers cost more but produce far more. When the wheel stops, whatever it landed on gets bolted on — no take-backs.',
  'tutorial.space.title': 'Space is what runs out',
  'tutorial.space.body':
    'This is the one real decision here. Your hull has limited space, and bigger parts eat more of it. Draw with no room left and you must choose, right then, what to rip off.',
  'tutorial.crew.title': 'Better with friends online',
  'tutorial.crew.body':
    'Make a crew with an invite code: while you are online together the rate goes up, and every time a crewmate collects, some scrap lands on you too.',

  'toast.installed': 'installed',
  'toast.replaced': 'swapped for {name}',
  'toast.newTitle': 'New title',

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
