import type { PartKind } from './parts.ts';

/**
 * 선단(crew) — 친구와 같이 하면 빨라지고, 배가 더 이상해진다.
 *
 * 설계 원칙 세 가지
 *  1. **혼자서도 완결된다.** 선단은 전부 덤이다. 혼자 하는 사람이 막히는 구간이 없어야 한다.
 *  2. **같이 접속해 있는 동안에만** 보너스가 붙는다. 친구를 등록해 두고 방치하는 게 아니라,
 *     같은 시간에 켜 두는 것이 이득이라야 "같이 하는" 게임이 된다.
 *  3. 속도만 빨라지는 게 아니라 **결과물이 달라진다.** 친구가 수거하면 그 부품 하나가
 *     내 배에도 붙는다. "쟤 때문에 내 배가 엔진 범벅이 됐다" 가 이 게임의 공유 포인트다.
 *
 * 이 파일은 순수 계산만 담는다. 실제 통신은 net/crew-channel.ts.
 */

/** 본인 포함 최대 인원 */
export const CREW_MAX = 4;

/** 1인 추가당 축적 속도 보너스 */
export const CREW_RATE_BONUS = 0.15;

/** 친구가 수거할 때 나에게 떨어지는 배당 비율 */
export const CREW_SHARE = 0.12;

/** 친구의 수거 부품이 내 배에도 붙을 확률 */
export const CREW_PART_CHANCE = 0.5;

export interface CrewMember {
  id: string;
  name: string;
  /** 그 사람 배의 현재 칭호 */
  title: string;
  partCount: number;
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

/** 친구 수거 → 나에게 들어오는 것 */
export interface CrewGift {
  /** 배당 자원 */
  resource: number;
  /** 같이 딸려 오는 부품 (없을 수도 있다) */
  part: PartKind | null;
  fromName: string;
}

export function giftFromCollect(
  fromName: string,
  amount: number,
  parts: readonly PartKind[],
  rand: () => number = Math.random,
): CrewGift {
  const resource = Math.max(1, Math.round(amount * CREW_SHARE));
  const part =
    parts.length > 0 && rand() < CREW_PART_CHANCE
      ? parts[Math.floor(rand() * parts.length)]!
      : null;
  return { resource, part, fromName };
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
