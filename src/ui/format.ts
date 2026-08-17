/** 표시용 포맷터. 로케일은 한국어 고정. */

export function amount(n: number): string {
  return Math.floor(n).toLocaleString('ko-KR');
}

/** "3시간 12분" / "45초" 처럼 사람이 읽는 길이 */
export function duration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  if (d > 0) return h > 0 ? `${d}일 ${h}시간` : `${d}일`;
  if (h > 0) return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
  if (m > 0) return s > 0 && m < 5 ? `${m}분 ${s}초` : `${m}분`;
  return `${s}초`;
}

const TIME_FMT = new Intl.DateTimeFormat('ko-KR', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const DATE_FMT = new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric' });

/** 로그 타임스탬프: 오늘이면 시:분, 아니면 월/일 시:분 */
export function timestamp(at: number): string {
  const d = new Date(at);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  return sameDay ? TIME_FMT.format(d) : `${DATE_FMT.format(d)} ${TIME_FMT.format(d)}`;
}

/** 상대 시각: "방금", "12분 전" */
export function relative(at: number, now: number): string {
  const diff = now - at;
  if (diff < 45_000) return '방금';
  return `${duration(diff)} 전`;
}
