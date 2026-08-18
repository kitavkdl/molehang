import { PART_INFO, partLabel, type PartKind } from '../game/parts.ts';
import { locale, t } from '../i18n/index.ts';

/**
 * 배치 모드 껍데기.
 *
 * 배치 중에는 수거·뽑기를 숨긴다. 부품을 끌고 있는데 손가락이 버튼에 닿아
 * 뽑기가 돌아가면 되돌릴 수 없는 사고가 난다(나온 건 반드시 장착이므로).
 */
export class ArrangeUi {
  private readonly toggle = must('arrange-toggle');
  private readonly bar = must('arrange-bar');
  private readonly hint = must('arrange-hint');
  private readonly doneBtn = must('arrange-done');
  private readonly resetBtn = must('arrange-reset');
  private readonly dock = document.querySelector<HTMLElement>('.dock');
  private readonly stock = must('stock');

  private active = false;

  constructor(handlers: { onChange: (active: boolean) => void; onReset: () => void }) {
    this.toggle.addEventListener('click', () => this.set(!this.active, handlers.onChange));
    this.doneBtn.addEventListener('click', () => this.set(false, handlers.onChange));
    this.resetBtn.addEventListener('click', handlers.onReset);
  }

  get isActive(): boolean {
    return this.active;
  }

  /** 집은 부품 이름을 힌트에 띄운다 */
  showPicked(key: string | null): void {
    if (key === null) {
      this.hint.textContent = t('arrange.hint');
      return;
    }
    const kind = key.split('#')[0] as PartKind;
    if (PART_INFO[kind] === undefined) return;
    this.hint.textContent = t('arrange.moving', { name: partLabel(kind, locale()) });
  }

  refreshLabels(): void {
    this.toggle.textContent = t('arrange.toggle');
    this.doneBtn.textContent = t('arrange.done');
    this.resetBtn.textContent = t('arrange.reset');
    if (!this.active) this.hint.textContent = t('arrange.hint');
  }

  private set(active: boolean, onChange: (a: boolean) => void): void {
    this.active = active;
    this.bar.hidden = !active;
    this.toggle.classList.toggle('is-on', active);
    // 배치 중에는 되돌릴 수 없는 버튼(수거·뽑기)을 화면에서 치운다
    if (this.dock !== null) this.dock.hidden = active;
    this.stock.hidden = active;
    this.hint.textContent = t('arrange.hint');
    onChange(active);
  }
}

function must(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`[molehang] #${id} 를 찾을 수 없습니다`);
  return el;
}
