/** 밸런스 상수. 나중에 서버로 옮길 때 그대로 들고 간다. */
export const GAME_CONFIG = {
  /** 분당 축적량 */
  ratePerMinute: 30,
  /** 저장 상한 — 넘치면 더 안 쌓인다 */
  capacity: 600,
  /** 이 값 미만이면 수거 버튼 비활성 */
  minCollect: 1,
  /** 로그 보관 개수 */
  logLimit: 100,
} as const;

export type GameConfig = typeof GAME_CONFIG;

export const STORAGE_KEY = 'molehang.save.v1';
