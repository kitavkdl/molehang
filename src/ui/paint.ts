/**
 * 등장 연출 전용 타이밍 헬퍼.
 *
 * `hidden` 을 풀고 **같은 프레임에** 전환 클래스를 붙이면, 브라우저가 시작 상태를
 * 한 번도 그리지 않아 CSS transition 이 통째로 생략된다 — 시트가 슬라이드 없이
 * 툭 나타난다. rAF 한 번으로는 부족하다: rAF 콜백은 다음 페인트 **전에** 돌아서
 * 여전히 같은 스타일 계산에 합쳐질 수 있다. 두 번이면 시작 상태가 반드시
 * 한 번 그려진 뒤다. (돌림판이 이 계급의 버그로 세 번 터졌다 — CLAUDE.md §4.12)
 */
export function afterPaint(fn: () => void): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(fn);
  });
}
