import { t } from '../i18n/index.ts';

/**
 * 항해모드 껍데기 — 배치 모드와 같은 문법을 쓴다.
 *
 * 항해 중에는 수거·뽑기 버튼을 화면에서 치운다. 타륜을 잡은 손가락이 버튼을
 * 스치면 되돌릴 수 없는 사고가 난다(나온 부품은 반드시 장착이므로). §4.7 과 같은 이유.
 *
 * 속도계는 항해 중에만 rAF 로 돈다 — 씬 루프에 UI 를 끼워 넣지 않고,
 * UI 가 씬의 속도 getter 를 읽어 간다.
 */
export class VoyageUi {
  private readonly toggle = must('voyage-toggle');
  private readonly bar = must('voyage-bar');
  private readonly hint = must('voyage-hint');
  private readonly speedEl = must('voyage-speed');
  private readonly hullLabel = must('voyage-hull-label');
  private readonly hullFill = must('voyage-hull-fill');
  private readonly doneBtn = must('voyage-done');
  private readonly dock = document.querySelector<HTMLElement>('.dock');
  private readonly stock = must('stock');

  private active = false;
  private raf = 0;
  private lastLabel = '';

  constructor(
    private readonly onChange: (active: boolean) => void,
    private readonly speedOf: () => number = () => 0,
    private readonly hullOf: () => number = () => 1,
  ) {
    this.toggle.addEventListener('click', () => this.set(!this.active));
    this.doneBtn.addEventListener('click', () => this.set(false));
  }

  get isActive(): boolean {
    return this.active;
  }

  open(): void {
    if (!this.active) this.set(true);
  }

  close(): void {
    if (this.active) this.set(false);
  }

  refreshLabels(): void {
    this.toggle.textContent = t('voyage.toggle');
    this.doneBtn.textContent = t('voyage.done');
    this.hint.textContent = t('voyage.hint');
    this.hullLabel.textContent = t('voyage.hullLabel');
    this.lastLabel = '';
  }

  private set(active: boolean): void {
    this.active = active;
    // onChange 가 먼저다 — 켤 때 배치 모드를 접는 쪽(main.ts)이 dock 을 되살리는데,
    // 그 뒤에 우리가 숨겨야 최종 상태가 "항해 중 = dock 없음"으로 남는다
    this.onChange(active);
    this.bar.hidden = !active;
    this.toggle.classList.toggle('is-on', active);
    // 항해 중에는 되돌릴 수 없는 버튼(수거·뽑기)을 화면에서 치운다
    if (this.dock !== null) this.dock.hidden = active;
    this.stock.hidden = active;
    this.hint.textContent = t('voyage.hint');

    cancelAnimationFrame(this.raf);
    if (active) this.tick();
  }

  private readonly tick = (): void => {
    if (!this.active) return;
    this.raf = requestAnimationFrame(this.tick);
    // 유닛/초 → 노트 흉내. 숫자가 커야 "달린다"는 기분이 난다
    const label = t('voyage.speed', { n: (this.speedOf() * 2.2).toFixed(1) });
    if (label !== this.lastLabel) {
      this.lastLabel = label;
      this.speedEl.textContent = label;
    }
    // 선체 내구도 — 암초에 긁힐 때마다 줄어드는 게 눈에 보여야 "손상"이 컨텐츠가 된다
    const hull = Math.max(0, Math.min(1, this.hullOf()));
    this.hullFill.style.transform = `scaleX(${hull.toFixed(3)})`;
    this.hullFill.classList.toggle('is-low', hull < 0.4);
  };
}

function must(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`[molehang] #${id} 를 찾을 수 없습니다`);
  return el;
}
