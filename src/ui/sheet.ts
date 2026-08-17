import type { Clock } from '../core/clock.ts';
import type { CollectLogEntry } from '../game/gateway.ts';
import { amount, duration, relative, timestamp } from './format.ts';

/** 아래에서 올라오는 시트 — 수거 기록. (CLAUDE.md §4) */
export class LogSheet {
  private readonly root = must('sheet');
  private readonly scrim = must('scrim');
  private readonly list = must('log') as HTMLUListElement;
  private readonly empty = must('log-empty');
  private readonly stats = must('sheet-stats');
  private readonly closeBtn = must('close-sheet');
  private readonly grip = must('sheet-grip');

  private open = false;

  constructor(
    private readonly clock: Clock,
    private readonly load: () => Promise<CollectLogEntry[]>,
  ) {
    this.closeBtn.addEventListener('click', () => this.hide());
    this.scrim.addEventListener('click', () => this.hide());
    this.grip.addEventListener('click', () => this.hide());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.open) this.hide();
    });
  }

  async show(): Promise<void> {
    await this.refresh();
    this.root.hidden = false;
    this.scrim.hidden = false;
    // hidden 해제 직후 한 프레임 뒤에 클래스를 붙여야 트랜지션이 걸린다
    requestAnimationFrame(() => {
      this.root.classList.add('is-open');
      this.scrim.classList.add('is-open');
    });
    this.open = true;
  }

  hide(): void {
    this.root.classList.remove('is-open');
    this.scrim.classList.remove('is-open');
    this.open = false;
    globalThis.setTimeout(() => {
      if (this.open) return;
      this.root.hidden = true;
      this.scrim.hidden = true;
    }, 260);
  }

  async refresh(): Promise<void> {
    const entries = await this.load();
    const now = this.clock.now();

    this.empty.hidden = entries.length > 0;
    this.list.textContent = '';

    if (entries.length > 0) {
      const total = entries[0]!.total;
      const best = entries.reduce((m, e) => Math.max(m, e.amount), 0);
      this.stats.textContent = '';
      this.stats.append(
        stat('누적', amount(total)),
        stat('수거', `${entries.length}회`),
        stat('최고', amount(best)),
      );
    } else {
      this.stats.textContent = '';
    }

    for (const entry of entries) {
      this.list.append(row(entry, now));
    }
  }
}

function stat(label: string, value: string): HTMLElement {
  const box = document.createElement('div');
  box.className = 'stat';
  const v = document.createElement('span');
  v.className = 'stat__value';
  v.textContent = value;
  const l = document.createElement('span');
  l.className = 'stat__label';
  l.textContent = label;
  box.append(v, l);
  return box;
}

function row(entry: CollectLogEntry, now: number): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'log__row';

  const left = document.createElement('div');
  left.className = 'log__when';

  const time = document.createElement('span');
  time.className = 'log__time';
  time.textContent = timestamp(entry.at);

  const ago = document.createElement('span');
  ago.className = 'log__ago';
  ago.textContent =
    entry.sinceMs === null ? '첫 수거' : `${relative(entry.at, now)} · ${duration(entry.sinceMs)} 모음`;

  left.append(time, ago);

  const right = document.createElement('span');
  right.className = 'log__amount';
  right.textContent = `+${amount(entry.amount)}`;

  li.append(left, right);
  return li;
}

function must(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`[molehang] #${id} 를 찾을 수 없습니다`);
  return el;
}
