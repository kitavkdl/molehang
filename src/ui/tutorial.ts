/**
 * 첫 방문 튜토리얼.
 *
 * 유휴 게임은 "아무것도 안 해도 쌓인다"는 규칙을 모르면 그냥 배 한 척 있는 화면일 뿐이다.
 * 그래서 무엇이 저절로 일어나는지 / 무엇을 눌러야 하는지 / 왜 다시 와야 하는지 셋만 짚는다.
 */
const SEEN_KEY = 'molehang.tutorial.v1';

interface Step {
  title: string;
  body: string;
  /** 강조할 요소. null 이면 화면 중앙 */
  target: string | null;
}

const STEPS: Step[] = [
  {
    title: '몰래항에 온 걸 환영해요',
    body: '수업이나 회의가 지루한 동안, 이 바다에서는 자원이 알아서 쌓입니다. 할 일은 가끔 들러 수거하는 것뿐이에요.',
    target: null,
  },
  {
    title: '자원은 저절로 쌓여요',
    body: '창을 닫아 두어도 시간은 흐릅니다. 다시 열면 그동안 쌓인 만큼 들어와 있어요. 다만 상한이 있어서, 가득 차면 더는 쌓이지 않습니다.',
    target: '#stock',
  },
  {
    title: '가득 차기 전에 수거',
    body: '넘친 자원은 그냥 사라집니다. 오래 참을수록 한 번에 많이 받지만, 넘치기 전에 와야 해요.',
    target: '#collect',
  },
  {
    title: '부품은 고를 수 없어요',
    body: '수거할 때마다 부품이 무작위로 나오고, 나온 건 전부 그대로 배에 붙습니다. 엔진만 열 개 나오면 엔진이 열 개 달린 배가 됩니다.',
    target: null,
  },
  {
    title: '이상한 배일수록 좋아요',
    body: '이끼만 잔뜩 끼거나 굴뚝만 늘어서면 숨겨진 칭호가 열립니다. 어떤 배가 되는지는 여기서 확인하세요.',
    target: '#open-sheet',
  },
  {
    title: '친구와 같이 켜 두면',
    body: '초대 코드로 선단을 만들면 같이 접속해 있는 동안 축적이 빨라집니다. 게다가 친구가 수거하면 그 부품 하나가 내 배에도 붙어요 — 내 배가 이상해지는 건 대개 친구 탓입니다.',
    target: '#open-sheet',
  },
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
    requestAnimationFrame(() => {
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
    this.titleEl.textContent = step.title;
    this.bodyEl.textContent = step.body;
    this.nextBtn.textContent = this.index === STEPS.length - 1 ? '시작하기' : '다음';

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
