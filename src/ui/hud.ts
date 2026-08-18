import type { GameSnapshot } from '../game/game.ts';
import { amount, duration } from './format.ts';

/** 상시 노출은 최소로: 상단 자원 표시 + 하단 수거 버튼 하나. (CLAUDE.md §4) */
export class Hud {
  private readonly stockAmount = must('stock-amount');
  private readonly stockCap = must('stock-cap');
  private readonly stockFill = must('stock-fill');
  private readonly stockNote = must('stock-note');
  private readonly collectBtn = must('collect') as HTMLButtonElement;
  private readonly collectSub = must('collect-sub');
  private readonly openSheet = must('open-sheet');
  private readonly titleBadge = must('title-badge');
  private readonly titleName = must('title-name');
  private readonly titleParts = must('title-parts');

  private lastShown = -1;
  private lastTitleId = '';

  constructor(handlers: { onCollect: () => void; onOpenLog: () => void }) {
    this.collectBtn.addEventListener('click', () => {
      if (this.collectBtn.disabled) return;
      handlers.onCollect();
    });
    this.openSheet.addEventListener('click', handlers.onOpenLog);
    this.titleBadge.addEventListener('click', handlers.onOpenLog);
  }

  render(snap: GameSnapshot): void {
    const shown = Math.floor(snap.stored);
    if (shown !== this.lastShown) {
      this.stockAmount.textContent = amount(shown);
      this.lastShown = shown;
    }
    this.stockCap.textContent = `/ ${amount(snap.capacity)}`;
    this.stockFill.style.transform = `scaleX(${snap.fill.toFixed(4)})`;

    const full = snap.msUntilFull <= 0;
    this.stockNote.textContent = full
      ? '가득 찼어요 — 넘치기 전에 수거하세요'
      : `가득 차기까지 ${duration(snap.msUntilFull)}`;
    this.stockNote.classList.toggle('is-full', full);

    this.collectBtn.disabled = !snap.canCollect;
    this.collectBtn.classList.toggle('is-full', full);
    this.collectSub.textContent = snap.canCollect ? `${amount(shown)} 담기` : '아직 모이는 중';

    if (snap.title.id !== this.lastTitleId) {
      this.titleName.textContent = snap.title.name;
      // 칭호가 바뀌면 배지가 한 번 반짝인다
      if (this.lastTitleId !== '') {
        this.titleBadge.classList.remove('is-new');
        void this.titleBadge.offsetWidth;
        this.titleBadge.classList.add('is-new');
      }
      this.lastTitleId = snap.title.id;
    }
    this.titleParts.textContent = `파츠 ${amount(snap.partCount)}`;
  }

  /** 수거 순간 버튼 피드백 */
  pulse(): void {
    this.collectBtn.classList.remove('is-pulsing');
    // 리플로우를 강제해 애니메이션을 재시작
    void this.collectBtn.offsetWidth;
    this.collectBtn.classList.add('is-pulsing');
  }
}

function must(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`[molehang] #${id} 를 찾을 수 없습니다`);
  return el;
}
