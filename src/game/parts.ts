import type { Locale } from '../i18n/index.ts';

/**
 * 파츠 · 뽑기 · 시크릿 전직.
 *
 * 경제의 축은 **선체 공간**이다. 고철은 시간이 갈수록 넘치게 되지만 배에 붙일 자리는
 * 늘 모자란다. 뽑은 부품은 반드시 장착되므로, 자리가 없으면 "무엇을 뽑아낼지"를
 * 그 자리에서 결정해야 한다. 그게 이 게임의 유일한 진짜 선택이다.
 *
 * 생산량도 부품에서 나온다 → 좋은 부품을 넣으려면 자리를 비워야 하고,
 * 자리를 비우려면 생산량을 깎아야 한다. 고철이 아무리 많아도 이 긴장은 안 풀린다.
 *
 * 컨텐츠 데이터(이름·설명)는 i18n 사전이 아니라 여기 같이 둔다 —
 * 부품을 추가할 때 한 곳만 고치면 되게 하려는 의도적인 예외다.
 */

export const PART_TIERS = ['small', 'medium', 'large'] as const;
export type PartTier = (typeof PART_TIERS)[number];

/** 부품이 붙는 구역 — 배치 커스텀은 이 구역 **안에서만** 자유롭다 */
export const PART_ZONES = ['deck', 'side', 'mast', 'stern'] as const;
export type PartZone = (typeof PART_ZONES)[number];

export const PART_KINDS = [
  // 작은 부품 (1칸)
  'moss',
  'window',
  'lantern',
  'barrel',
  'rope',
  'buoy',
  // 중간 부품 (2칸)
  'engine',
  'chimney',
  'sail',
  'cannon',
  'crane',
  'tank',
  // 대형 부품 (3칸)
  'bigEngine',
  'turbine',
  'greatSail',
  'turret',
  'beacon',
  // 특수 — 자리를 먹지 않고 오히려 늘린다
  'hullExtension',
] as const;

export type PartKind = (typeof PART_KINDS)[number];

export interface PartDef {
  kind: PartKind;
  tier: PartTier;
  zone: PartZone;
  /** 차지하는 자리. 0이면 자리를 안 먹는다 */
  slots: number;
  /** 초당 고철 생산 기여 */
  production: number;
  /** 선체 자리를 늘려 주는 특수 부품 */
  addsSlots?: number;
  /** 밤에 배를 밝히는 정도 (0이면 빛 없음) */
  light?: number;
  label: Record<Locale, string>;
  blurb: Record<Locale, string>;
  /** 같은 등급 안에서의 상대 등장 확률 */
  weight: number;
}

export const PART_INFO: Record<PartKind, PartDef> = {
  // ---------------------------------------------------------------- 작은 부품
  moss: {
    kind: 'moss', tier: 'small', zone: 'side', slots: 1, production: 0, weight: 22,
    label: { ko: '이끼', en: 'Moss' },
    blurb: { ko: '아무것도 안 한다. 그냥 자란다.', en: 'Does nothing. Just grows.' },
  },
  window: {
    kind: 'window', tier: 'small', zone: 'side', slots: 1, production: 0.4, weight: 18,
    label: { ko: '창문', en: 'Window' },
    blurb: { ko: '전망. 방수는 별개 문제.', en: 'A view. Waterproofing sold separately.' },
  },
  lantern: {
    kind: 'lantern', tier: 'small', zone: 'deck', slots: 1, production: 0.3, light: 1, weight: 18,
    label: { ko: '등불', en: 'Lantern' },
    blurb: { ko: '밤바다에서 배를 밝힌다.', en: 'Lights the ship at night.' },
  },
  barrel: {
    kind: 'barrel', tier: 'small', zone: 'deck', slots: 1, production: 0.5, weight: 14,
    label: { ko: '통', en: 'Barrel' },
    blurb: { ko: '안에 뭐가 들었는지는 아무도 모른다.', en: 'Nobody knows what is inside.' },
  },
  rope: {
    kind: 'rope', tier: 'small', zone: 'mast', slots: 1, production: 0.6, weight: 14,
    label: { ko: '밧줄', en: 'Rigging' },
    blurb: { ko: '뭔가를 묶어 두면 덜 떨어진다.', en: 'Tied things fall off less often.' },
  },
  buoy: {
    kind: 'buoy', tier: 'small', zone: 'side', slots: 1, production: 0.7, weight: 14,
    label: { ko: '부표', en: 'Buoy' },
    blurb: { ko: '떠 있는 데 도움이 된다고 한다.', en: 'Allegedly helps with floating.' },
  },

  // ---------------------------------------------------------------- 중간 부품
  engine: {
    kind: 'engine', tier: 'medium', zone: 'stern', slots: 2, production: 2.4, weight: 22,
    label: { ko: '엔진', en: 'Engine' },
    blurb: { ko: '추진력. 많을수록 시끄럽다.', en: 'Thrust. Louder in bulk.' },
  },
  chimney: {
    kind: 'chimney', tier: 'medium', zone: 'deck', slots: 2, production: 2.0, weight: 20,
    label: { ko: '굴뚝', en: 'Chimney' },
    blurb: { ko: '연기가 난다. 뭘 태우는지는 모른다.', en: 'Smoke. Source unclear.' },
  },
  sail: {
    kind: 'sail', tier: 'medium', zone: 'mast', slots: 2, production: 2.2, weight: 20,
    label: { ko: '돛', en: 'Sail' },
    blurb: { ko: '바람을 받는다. 가끔 너무 많이.', en: 'Catches wind. Sometimes too much.' },
  },
  cannon: {
    kind: 'cannon', tier: 'medium', zone: 'deck', slots: 2, production: 1.8, weight: 16,
    label: { ko: '대포', en: 'Cannon' },
    blurb: { ko: '용도 미상. 일단 달았다.', en: 'Purpose unknown. Installed anyway.' },
  },
  crane: {
    kind: 'crane', tier: 'medium', zone: 'deck', slots: 2, production: 2.6, weight: 12,
    label: { ko: '기중기', en: 'Crane' },
    blurb: { ko: '고철을 더 빨리 끌어올린다.', en: 'Hauls scrap up faster.' },
  },
  tank: {
    kind: 'tank', tier: 'medium', zone: 'stern', slots: 2, production: 2.1, weight: 10,
    label: { ko: '물탱크', en: 'Water tank' },
    blurb: { ko: '무겁지만 쓸모는 있다.', en: 'Heavy, but useful.' },
  },

  // ---------------------------------------------------------------- 대형 부품
  bigEngine: {
    kind: 'bigEngine', tier: 'large', zone: 'stern', slots: 3, production: 7.5, weight: 24,
    label: { ko: '대형 엔진', en: 'Heavy engine' },
    blurb: { ko: '갑판이 흔들릴 정도로 돈다.', en: 'Shakes the whole deck.' },
  },
  turbine: {
    kind: 'turbine', tier: 'large', zone: 'deck', slots: 3, production: 8.2, weight: 20,
    label: { ko: '증기 터빈', en: 'Steam turbine' },
    blurb: { ko: '뜨겁고 비싸고 효율이 좋다.', en: 'Hot, costly, efficient.' },
  },
  greatSail: {
    kind: 'greatSail', tier: 'large', zone: 'mast', slots: 3, production: 7.0, weight: 20,
    label: { ko: '대형 돛', en: 'Great sail' },
    blurb: { ko: '돛대가 버틸지는 모르겠다.', en: 'The mast may disagree.' },
  },
  turret: {
    kind: 'turret', tier: 'large', zone: 'deck', slots: 3, production: 6.4, weight: 16,
    label: { ko: '회전 포탑', en: 'Turret' },
    blurb: { ko: '누구와 싸우는지는 아직 모른다.', en: 'Enemy still unidentified.' },
  },
  beacon: {
    kind: 'beacon', tier: 'large', zone: 'mast', slots: 3, production: 6.8, light: 4, weight: 14,
    label: { ko: '등대탑', en: 'Beacon tower' },
    blurb: { ko: '밤바다를 멀리까지 밝힌다.', en: 'Lights the sea for miles.' },
  },

  // ---------------------------------------------------------------- 특수
  hullExtension: {
    kind: 'hullExtension', tier: 'large', zone: 'deck', slots: 0, production: 0, addsSlots: 2,
    weight: 6,
    label: { ko: '선체 증축', en: 'Hull extension' },
    blurb: {
      ko: '자리를 2칸 늘린다. 대형 뽑기에서만 아주 드물게.',
      en: 'Adds 2 slots. Large draws only, rarely.',
    },
  },
};

export function partLabel(kind: PartKind, loc: Locale): string {
  return PART_INFO[kind].label[loc];
}

export function partBlurb(kind: PartKind, loc: Locale): string {
  return PART_INFO[kind].blurb[loc];
}

export function kindsOfTier(tier: PartTier): PartKind[] {
  return PART_KINDS.filter((k) => PART_INFO[k].tier === tier);
}

// ---------------------------------------------------------------------------
// 인벤토리
// ---------------------------------------------------------------------------

export type Inventory = Record<PartKind, number>;

export function emptyInventory(): Inventory {
  const inv = {} as Inventory;
  for (const k of PART_KINDS) inv[k] = 0;
  return inv;
}

export function sanitizeInventory(raw: unknown): Inventory {
  const inv = emptyInventory();
  if (typeof raw !== 'object' || raw === null) return inv;
  const src = raw as Record<string, unknown>;
  for (const kind of PART_KINDS) {
    const v = src[kind];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      inv[kind] = Math.min(999, Math.floor(v));
    }
  }
  return inv;
}

export function totalParts(inv: Inventory): number {
  return PART_KINDS.reduce((sum, k) => sum + inv[k], 0);
}

/** 지금 쓰고 있는 자리 */
export function usedSlots(inv: Inventory): number {
  return PART_KINDS.reduce((sum, k) => sum + inv[k] * PART_INFO[k].slots, 0);
}

/** 선체 증축으로 늘어난 자리를 포함한 최대 자리 */
export function maxSlots(inv: Inventory, base: number): number {
  return base + inv.hullExtension * (PART_INFO.hullExtension.addsSlots ?? 0);
}

/** 부품에서 나오는 초당 생산량 */
export function productionPerSecond(inv: Inventory, base: number): number {
  return base + PART_KINDS.reduce((sum, k) => sum + inv[k] * PART_INFO[k].production, 0);
}

/** 밤에 배를 밝히는 총량 — 0이면 배가 어둠에 잠긴다 */
export function lightLevel(inv: Inventory): number {
  return PART_KINDS.reduce((sum, k) => sum + inv[k] * (PART_INFO[k].light ?? 0), 0);
}

/** 자리를 비우려고 뽑아낼 수 있는 부품 (자리를 차지하는 것만) */
export function removableKinds(inv: Inventory): PartKind[] {
  return PART_KINDS.filter((k) => inv[k] > 0 && PART_INFO[k].slots > 0);
}

// ---------------------------------------------------------------------------
// 뽑기
// ---------------------------------------------------------------------------

/** 등급별 기본 가격과 상승률 — 뽑을수록 조금씩 비싸진다 */
export const GACHA: Record<PartTier, { base: number; growth: number }> = {
  small: { base: 60, growth: 1.07 },
  medium: { base: 420, growth: 1.09 },
  large: { base: 2600, growth: 1.12 },
};

export function gachaCost(tier: PartTier, pulls: number): number {
  const { base, growth } = GACHA[tier];
  return Math.ceil(base * growth ** Math.max(0, pulls));
}

/** 등급 안에서 가중치로 하나 뽑는다 */
export function rollPart(tier: PartTier, rand: () => number = Math.random): PartKind {
  const pool = kindsOfTier(tier);
  const total = pool.reduce((s, k) => s + PART_INFO[k].weight, 0);
  let ticket = rand() * total;
  for (const kind of pool) {
    ticket -= PART_INFO[kind].weight;
    if (ticket <= 0) return kind;
  }
  return pool[pool.length - 1]!;
}

// ---------------------------------------------------------------------------
// 시크릿 전직
// ---------------------------------------------------------------------------

export interface ShipTitle {
  id: string;
  name: Record<Locale, string>;
  hint: Record<Locale, string>;
  test: (inv: Inventory) => boolean;
}

/** 조건을 만족하는 것 중 **가장 아래**가 현재 칭호가 된다 */
export const SHIP_TITLES: ShipTitle[] = [
  {
    id: 'raft',
    name: { ko: '떠다니는 뗏목', en: 'Drifting Raft' },
    hint: { ko: '시작은 다 이렇다', en: 'Everyone starts here' },
    test: () => true,
  },
  {
    id: 'tidy',
    name: { ko: '멀쩡한 배', en: 'Respectable Boat' },
    hint: { ko: '파츠 6개', en: '6 parts' },
    test: (inv) => totalParts(inv) >= 6,
  },
  {
    id: 'cruiser',
    name: { ko: '수상 유람선', en: 'Pleasure Cruiser' },
    hint: { ko: '창문 6개', en: '6 windows' },
    test: (inv) => inv.window >= 6,
  },
  {
    id: 'pirate',
    name: { ko: '해적선', en: 'Pirate Ship' },
    hint: { ko: '대포 5개', en: '5 cannons' },
    test: (inv) => inv.cannon >= 5,
  },
  {
    id: 'steamer',
    name: { ko: '증기 괴물', en: 'Steam Monster' },
    hint: { ko: '굴뚝 5개', en: '5 chimneys' },
    test: (inv) => inv.chimney >= 5,
  },
  {
    id: 'lighthouse',
    name: { ko: '떠다니는 등대', en: 'Floating Lighthouse' },
    hint: { ko: '등불 6개', en: '6 lanterns' },
    test: (inv) => inv.lantern >= 6,
  },
  {
    id: 'windtower',
    name: { ko: '돛의 탑', en: 'Tower of Sails' },
    hint: { ko: '돛 6개', en: '6 sails' },
    test: (inv) => inv.sail >= 6,
  },
  {
    id: 'ghost',
    name: { ko: '이끼 유령선', en: 'Mossy Ghost Ship' },
    hint: { ko: '이끼 10개', en: '10 moss' },
    test: (inv) => inv.moss >= 10,
  },
  {
    id: 'runaway',
    name: { ko: '폭주 기관선', en: 'Runaway Engine' },
    hint: { ko: '엔진 8개', en: '8 engines' },
    test: (inv) => inv.engine >= 8,
  },
  {
    id: 'dreadnought',
    name: { ko: '강철 요새', en: 'Steel Dreadnought' },
    hint: { ko: '대형 부품 5개', en: '5 large parts' },
    test: (inv) => kindsOfTier('large').reduce((s, k) => s + inv[k], 0) >= 5,
  },
  {
    id: 'ark',
    name: { ko: '잡동사니 방주', en: 'Junk Ark' },
    hint: { ko: '모든 종류 2개씩', en: '2 of every kind' },
    test: (inv) => PART_KINDS.filter((k) => k !== 'hullExtension').every((k) => inv[k] >= 2),
  },
];

export function currentTitle(inv: Inventory): ShipTitle {
  let found = SHIP_TITLES[0]!;
  for (const t of SHIP_TITLES) if (t.test(inv)) found = t;
  return found;
}

export function unlockedTitleIds(inv: Inventory): string[] {
  return SHIP_TITLES.filter((t) => t.test(inv)).map((t) => t.id);
}
