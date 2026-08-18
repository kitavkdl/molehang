/**
 * 파츠 & 시크릿 전직.
 *
 * 규칙: **얻은 파츠는 전부 장착된다.** 고르거나 버릴 수 없다.
 * 엔진만 12개 나오면 엔진 12개가 그대로 배에 붙는다 — 그 우연한 기형이 이 게임의 재미이자
 * 스크린샷 거리다. 그래서 소켓 배치는 개수가 늘어나도 절대 실패하지 않고 쌓이도록 설계돼 있다.
 * (배치는 scene/part-sockets.ts, 여기서는 데이터만 다룬다)
 */

export const PART_KINDS = [
  'engine',
  'window',
  'cannon',
  'chimney',
  'sail',
  'moss',
  'lantern',
  'barrel',
] as const;

export type PartKind = (typeof PART_KINDS)[number];

export interface PartInfo {
  kind: PartKind;
  label: string;
  /** 등장 가중치 — 이끼는 흔하고 대포는 귀하다 */
  weight: number;
  blurb: string;
}

export const PART_INFO: Record<PartKind, PartInfo> = {
  engine: { kind: 'engine', label: '엔진', weight: 16, blurb: '추진력. 많을수록 시끄럽다.' },
  window: { kind: 'window', label: '창문', weight: 16, blurb: '전망. 방수는 별개 문제.' },
  cannon: { kind: 'cannon', label: '대포', weight: 10, blurb: '용도 미상. 일단 달았다.' },
  chimney: { kind: 'chimney', label: '굴뚝', weight: 12, blurb: '연기가 난다. 뭘 태우는지는 모른다.' },
  sail: { kind: 'sail', label: '돛', weight: 12, blurb: '바람을 받는다. 가끔 너무 많이.' },
  moss: { kind: 'moss', label: '이끼', weight: 18, blurb: '가만히 두면 알아서 자란다.' },
  lantern: { kind: 'lantern', label: '등불', weight: 10, blurb: '밤바다에서 빛난다.' },
  barrel: { kind: 'barrel', label: '통', weight: 6, blurb: '안에 뭐가 들었는지는 아무도 모른다.' },
};

/** kind → 개수 */
export type Inventory = Record<PartKind, number>;

export function emptyInventory(): Inventory {
  return {
    engine: 0,
    window: 0,
    cannon: 0,
    chimney: 0,
    sail: 0,
    moss: 0,
    lantern: 0,
    barrel: 0,
  };
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

const TOTAL_WEIGHT = PART_KINDS.reduce((s, k) => s + PART_INFO[k].weight, 0);

/** 가중치 룰렛. rand 는 0~1 (테스트에서 주입 가능) */
export function rollPart(rand: () => number = Math.random): PartKind {
  let ticket = rand() * TOTAL_WEIGHT;
  for (const kind of PART_KINDS) {
    ticket -= PART_INFO[kind].weight;
    if (ticket <= 0) return kind;
  }
  return 'moss';
}

/**
 * 수거량에 따라 파츠를 몇 개 굴릴지. 많이 모아서 수거할수록 이득이 있어야
 * "가득 찰 때까지 참기" 라는 선택이 생긴다.
 */
export function rollCount(amount: number, capacity: number, rand: () => number = Math.random): number {
  const ratio = capacity > 0 ? Math.min(1, amount / capacity) : 0;
  const base = 1 + Math.floor(ratio * 2.4);
  // 마지막 한 개는 확률로 — 매번 같은 개수면 심심하다
  return base + (rand() < ratio * 0.5 ? 1 : 0);
}

export function rollParts(
  amount: number,
  capacity: number,
  rand: () => number = Math.random,
): PartKind[] {
  const n = rollCount(amount, capacity, rand);
  const out: PartKind[] = [];
  for (let i = 0; i < n; i++) out.push(rollPart(rand));
  return out;
}

// ---------------------------------------------------------------------------
// 시크릿 전직
// ---------------------------------------------------------------------------

export interface ShipTitle {
  id: string;
  name: string;
  hint: string;
  /** 희귀할수록 뒤에 둔다 — 여러 조건이 맞으면 마지막 것이 이긴다 */
  test: (inv: Inventory) => boolean;
}

/**
 * 위에서 아래로 갈수록 강한 칭호. 조건을 만족하는 것 중 **가장 아래**가 현재 칭호가 된다.
 */
export const SHIP_TITLES: ShipTitle[] = [
  {
    id: 'raft',
    name: '떠다니는 뗏목',
    hint: '시작은 다 이렇다',
    test: () => true,
  },
  {
    id: 'tidy',
    name: '멀쩡한 배',
    hint: '파츠 6개',
    test: (inv) => totalParts(inv) >= 6,
  },
  {
    id: 'cruiser',
    name: '수상 유람선',
    hint: '창문 7개',
    test: (inv) => inv.window >= 7,
  },
  {
    id: 'pirate',
    name: '해적선',
    hint: '대포 6개',
    test: (inv) => inv.cannon >= 6,
  },
  {
    id: 'steamer',
    name: '증기 괴물',
    hint: '굴뚝 6개',
    test: (inv) => inv.chimney >= 6,
  },
  {
    id: 'lighthouse',
    name: '떠다니는 등대',
    hint: '등불 7개',
    test: (inv) => inv.lantern >= 7,
  },
  {
    id: 'windtower',
    name: '돛의 탑',
    hint: '돛 7개',
    test: (inv) => inv.sail >= 7,
  },
  {
    id: 'ghost',
    name: '이끼 유령선',
    hint: '이끼 10개',
    test: (inv) => inv.moss >= 10,
  },
  {
    id: 'runaway',
    name: '폭주 기관선',
    hint: '엔진 10개',
    test: (inv) => inv.engine >= 10,
  },
  {
    id: 'ark',
    name: '잡동사니 방주',
    hint: '모든 종류 4개씩',
    test: (inv) => PART_KINDS.every((k) => inv[k] >= 4),
  },
  {
    id: 'fortress',
    name: '고철 요새',
    hint: '파츠 60개',
    test: (inv) => totalParts(inv) >= 60,
  },
];

export function currentTitle(inv: Inventory): ShipTitle {
  let found = SHIP_TITLES[0]!;
  for (const t of SHIP_TITLES) {
    if (t.test(inv)) found = t;
  }
  return found;
}

/** 지금 조건을 만족하는 모든 칭호 id (기록용) */
export function unlockedTitleIds(inv: Inventory): string[] {
  return SHIP_TITLES.filter((t) => t.test(inv)).map((t) => t.id);
}
