import type { AvatarSpec } from './avatar.ts';

/**
 * 선단(crew) — 친구와 같이 하면 빨라진다.
 *
 * 설계 원칙 세 가지
 *  1. **혼자서도 완결된다.** 선단은 전부 덤이다. 혼자 하는 사람이 막히는 구간이 없어야 한다.
 *  2. **같이 접속해 있는 동안에만** 보너스가 붙는다. 친구를 등록해 두고 방치하는 게 아니라,
 *     같은 시간에 켜 두는 것이 이득이라야 "같이 하는" 게임이 된다.
 *  3. **친구의 수거가 나에게도 이득이 된다.** 친구가 수거하면 그 몫의 12%가 고철 배당으로
 *     내 지갑에 들어온다. 배당은 고철로만 준다 — 그걸로 뭘 뽑을지는 내가 정한다.
 *     (부품을 직접 얹어 주던 초기 방식은 부품이 자리를 먹게 되면서 사고가 됐다. §4.3)
 *
 * 여기에 "같이 있으면 확실히 다르다"를 만드는 체감 레이어 세 가지가 얹힌다.
 * 셋 다 원칙 2를 따른다 — **같이 접속해 있는 동안에만** 켜진다.
 *
 *  - **동행선**: 접속 중인 선원마다 그 사람 옷 색 돛을 단 작은 배가 내 바다에 같이 떠서
 *    나란히 항해한다 (scene/crew-ships.ts). 풍경이다 — 충돌하지 않고 자리를 안 먹는다.
 *  - **만선 콤보**: 친구와 60초 안에 서로 수거하면 양쪽 다 자기 수거량의 30%를
 *    보너스로 더 받는다. "같은 물때에 그물을 올렸다"는 연출.
 *  - **순풍**: 뽑기가 접속 친구 1명당 12%(최대 36%) 확률로 한 등급 위 돌림판로 승급한다.
 *    등급 안의 확률표는 건드리지 않는다 — 황금 오리의 대형 풀 내 ~2%는 그대로다(§4.10).
 *
 * 이 파일은 순수 계산만 담는다. 실제 통신은 net/crew-channel.ts.
 */

/** 본인 포함 최대 인원 */
export const CREW_MAX = 4;

/** 1인 추가당 축적 속도 보너스 */
export const CREW_RATE_BONUS = 0.15;

/** 친구가 수거할 때 나에게 떨어지는 배당 비율 */
export const CREW_SHARE = 0.12;

/** 만선 콤보 — 이 시간 안에 서로 수거하면 콤보다 */
export const CREW_COMBO_WINDOW_MS = 60_000;

/** 만선 콤보 — 자기 수거량에 얹어 받는 비율 */
export const CREW_COMBO_RATE = 0.3;

/** 순풍 — 접속 친구 1명당 뽑기 등급 승급 확률 */
export const CREW_TAILWIND_PER_MATE = 0.12;


export interface CrewMember {
  id: string;
  name: string;
  /** 그 사람 배의 현재 칭호 */
  title: string;
  partCount: number;
  /** 그 사람의 선장 아바타 — 같이 접속해 있는 동안 내 갑판에도 선다 */
  avatar: AvatarSpec;
  /** 마지막 신호 시각 (epoch ms) */
  lastSeen: number;
}

/** 같이 접속해 있는 인원(본인 포함)에 따른 축적 배율 */
export function crewMultiplier(presentCount: number): number {
  const n = Math.max(1, Math.min(CREW_MAX, Math.floor(presentCount)));
  return 1 + CREW_RATE_BONUS * (n - 1);
}

/** "+30%" 같은 표시용 문자열 */
export function bonusLabel(presentCount: number): string {
  const pct = Math.round((crewMultiplier(presentCount) - 1) * 100);
  return pct > 0 ? `+${pct}%` : '';
}

/**
 * 친구 수거 → 나에게 들어오는 것.
 *
 * 예전에는 부품을 직접 얹어 줬지만, 부품은 이제 **자리를 먹는다**.
 * 남이 내 자리를 말없이 차지하면 그건 선물이 아니라 사고다.
 * 그래서 배당은 고철로만 준다 — 그 고철로 뭘 뽑을지는 내가 결정한다.
 */
export interface CrewGift {
  /** 배당 고철 */
  scrap: number;
  fromName: string;
}

export function giftFromCollect(fromName: string, amount: number): CrewGift {
  return { scrap: Math.max(1, Math.round(amount * CREW_SHARE)), fromName };
}

// ---------------------------------------------------------------------------
// 만선 콤보 · 순풍 — 전부 순수 계산
// ---------------------------------------------------------------------------

/** 두 수거 시각이 콤보 창 안에 있는가 */
export function isCombo(myCollectAt: number, mateCollectAt: number): boolean {
  return Math.abs(myCollectAt - mateCollectAt) <= CREW_COMBO_WINDOW_MS;
}

/** 콤보로 얹어 받는 보너스 고철 — 자기 수거량 기준 */
export function comboScrap(myCollectAmount: number): number {
  return Math.max(1, Math.round(myCollectAmount * CREW_COMBO_RATE));
}

/**
 * 순풍 — 뽑기가 한 등급 위로 승급할 확률 (0~0.36).
 * 접속 인원(본인 포함)으로 계산한다. 혼자면 0 — 원칙 2 그대로.
 */
export function tailwindChance(presentCount: number): number {
  const mates = Math.max(0, Math.min(CREW_MAX, Math.floor(presentCount)) - 1);
  return Math.min(0.36, CREW_TAILWIND_PER_MATE * mates);
}

// ---------------------------------------------------------------------------
// 초대 코드
// ---------------------------------------------------------------------------

/** 헷갈리는 글자(0/O, 1/I)를 뺀 문자 집합 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function makeCrewCode(rand: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < 6; i++) out += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  return out;
}

export function normalizeCrewCode(raw: string): string | null {
  const code = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 6) return null;
  for (const ch of code) {
    if (!ALPHABET.includes(ch)) return null;
  }
  return code;
}

/** 친구에게 보낼 초대 링크 */
export function inviteUrl(code: string, base: string): string {
  const url = new URL(base);
  url.search = '';
  url.hash = '';
  url.searchParams.set('crew', code);
  return url.toString();
}

// ---------------------------------------------------------------------------
// 선원 이름
// ---------------------------------------------------------------------------

const NAMES = [
  '앵무새',
  '고등어',
  '해달',
  '갈매기',
  '문어',
  '거북이',
  '가오리',
  '복어',
  '불가사리',
  '해파리',
  '범고래',
  '홍학',
];

export function randomCrewName(rand: () => number = Math.random): string {
  return NAMES[Math.floor(rand() * NAMES.length)]!;
}
