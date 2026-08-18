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
  'anchor',
  'duck',
  'net',
  'weathervane',
  // 중간 부품 (2칸)
  'engine',
  'chimney',
  'sail',
  'cannon',
  'crane',
  'tank',
  'wheelhouse',
  'paddle',
  'magnet',
  // 대형 부품 (3칸)
  'bigEngine',
  'turbine',
  'greatSail',
  'turret',
  'beacon',
  // 대형 — 낮은 확률의 밸런스 붕괴 부품들 (의도된 것이다)
  'goldenDuck',
  'kraken',
  'clocktower',
  // 특수 — 자리를 먹지 않고 오히려 늘린다
  'hullExtension',
  // 뽑기에서 안 나온다 (weight 0) — 항해·방치로만 붙는 부품들
  'barnacle',
  'gullNest',
  'ghost',
] as const;

export type PartKind = (typeof PART_KINDS)[number];

/**
 * 부품 효과 — 있는 것만 채운다. 전부 **인벤토리에서 곱/합으로만 계산**되는 순수 값이라
 * 서버 정산과 충돌하지 않는다 (생산량은 어차피 클라이언트가 보내고 서버가 클램프한다).
 */
export interface PartEffects {
  /** 전체 생산 배율 (개당 곱). 1 초과면 밸런스 붕괴 후보 — 낮은 확률로만 나온다 */
  prodMult?: number;
  /** 미수거 상한 보너스 (+0.15 = +15%, 개수만큼 합산) */
  capacity?: number;
  /** 뽑기 가격 할인 (0.05 = 5%, 합산 후 50%에서 자른다) */
  discount?: number;
  /** 수거량 보너스 (0.1 = +10%, 합산) */
  collect?: number;
  /** 항해모드 속도 보너스 (유닛/초, 합산 후 상한) */
  speed?: number;
}

export interface PartDef {
  kind: PartKind;
  tier: PartTier;
  zone: PartZone;
  /** 차지하는 자리. 0이면 자리를 안 먹는다. 따개비류는 0.1칸 — 거의 안 먹지만 티는 낸다 */
  slots: number;
  /**
   * 무게. 안 적으면 slots 와 같다. **항해에만** 영향을 준다 —
   * 무거운 배는 최고속도·가속이 깎이고 물에 더 잠긴 채 달린다(§4.9).
   * 생산·상한 등 경제 계산과는 완전히 무관하다.
   */
  heft?: number;
  /** 초당 고철 생산 기여 */
  production: number;
  /** 선체 자리를 늘려 주는 특수 부품 */
  addsSlots?: number;
  /** 밤에 배를 밝히는 정도 (0이면 빛 없음) */
  light?: number;
  /** 생산 외의 효과 */
  effects?: PartEffects;
  label: Record<Locale, string>;
  blurb: Record<Locale, string>;
  /** 같은 등급 안에서의 상대 등장 확률. 0이면 뽑기에 안 나온다(항해·방치 전용) */
  weight: number;
}

export const PART_INFO: Record<PartKind, PartDef> = {
  // ---------------------------------------------------------------- 작은 부품
  moss: {
    kind: 'moss', tier: 'small', zone: 'side', slots: 0, production: 0, weight: 22, heft: 0,
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
    kind: 'rope', tier: 'small', zone: 'mast', slots: 1, production: 0.6, weight: 14, heft: 0,
    label: { ko: '밧줄', en: 'Rigging' },
    blurb: { ko: '뭔가를 묶어 두면 덜 떨어진다.', en: 'Tied things fall off less often.' },
  },
  buoy: {
    kind: 'buoy', tier: 'small', zone: 'side', slots: 1, production: 0.7, weight: 14, heft: 0,
    label: { ko: '부표', en: 'Buoy' },
    blurb: { ko: '떠 있는 데 도움이 된다고 한다.', en: 'Allegedly helps with floating.' },
  },
  anchor: {
    kind: 'anchor', tier: 'small', zone: 'side', slots: 1, production: 0.5, weight: 12, heft: 3,
    label: { ko: '닻', en: 'Anchor' },
    blurb: { ko: '내리면 멈춘다고 한다. 아직 안 내려 봤다. 무겁다.', en: 'Supposedly stops the ship. Untested. Heavy.' },
  },
  duck: {
    kind: 'duck', tier: 'small', zone: 'deck', slots: 1, production: 0.2, weight: 10, heft: 0,
    effects: { collect: 0.03 },
    label: { ko: '고무 오리', en: 'Rubber duck' },
    blurb: { ko: '사기 진작 담당. 수거가 조금 즐거워진다.', en: 'Morale officer. Collecting feels nicer.' },
  },
  net: {
    kind: 'net', tier: 'small', zone: 'side', slots: 1, production: 0.4, weight: 12,
    effects: { capacity: 0.08 },
    label: { ko: '그물', en: 'Net' },
    blurb: { ko: '자는 동안에도 뭔가 걸려 있다.', en: 'Something is always caught in it.' },
  },
  weathervane: {
    kind: 'weathervane', tier: 'small', zone: 'mast', slots: 1, production: 0.6, weight: 10, heft: 0,
    effects: { speed: 0.4 },
    label: { ko: '풍향계', en: 'Weathervane' },
    blurb: { ko: '바람을 읽는다. 항해가 빨라진다.', en: 'Reads the wind. Sails faster.' },
  },

  // ---------------------------------------------------------------- 중간 부품
  engine: {
    kind: 'engine', tier: 'medium', zone: 'stern', slots: 2, production: 2.4, weight: 22,
    effects: { speed: 0.35 },
    label: { ko: '엔진', en: 'Engine' },
    blurb: { ko: '추진력. 많을수록 시끄럽다.', en: 'Thrust. Louder in bulk.' },
  },
  chimney: {
    kind: 'chimney', tier: 'medium', zone: 'deck', slots: 2, production: 2.0, weight: 20,
    label: { ko: '굴뚝', en: 'Chimney' },
    blurb: { ko: '연기가 난다. 뭘 태우는지는 모른다.', en: 'Smoke. Source unclear.' },
  },
  sail: {
    kind: 'sail', tier: 'medium', zone: 'mast', slots: 2, production: 2.2, weight: 20, heft: 1,
    effects: { speed: 0.5 },
    label: { ko: '돛', en: 'Sail' },
    blurb: { ko: '바람을 받는다. 가끔 너무 많이.', en: 'Catches wind. Sometimes too much.' },
  },
  cannon: {
    kind: 'cannon', tier: 'medium', zone: 'deck', slots: 2, production: 1.8, weight: 16, heft: 3,
    label: { ko: '대포', en: 'Cannon' },
    blurb: { ko: '용도 미상. 일단 달았다.', en: 'Purpose unknown. Installed anyway.' },
  },
  crane: {
    kind: 'crane', tier: 'medium', zone: 'deck', slots: 2, production: 2.6, weight: 12,
    effects: { collect: 0.05 },
    label: { ko: '기중기', en: 'Crane' },
    blurb: { ko: '고철을 더 빨리 끌어올린다.', en: 'Hauls scrap up faster.' },
  },
  tank: {
    kind: 'tank', tier: 'medium', zone: 'stern', slots: 2, production: 2.1, weight: 10, heft: 5,
    effects: { capacity: 0.15 },
    label: { ko: '물탱크', en: 'Water tank' },
    blurb: { ko: '무겁지만 쓸모는 있다.', en: 'Heavy, but useful.' },
  },
  wheelhouse: {
    kind: 'wheelhouse', tier: 'medium', zone: 'deck', slots: 2, production: 1.7, weight: 12,
    effects: { discount: 0.05 },
    label: { ko: '조타실', en: 'Wheelhouse' },
    blurb: { ko: '계획이 생기니 낭비가 준다.', en: 'Planning reduces waste.' },
  },
  paddle: {
    kind: 'paddle', tier: 'medium', zone: 'side', slots: 2, production: 2.2, weight: 10,
    effects: { speed: 0.8 },
    label: { ko: '외륜', en: 'Paddle wheel' },
    blurb: { ko: '첨벙거리며 배를 민다.', en: 'Splashes the ship forward.' },
  },
  magnet: {
    kind: 'magnet', tier: 'medium', zone: 'deck', slots: 2, production: 1.9, weight: 8, heft: 3,
    effects: { collect: 0.1 },
    label: { ko: '인양 자석', en: 'Salvage magnet' },
    blurb: { ko: '지나가던 고철이 알아서 붙는다.', en: 'Passing scrap sticks on its own.' },
  },

  // ---------------------------------------------------------------- 대형 부품
  bigEngine: {
    kind: 'bigEngine', tier: 'large', zone: 'stern', slots: 3, production: 7.5, weight: 24, heft: 5,
    effects: { speed: 1.0 },
    label: { ko: '대형 엔진', en: 'Heavy engine' },
    blurb: { ko: '갑판이 흔들릴 정도로 돈다.', en: 'Shakes the whole deck.' },
  },
  turbine: {
    kind: 'turbine', tier: 'large', zone: 'deck', slots: 3, production: 8.2, weight: 20, heft: 4,
    effects: { speed: 0.8 },
    label: { ko: '증기 터빈', en: 'Steam turbine' },
    blurb: { ko: '뜨겁고 비싸고 효율이 좋다.', en: 'Hot, costly, efficient.' },
  },
  greatSail: {
    kind: 'greatSail', tier: 'large', zone: 'mast', slots: 3, production: 7.0, weight: 20, heft: 1,
    effects: { speed: 1.2 },
    label: { ko: '대형 돛', en: 'Great sail' },
    blurb: { ko: '돛대가 버틸지는 모르겠다.', en: 'The mast may disagree.' },
  },
  turret: {
    kind: 'turret', tier: 'large', zone: 'deck', slots: 3, production: 6.4, weight: 16, heft: 6,
    label: { ko: '회전 포탑', en: 'Turret' },
    blurb: { ko: '누구와 싸우는지는 아직 모른다.', en: 'Enemy still unidentified.' },
  },
  beacon: {
    kind: 'beacon', tier: 'large', zone: 'mast', slots: 3, production: 6.8, light: 4, weight: 14, heft: 4,
    label: { ko: '등대탑', en: 'Beacon tower' },
    blurb: { ko: '밤바다를 멀리까지 밝힌다.', en: 'Lights the sea for miles.' },
  },

  // ------------------------------------------------- 밸런스 붕괴 (낮은 확률, 의도된 것)
  goldenDuck: {
    kind: 'goldenDuck', tier: 'large', zone: 'deck', slots: 2, production: 0, weight: 2, heft: 0,
    effects: { prodMult: 2 },
    label: { ko: '황금 오리', en: 'Golden duck' },
    blurb: {
      ko: '명백한 밸런스 붕괴. 배 전체 생산이 두 배가 된다.',
      en: 'Obviously broken. Doubles all production.',
    },
  },
  kraken: {
    kind: 'kraken', tier: 'large', zone: 'side', slots: 2, production: 4.5, weight: 4, heft: 0,
    effects: { collect: 0.25 },
    label: { ko: '아기 크라켄', en: 'Baby kraken' },
    blurb: { ko: '수거를 도와준다. 아직은 착하다.', en: 'Helps with collection. Friendly, for now.' },
  },
  clocktower: {
    kind: 'clocktower', tier: 'large', zone: 'mast', slots: 3, production: 3.2, weight: 6, heft: 5,
    effects: { capacity: 0.5 },
    label: { ko: '고장난 시계탑', en: 'Broken clocktower' },
    blurb: {
      ko: '이 근처에서만 시간이 이상하게 흐른다.',
      en: 'Time runs strange around it.',
    },
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

  // ------------------------------------- 뽑기에서 안 나온다 — 항해·방치로만 (weight 0)
  barnacle: {
    kind: 'barnacle', tier: 'small', zone: 'side', slots: 0.1, production: 0, weight: 0, heft: 0,
    label: { ko: '따개비', en: 'Barnacle' },
    blurb: { ko: '암초에 부딪힌 훈장. 떼는 법은 아무도 모른다.', en: 'A medal for hitting reefs. Non-removable.' },
  },
  gullNest: {
    kind: 'gullNest', tier: 'small', zone: 'mast', slots: 0.1, production: 0.8, weight: 0, heft: 0,
    label: { ko: '갈매기 둥지', en: 'Gull nest' },
    blurb: {
      ko: '오래 비운 사이 갈매기가 자리를 잡았다. 집세로 고철을 물어다 준다.',
      en: 'A gull moved in while you were away. Pays rent in scrap.',
    },
  },
  ghost: {
    kind: 'ghost', tier: 'medium', zone: 'deck', slots: 0.1, production: 0, light: 2, weight: 0, heft: 0,
    effects: { capacity: 0.2 },
    label: { ko: '유령 선원', en: 'Ghost sailor' },
    blurb: {
      ko: '사흘 넘게 비운 배에 눌러앉았다. 밤에 은은하게 빛난다.',
      en: 'Moved into the ship after three empty days. Glows at night.',
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

/** 뽑기 돌림판에 오르는 종류만 — weight 0 (항해·방치 전용)은 뺀다 */
export function gachaKindsOfTier(tier: PartTier): PartKind[] {
  return kindsOfTier(tier).filter((k) => PART_INFO[k].weight > 0);
}

/** 뽑기로 얻을 수 있는 모든 종류 (칭호 '잡동사니 방주'의 기준) */
export function gachaKinds(): PartKind[] {
  return PART_KINDS.filter((k) => PART_INFO[k].weight > 0);
}

// ---------------------------------------------------------------------------
// 부품 효과 — 전부 인벤토리만 보는 순수 계산
// ---------------------------------------------------------------------------

/** 전체 생산 배율. 황금 오리가 겹치면 곱으로 는다 — 폭주 방지로 ×64에서 자른다 */
export function prodMultiplier(inv: Inventory): number {
  let mult = 1;
  for (const k of PART_KINDS) {
    const fx = PART_INFO[k].effects?.prodMult;
    if (fx !== undefined && inv[k] > 0) mult *= fx ** inv[k];
  }
  return Math.min(64, mult);
}

/** 미수거 상한 배율 (1 + 합산, ×8에서 자른다) */
export function capacityBoost(inv: Inventory): number {
  let sum = 0;
  for (const k of PART_KINDS) {
    const fx = PART_INFO[k].effects?.capacity;
    if (fx !== undefined) sum += fx * inv[k];
  }
  return Math.min(8, 1 + sum);
}

/** 뽑기 가격 할인율 (0~0.5) */
export function gachaDiscount(inv: Inventory): number {
  let sum = 0;
  for (const k of PART_KINDS) {
    const fx = PART_INFO[k].effects?.discount;
    if (fx !== undefined) sum += fx * inv[k];
  }
  return Math.min(0.5, sum);
}

/** 수거량 배율 (1 + 합산, ×4에서 자른다) */
export function collectBoost(inv: Inventory): number {
  let sum = 0;
  for (const k of PART_KINDS) {
    const fx = PART_INFO[k].effects?.collect;
    if (fx !== undefined) sum += fx * inv[k];
  }
  return Math.min(4, 1 + sum);
}

/** 부품 하나의 무게 — 안 적힌 부품은 자리 수가 곧 무게다 */
export function partHeft(kind: PartKind): number {
  return PART_INFO[kind].heft ?? PART_INFO[kind].slots;
}

/**
 * 배 전체 무게 — **항해에만** 쓴다(§4.9). 최고속도·가속을 깎고 배를 물에 더 잠기게 한다.
 * 따개비·둥지·유령은 무게 0 이다 — 암초 충돌·방치에 벌점을 만들지 않는 원칙 그대로.
 */
export function shipHeft(inv: Inventory): number {
  return PART_KINDS.reduce((sum, k) => sum + inv[k] * partHeft(k), 0);
}

/** 항해모드 속도 보너스 (유닛/초, 최대 +4) */
export function voyageSpeedBonus(inv: Inventory): number {
  let sum = 0;
  for (const k of PART_KINDS) {
    const fx = PART_INFO[k].effects?.speed;
    if (fx !== undefined) sum += fx * inv[k];
  }
  return Math.min(4, sum);
}

/** 효과를 한 줄로 — 뽑기 결과 화면과 기록 시트가 쓴다. 효과가 없으면 null */
export function effectSummary(kind: PartKind, loc: Locale): string | null {
  const fx = PART_INFO[kind].effects;
  const out: string[] = [];
  const pct = (v: number): string => `${Math.round(v * 100)}%`;
  if (fx !== undefined) {
    if (fx.prodMult !== undefined) out.push(loc === 'ko' ? `생산 ×${fx.prodMult}` : `Rate ×${fx.prodMult}`);
    if (fx.capacity !== undefined) out.push(loc === 'ko' ? `상한 +${pct(fx.capacity)}` : `Cap +${pct(fx.capacity)}`);
    if (fx.discount !== undefined) out.push(loc === 'ko' ? `뽑기 −${pct(fx.discount)}` : `Draws −${pct(fx.discount)}`);
    if (fx.collect !== undefined) out.push(loc === 'ko' ? `수거 +${pct(fx.collect)}` : `Collect +${pct(fx.collect)}`);
    if (fx.speed !== undefined) out.push(loc === 'ko' ? '항해 속도 ↑' : 'Sails faster');
  }
  // 무게는 effects 가 아니라 별도 필드지만, 플레이어에게는 같은 "이 부품의 성질"이다
  if (partHeft(kind) >= 3) out.push(loc === 'ko' ? '무거움 — 항해 ↓' : 'Heavy — sails slower');
  return out.length > 0 ? out.join(' · ') : null;
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

/** 지금 쓰고 있는 자리. 0.1칸 부품 때문에 소수가 나온다 — 부동소수점 먼지는 여기서 턴다 */
export function usedSlots(inv: Inventory): number {
  const sum = PART_KINDS.reduce((acc, k) => acc + inv[k] * PART_INFO[k].slots, 0);
  return Math.round(sum * 10) / 10;
}

/** 선체 증축으로 늘어난 자리를 포함한 최대 자리 */
export function maxSlots(inv: Inventory, base: number): number {
  return base + inv.hullExtension * (PART_INFO.hullExtension.addsSlots ?? 0);
}

/** 부품에서 나오는 초당 생산량 — 생산 배율(황금 오리 등)까지 곱한 최종값 */
export function productionPerSecond(inv: Inventory, base: number): number {
  const flat = base + PART_KINDS.reduce((sum, k) => sum + inv[k] * PART_INFO[k].production, 0);
  return flat * prodMultiplier(inv);
}

/** 밤에 배를 밝히는 총량 — 0이면 배가 어둠에 잠긴다 */
export function lightLevel(inv: Inventory): number {
  return PART_KINDS.reduce((sum, k) => sum + inv[k] * (PART_INFO[k].light ?? 0), 0);
}

/** 자리를 비우려고 뽑아낼 수 있는 부품. 따개비류(weight 0)는 뗄 수 없다 — 그게 유머다 */
export function removableKinds(inv: Inventory): PartKind[] {
  return PART_KINDS.filter(
    (k) => inv[k] > 0 && PART_INFO[k].slots > 0 && PART_INFO[k].weight > 0,
  );
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

/** discount 는 부품 효과(조타실)에서 온다 — gachaDiscount() 값을 그대로 넣는다 */
export function gachaCost(tier: PartTier, pulls: number, discount = 0): number {
  const { base, growth } = GACHA[tier];
  return Math.max(1, Math.ceil(base * growth ** Math.max(0, pulls) * (1 - discount)));
}

/** 등급 안에서 가중치로 하나 뽑는다 (weight 0 은 풀에 없다) */
export function rollPart(tier: PartTier, rand: () => number = Math.random): PartKind {
  const pool = gachaKindsOfTier(tier);
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
    id: 'reefRegular',
    name: { ko: '암초 단골', en: 'Reef Regular' },
    hint: { ko: '따개비 6개 — 항해모드에서 암초에 부딪히면 붙는다', en: '6 barnacles — hit reefs while sailing' },
    test: (inv) => inv.barnacle >= 6,
  },
  {
    id: 'gullApartments',
    name: { ko: '갈매기 아파트', en: 'Gull Apartments' },
    hint: { ko: '갈매기 둥지 3개 — 하루 넘게 비우면 하나씩 생긴다', en: '3 gull nests — leave the ship for a day' },
    test: (inv) => inv.gullNest >= 3,
  },
  {
    id: 'runaway',
    name: { ko: '폭주 기관선', en: 'Runaway Engine' },
    hint: { ko: '엔진 8개', en: '8 engines' },
    test: (inv) => inv.engine >= 8,
  },
  {
    id: 'haunted',
    name: { ko: '유령이 사는 배', en: 'Haunted Vessel' },
    hint: { ko: '오래 비운 배에 온다', en: 'Comes to long-abandoned ships' },
    test: (inv) => inv.ghost >= 1,
  },
  {
    id: 'dreadnought',
    name: { ko: '강철 요새', en: 'Steel Dreadnought' },
    hint: { ko: '대형 부품 5개', en: '5 large parts' },
    test: (inv) => kindsOfTier('large').reduce((s, k) => s + inv[k], 0) >= 5,
  },
  {
    id: 'gilded',
    name: { ko: '황금빛 착오', en: 'Gilded Mistake' },
    hint: { ko: '황금 오리 1', en: '1 golden duck' },
    test: (inv) => inv.goldenDuck >= 1,
  },
  {
    id: 'ark',
    name: { ko: '잡동사니 방주', en: 'Junk Ark' },
    hint: { ko: '뽑을 수 있는 모든 종류 2개씩', en: '2 of every drawable kind' },
    test: (inv) => gachaKinds().filter((k) => k !== 'hullExtension').every((k) => inv[k] >= 2),
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
