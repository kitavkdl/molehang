import { t } from '../i18n/index.ts';

/**
 * 항해모드 껍데기 — 배치 모드와 같은 문법을 쓴다.
 *
 * 항해 중에는 수거·뽑기 버튼을 화면에서 치운다. 타륜을 잡은 손가락이 버튼을
 * 스치면 되돌릴 수 없는 사고가 난다(나온 부품은 반드시 장착이므로). §4.7 과 같은 이유.
 */
export class VoyageUi {
  private readonly toggle = must('voyage-toggle');
  private readonly bar = must('voyage-bar');
  private readonly hint = must('voyage-hint');
  private readonly doneBtn = must('voyage-done');
  private readonly dock = document.querySelector<HTMLElement>('.dock');
  private readonly stock = must('stock');

  private active = false;

  constructor(private readonly onChange: (active: boolean) => void) {
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
  }

  private set(active: boolean): void {
    this.active = active;
    this.bar.hidden = !active;
    this.toggle.classList.toggle('is-on', active);
    // 항해 중에는 되돌릴 수 없는 버튼(수거·뽑기)을 화면에서 치운다
    if (this.dock !== null) this.dock.hidden = active;
    this.stock.hidden = active;
    this.hint.textContent = t('voyage.hint');
    this.onChange(active);
  }
}

function must(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`[molehang] #${id} 를 찾을 수 없습니다`);
  return el;
}
