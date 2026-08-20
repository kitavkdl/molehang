import { t } from '../i18n/index.ts';

/** 항해 UI 가 씬에서 읽어 가는 값들 — 씬 루프에 UI 를 끼워 넣지 않는다 */
export interface VoyageStats {
  speed(): number;
  maxSpeed(): number;
  hull(): number;
  danger(): number;
  trip(): number;
  stick(): { active: boolean; x: number; y: number; dx: number; dy: number };
}

/** 이 속도를 한 번 넘기면 "조작을 익혔다"로 보고 힌트를 서서히 걷는다 */
const HINT_LEARNED_SPEED = 2.2;
const HINT_FADE_DELAY_MS = 2400;

/**
 * 항해모드 껍데기 — 배치 모드와 같은 문법을 쓴다.
 *
 * 항해 중에는 수거·뽑기 버튼을 화면에서 치운다. 타륜을 잡은 손가락이 버튼을
 * 스치면 되돌릴 수 없는 사고가 난다(나온 부품은 반드시 장착이므로). §4.7 과 같은 이유.
 *
 * 계기·조이스틱은 항해 중에만 rAF 로 돈다 — UI 가 씬의 getter 를 읽어 간다.
 * 조이스틱은 **장식**이다: 입력 자체는 캔버스(voyage.ts)가 받고,
 * 여기서는 "어디를 눌렀고 어느 쪽으로 끌고 있는지"를 되비출 뿐이다.
 */
export class VoyageUi {
  private readonly toggle = must('voyage-toggle');
  private readonly bar = must('voyage-bar');
  private readonly hint = must('voyage-hint');
  private readonly speedEl = must('voyage-speed');
  private readonly speedLabel = must('voyage-speed-label');
  private readonly speedFill = must('voyage-speed-fill');
  private readonly hullRow = must('voyage-hull');
  private readonly hullLabel = must('voyage-hull-label');
  private readonly hullNum = must('voyage-hull-num');
  private readonly hullFill = must('voyage-hull-fill');
  private readonly dangerEl = must('voyage-danger');
  private readonly tripEl = must('voyage-trip');
  private readonly doneBtn = must('voyage-done');
  private readonly stickEl = must('voyage-stick');
  private readonly knobEl = must('voyage-stick-knob');
  private readonly flashEl = must('voyage-flash');
  private readonly dock = document.querySelector<HTMLElement>('.dock');
  private readonly stock = must('stock');

  private active = false;
  private raf = 0;
  private lastSpeedLabel = '';
  private lastTripLabel = '';
  /** 힌트 페이드 예약 시각 (performance.now 기준). null = 아직 안 배웠다 */
  private hintFadeAt: number | null = null;

  constructor(
    private readonly onChange: (active: boolean) => void,
    private readonly stats: VoyageStats,
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
    this.speedLabel.textContent = t('voyage.speedLabel');
    this.hullLabel.textContent = t('voyage.hullLabel');
    this.dangerEl.textContent = t('voyage.danger');
    this.lastSpeedLabel = '';
    this.lastTripLabel = '';
  }

  /** 암초 충돌 — 화면 가장자리 플래시 + 선체 게이지가 한 번 튄다 */
  flashHit(): void {
    if (!this.active) return;
    // CSS transition 이 아니라 WAAPI — hidden 프레임과 겹쳐도 생략되지 않는다 (§4.12 와 같은 계급의 함정 회피)
    this.flashEl.animate(
      [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 0 }],
      { duration: 520, easing: 'ease-out' },
    );
    this.hullRow.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(1.14)', offset: 0.3 },
        { transform: 'scale(1)' },
      ],
      { duration: 420, easing: 'ease-out' },
    );
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
    // 힌트는 매 출항마다 다시 보여주고, 조작을 익히면 걷는다
    this.hint.textContent = t('voyage.hint');
    this.hint.classList.remove('is-faded');
    this.hintFadeAt = null;
    this.dangerEl.hidden = true;
    this.stickEl.hidden = true;
    this.lastSpeedLabel = '';
    this.lastTripLabel = '';

    cancelAnimationFrame(this.raf);
    if (active) this.tick();
  }

  private readonly tick = (): void => {
    if (!this.active) return;
    this.raf = requestAnimationFrame(this.tick);

    // 유닛/초 → 노트 흉내. 숫자가 커야 "달린다"는 기분이 난다
    const speed = this.stats.speed();
    const speedLabel = t('voyage.speed', { n: (speed * 2.2).toFixed(1) });
    if (speedLabel !== this.lastSpeedLabel) {
      this.lastSpeedLabel = speedLabel;
      this.speedEl.textContent = speedLabel;
    }
    // 속도 게이지는 "지금 낼 수 있는 최고 속도" 대비 — 꽉 차면 전속이다.
    // 손상·무게로 분모가 줄면 같은 속도라도 게이지가 차오른다: 배 상태가 읽힌다
    const maxSpeed = Math.max(0.1, this.stats.maxSpeed());
    this.speedFill.style.transform = `scaleX(${Math.min(1, speed / maxSpeed).toFixed(3)})`;

    // 선체 내구도 — 암초에 긁힐 때마다 줄어드는 게 눈에 보여야 "손상"이 컨텐츠가 된다
    const hull = Math.max(0, Math.min(1, this.stats.hull()));
    this.hullFill.style.transform = `scaleX(${hull.toFixed(3)})`;
    this.hullFill.classList.toggle('is-low', hull < 0.4);
    this.hullNum.textContent = `${Math.round(hull * 100)}%`;

    // 이번 항해 거리 — 50유닛을 1해리로 친다. 크루징의 "얼마나 왔나" 맛
    const tripLabel = t('voyage.trip', { n: (this.stats.trip() / 50).toFixed(1) });
    if (tripLabel !== this.lastTripLabel) {
      this.lastTripLabel = tripLabel;
      this.tripEl.textContent = tripLabel;
    }

    // 전방 암초 경고 — 씬의 위험도(항로 위에 걸린 암초)가 그대로 배지가 된다
    const danger = this.stats.danger();
    this.dangerEl.hidden = danger < 0.06;
    this.dangerEl.classList.toggle('is-hot', danger > 0.55);

    // 터치 조이스틱 — 누른 자리에 베이스, 끈 방향으로 노브
    const stick = this.stats.stick();
    this.stickEl.hidden = !stick.active;
    if (stick.active) {
      this.stickEl.style.transform = `translate(${stick.x}px, ${stick.y}px)`;
      this.knobEl.style.transform = `translate(${stick.dx}px, ${stick.dy}px)`;
    }

    // 조작을 한 번 익히면 힌트를 걷는다 — 계기판 위의 긴 문장은 소음이 된다
    if (this.hintFadeAt === null) {
      if (speed > HINT_LEARNED_SPEED) this.hintFadeAt = performance.now() + HINT_FADE_DELAY_MS;
    } else if (performance.now() >= this.hintFadeAt) {
      this.hint.classList.add('is-faded');
    }
  };
}

function must(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`[molehang] #${id} 를 찾을 수 없습니다`);
  return el;
}
