/**
 * 시간 소스 추상화.
 *
 * 지금은 기기 시각을 그대로 쓰지만, 나중에 Supabase 서버 시각으로 갈아끼울 때
 * 이 인터페이스 구현체 하나만 바꾸면 되도록 격리해 둔다. (CLAUDE.md §5)
 */
export interface Clock {
  /** epoch milliseconds */
  now(): number;
}

/** 기기 시각. 데모 기본값. */
export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

/**
 * 서버 시각 동기 클럭의 자리표시자.
 *
 * 나중에 Supabase 로 옮길 때: 로그인/부팅 시 서버 `now()` 를 한 번 받아
 * 로컬 `performance.now()` 와의 오프셋을 계산해 두고 그 오프셋을 적용한다.
 * 기기 시계를 앞으로 돌리는 치팅을 여기서 막게 된다.
 */
export class OffsetClock implements Clock {
  constructor(private readonly offsetMs: number) {}

  now(): number {
    return Date.now() + this.offsetMs;
  }
}
