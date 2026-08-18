/** 밸런스 상수. 나중에 서버로 옮길 때 그대로 들고 간다. */
export const GAME_CONFIG = {
  /** 부품이 하나도 없을 때의 초당 고철 생산량 */
  baseProduction: 0.5,
  /** 선체 기본 자리 수 — 여기서부터 '무엇을 남길까'가 시작된다 */
  baseSlots: 8,
  /**
   * 상한 = 초당 생산량 × 이 초. 생산이 늘면 상한도 같이 늘어
   * "자리를 비우고 큰 걸 달았더니 금방 넘친다" 는 일이 생기지 않는다.
   */
  capacitySeconds: 1800,
  /** 생산이 0에 가까울 때도 최소한 이만큼은 담긴다 */
  minCapacity: 300,
  /** 이 값 미만이면 수거 버튼 비활성 */
  minCollect: 1,
  /** 로그 보관 개수 */
  logLimit: 100,
} as const;

export type GameConfig = typeof GAME_CONFIG;

export const STORAGE_KEY = 'molehang.save.v2';
