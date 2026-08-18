import type { Clock } from '../core/clock.ts';
import type { GameSnapshot } from '../game/game.ts';
import type { CollectLogEntry } from '../game/gateway.ts';
import { PART_INFO, PART_KINDS, SHIP_TITLES } from '../game/parts.ts';
import { amount, duration, relative, timestamp } from './format.ts';

/**
 * 아래에서 올라오는 시트 — 지금 이 배 / 칭호 / 수거 기록. (CLAUDE.md §4)
 * PC에서는 오른쪽에 붙는 패널이 된다(스타일만 다르고 DOM은 같다).
 */
export class LogSheet {
  private readonly root = must('sheet');
  private readonly scrim = must('scrim');
  private readonly list = must('log') as HTMLUListElement;
  private readonly empty = must('log-empty');
  private readonly stats = must('sheet-stats');
  private readonly parts = must('parts') as HTMLUListElement;
  private readonly titles = must('titles') as HTMLUListElement;
  private readonly titlesCount = must('titles-count');
  private readonly shipName = must('ship-title-name');
  private readonly shipHint = must('ship-title-hint');
  private readonly closeBtn = must('close-sheet');
  private readonly grip = must('sheet-grip');
  private readonly replayBtn = must('replay-tutorial');

  private open = false;

  constructor(
    private readonly clock: Clock,
    private readonly load: () => Promise<CollectLogEntry[]>,
    private readonly snapshot: () => GameSnapshot,
    onReplayTutorial: () => void,
  ) {
    this.closeBtn.addEventListener('click', () => this.hide());
    this.scrim.addEventListener('click', () => this.hide());
    this.grip.addEventListener('click', () => this.hide());
    this.replayBtn.addEventListener('click', () => {
      this.hide();
      onReplayTutorial();
    });
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
    const snap = this.snapshot();
    const now = this.clock.now();

    // --- 통계 ---
    this.stats.textContent = '';
    this.stats.append(
      stat('누적 자원', amount(snap.lifetime)),
      stat('수거', `${entries.length}회`),
      stat('파츠', amount(snap.partCount)),
    );

    // --- 지금 이 배 ---
    this.shipName.textContent = snap.title.name;
    // 힌트는 "지금 파츠 수"가 아니라 "달성 조건"이다 — 상단 배지의 개수와 헷갈리지 않게 명시
    this.shipHint.textContent = `달성 조건 · ${snap.title.hint}`;

    this.parts.textContent = '';
    const owned = PART_KINDS.filter((k) => snap.parts[k] > 0);
    if (owned.length === 0) {
      const li = document.createElement('li');
      li.className = 'parts__empty';
      li.textContent = '아직 아무것도 안 붙었어요';
      this.parts.append(li);
    } else {
      for (const kind of owned) {
        this.parts.append(partRow(PART_INFO[kind].label, snap.parts[kind], PART_INFO[kind].blurb));
      }
    }

    // --- 칭호 ---
    const unlocked = new Set(snap.unlockedTitles);
    this.titlesCount.textContent = `${unlocked.size} / ${SHIP_TITLES.length}`;
    this.titles.textContent = '';
    for (const t of SHIP_TITLES) {
      const got = unlocked.has(t.id);
      const li = document.createElement('li');
      li.className = got ? 'title-row is-got' : 'title-row';

      const name = document.createElement('span');
      name.className = 'title-row__name';
      name.textContent = got ? t.name : '???';

      const hint = document.createElement('span');
      hint.className = 'title-row__hint';
      hint.textContent = t.hint;

      li.append(name, hint);
      if (t.id === snap.title.id) {
        const now_ = document.createElement('span');
        now_.className = 'title-row__now';
        now_.textContent = '지금';
        li.append(now_);
      }
      this.titles.append(li);
    }

    // --- 수거 기록 ---
    this.empty.hidden = entries.length > 0;
    this.list.textContent = '';
    for (const entry of entries) this.list.append(logRow(entry, now));
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

function partRow(label: string, count: number, blurb: string): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'part-row';

  const left = document.createElement('div');
  left.className = 'part-row__text';

  const name = document.createElement('span');
  name.className = 'part-row__name';
  name.textContent = label;

  const desc = document.createElement('span');
  desc.className = 'part-row__blurb';
  desc.textContent = blurb;

  left.append(name, desc);

  const n = document.createElement('span');
  n.className = 'part-row__count';
  n.textContent = `×${count}`;

  li.append(left, n);
  return li;
}

function logRow(entry: CollectLogEntry, now: number): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'log__row';

  const left = document.createElement('div');
  left.className = 'log__when';

  const time = document.createElement('span');
  time.className = 'log__time';
  time.textContent = timestamp(entry.at);

  const ago = document.createElement('span');
  ago.className = 'log__ago';
  const parts =
    entry.parts.length > 0
      ? entry.parts.map((p) => PART_INFO[p].label).join(' · ')
      : '부품 없음';
  ago.textContent =
    entry.sinceMs === null
      ? `첫 수거 · ${parts}`
      : `${relative(entry.at, now)} · ${duration(entry.sinceMs)} 모음 · ${parts}`;

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
