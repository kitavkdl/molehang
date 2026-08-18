/**
 * 첫 방문 튜토리얼.
 *
 * 유휴 게임은 "아무것도 안 해도 쌓인다"는 규칙을 모르면 그냥 배 한 척 있는 화면일 뿐이다.
 * 그래서 무엇이 저절로 일어나는지 / 무엇을 눌러야 하는지 / 왜 다시 와야 하는지 셋만 짚는다.
 */
import { t } from '../i18n/index.ts';
import { afterPaint } from './paint.ts';

const SEEN_KEY = 'molehang.tutorial.v2';

interface Step {
  key: string;
  /** 강조할 요소. null 이면 화면 중앙 */
  target: string | null;
}

/**
 * 가르칠 것은 세 가지뿐이다.
 * (1) 가만히 둬도 쌓인다 (2) 넘치기 전에 수거한다 (3) **자리가 모자란다**.
 * 셋째가 이 게임의 유일한 결정이라 제일 공들여 설명한다.
 */
const STEPS: Step[] = [
  { key: 'welcome', target: null },
  { key: 'idle', target: '#stock' },
  { key: 'collect', target: '#collect' },
  { key: 'draw', target: '#draws' },
  { key: 'space', target: '#title-badge' },
  { key: 'crew', target: '#open-sheet' },
];

export class Tutorial {
  private readonly root = must('tutorial');
  private readonly spot = must('tutorial-spot');
  private readonly card = must('tutorial-card');
  private readonly stepLabel = must('tutorial-step');
  private readonly titleEl = must('tutorial-title');
  private readonly bodyEl = must('tutorial-body');
  private readonly nextBtn = must('tutorial-next') as HTMLButtonElement;
  private readonly skipBtn = must('tutorial-skip');

  private index = 0;
  private active = false;

  constructor(private readonly storage: Storage | null = safeStorage()) {
    this.nextBtn.addEventListener('click', () => this.advance());
    this.skipBtn.addEventListener('click', () => this.finish());
    globalThis.addEventListener('resize', () => {
      if (this.active) this.render();
    });
  }

  /** 처음 온 사람에게만 자동 실행 */
  autoStart(): void {
    if (this.storage?.getItem(SEEN_KEY) === 'done') return;
    this.start();
  }

  start(): void {
    this.index = 0;
    this.active = true;
    this.root.hidden = false;
    afterPaint(() => {
      this.root.classList.add('is-open');
      this.render();
    });
  }

  private advance(): void {
    if (this.index >= STEPS.length - 1) {
      this.finish();
      return;
    }
    this.index += 1;
    this.render();
  }

  private finish(): void {
    this.active = false;
    this.root.classList.remove('is-open');
    try {
      this.storage?.setItem(SEEN_KEY, 'done');
    } catch {
      // 저장 못 해도 튜토리얼은 닫힌다
    }
    globalThis.setTimeout(() => {
      if (!this.active) this.root.hidden = true;
    }, 240);
  }

  private render(): void {
    const step = STEPS[this.index]!;
    this.stepLabel.textContent = `${this.index + 1} / ${STEPS.length}`;
    this.titleEl.textContent = t(`tutorial.${step.key}.title`);
    this.bodyEl.textContent = t(`tutorial.${step.key}.body`);
    this.nextBtn.textContent = t(
      this.index === STEPS.length - 1 ? 'tutorial.start' : 'tutorial.next',
    );
    this.skipBtn.textContent = t('tutorial.skip');

    const target = step.target === null ? null : document.querySelector(step.target);
    if (target === null) {
      this.spot.style.opacity = '0';
      this.card.classList.remove('is-anchored');
      this.card.style.removeProperty('top');
      this.card.style.removeProperty('bottom');
      return;
    }

    const r = target.getBoundingClientRect();
    const pad = 10;
    this.spot.style.opacity = '1';
    this.spot.style.left = `${r.left - pad}px`;
    this.spot.style.top = `${r.top - pad}px`;
    this.spot.style.width = `${r.width + pad * 2}px`;
    this.spot.style.height = `${r.height + pad * 2}px`;

    // 강조 영역을 가리지 않도록 카드를 반대쪽에 붙인다
    const below = r.top + r.height / 2 < globalThis.innerHeight / 2;
    this.card.classList.add('is-anchored');
    if (below) {
      this.card.style.top = `${r.bottom + 22}px`;
      this.card.style.removeProperty('bottom');
    } else {
      this.card.style.bottom = `${globalThis.innerHeight - r.top + 22}px`;
      this.card.style.removeProperty('top');
    }
  }
}

function must(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`[molehang] #${id} 를 찾을 수 없습니다`);
  return el;
}

function safeStorage(): Storage | null {
  try {
    const s = globalThis.localStorage;
    s.setItem('__mh__', '1');
    s.removeItem('__mh__');
    return s;
  } catch {
    return null;
  }
}
