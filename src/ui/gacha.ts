import type { GameSnapshot } from '../game/game.ts';
import {
  PART_INFO,
  effectSummary,
  gachaKindsOfTier,
  partBlurb,
  partLabel,
  type PartKind,
  type PartTier,
} from '../game/parts.ts';
import { locale, t } from '../i18n/index.ts';
import { amount } from './format.ts';

/**
 * 뽑기 돌림판.
 *
 * 결과를 즉시 통보하지 않고 **돌아가는 걸 보여 준 뒤** 멈춘다 — 그 2초가 이 게임에서
 * 유일하게 두근거리는 구간이다. 멈춘 다음엔 되돌릴 수 없다: 나온 건 반드시 장착된다.
 * 자리가 모자라면 그 자리에서 "무엇을 뽑아낼지" 고르게 한다.
 *
 * ## 왜 CSS transition 이 아니라 rAF 로 직접 돌리는가 (세 번째 사고 후 결론)
 *
 * transition 은 "시작 상태를 브라우저가 한 번 그렸는가"에 달려 있다. 패널이 hidden 에서
 * 풀리는 프레임과 겹치면 시작 상태를 본 적이 없어 **회전이 통째로 생략**되고, 원판이
 * 결과 각도로 순간이동한다. 강제 리플로우 + rAF 두 번으로 막아 봤지만 기기 사정에 따라
 * 여전히 간헐적으로 터졌다. 매 프레임 각도를 계산해 손으로 넣으면 이 계급의 버그가
 * 아예 존재하지 않는다. 되돌리지 말 것.
 *
 * ## 예열 회전
 *
 * 뽑기 요청(게이트웨이)은 로그인 상태에서 네트워크를 탄다 — 1~2초씩 걸린다.
 * 그동안 원판이 죽은 듯 서 있으면 "고장났다"로 읽히므로, 패널이 열리는 순간부터
 * 천천히 돌기 시작하고 결과가 오면 그 각도에서 이어서 본 스핀에 들어간다.
 */
const SPIN_MS = 2100;
/** 예열 회전 속도 (도/초) — 기대감은 주되 어지럽지는 않게 */
const IDLE_SPIN_SPEED = 140;

export interface GachaHandlers {
  /** 뽑기 실행 — 부품과 자리 부족 여부를 돌려준다 */
  draw: (tier: PartTier) => Promise<{
    drawn: PartKind;
    needsRoom: boolean;
    removable: PartKind[];
  } | null>;
  /** 장착 확정 */
  install: (kind: PartKind, remove: PartKind | null) => Promise<void>;
  /** 고철 부족 */
  onCantAfford: () => void;
}

export class GachaPanel {
  private readonly root = must('gacha');
  private readonly scrim = must('gacha-scrim');
  private readonly title = must('gacha-title');
  private readonly note = must('gacha-note');
  private readonly disc = must('wheel-disc');
  private readonly result = must('gacha-result');
  private readonly resultName = must('gacha-result-name');
  private readonly resultBlurb = must('gacha-result-blurb');
  private readonly resultStats = must('gacha-result-stats');
  private readonly room = must('gacha-room');
  private readonly roomLead = must('gacha-room-lead');
  private readonly roomList = must('gacha-room-list') as HTMLUListElement;
  private readonly closeBtn = must('gacha-close') as HTMLButtonElement;
  private readonly confirmBtn = must('gacha-confirm') as HTMLButtonElement;

  /**
   * 열자마자 true, 결과가 화면에 앉거나 판이 닫히면 false.
   * 뽑기 요청이 네트워크를 타는 동안(스핀 시작 전)에도 닫기·재진입을 막는다 —
   * 고철은 이미 빠졌는데 스크림 탭으로 판이 사라지는 사고가 실제로 났었다.
   */
  private busy = false;
  private pending: { drawn: PartKind; needsRoom: boolean } | null = null;
  private chosenRemoval: PartKind | null = null;
  private angle = 0;
  private labels: HTMLElement[] = [];
  /** 진행 중인 회전 (예열 또는 본 스핀)의 rAF 핸들 */
  private spinRaf = 0;

  constructor(private readonly handlers: GachaHandlers) {
    this.closeBtn.addEventListener('click', () => this.tryClose());
    // 스크림 탭·Esc 로도 닫힌다 — 단, 결과가 떠 있으면 안 된다(나온 건 반드시 장착이다)
    this.scrim.addEventListener('click', () => this.tryClose());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.root.hidden) this.tryClose();
    });
    this.confirmBtn.addEventListener('click', () => void this.confirm());
  }

  private tryClose(): void {
    if (this.pending !== null || this.busy) return;
    this.hide();
  }

  /**
   * 테마 뽑기 — 부품과 같은 돌림판을 쓴다.
   * 결과가 되돌릴 수 없는 건 아니라서(테마는 바꿔 낄 수 있다) 확정 버튼 없이 바로 닫힌다.
   */
  async openTheme(
    labels: string[],
    draw: () => Promise<{ label: string; index: number } | null>,
  ): Promise<void> {
    if (this.busy || !this.root.hidden || labels.length === 0) return;
    this.busy = true;

    this.pending = null;
    this.result.hidden = true;
    this.room.hidden = true;
    this.confirmBtn.hidden = true;
    this.closeBtn.disabled = true;
    this.title.textContent = t('theme.draw');
    this.note.textContent = t('theme.note');

    this.renderWheel(labels);
    this.show();
    // 뽑기 요청이 도는 동안에도 원판은 바로 돌기 시작한다 — 죽은 화면 금지
    this.startIdleSpin();

    const outcome = await draw();
    if (outcome === null) {
      this.stopSpin();
      this.busy = false;
      this.closeBtn.disabled = false;
      this.hide();
      return;
    }

    await this.spinToIndex(labels.length, outcome.index);
    this.result.hidden = false;
    this.resultName.textContent = t('gacha.result', { name: outcome.label });
    this.resultBlurb.textContent = t('theme.applied');
    this.resultStats.textContent = '';
    this.closeBtn.disabled = false;
    this.busy = false;
  }

  /** 등급 뽑기를 시작한다 */
  async open(tier: PartTier, snap: GameSnapshot): Promise<void> {
    // busy 는 진입 즉시 선다 — 연타로 뽑기가 두 번 결제되는 창을 없앤다
    if (this.busy || !this.root.hidden) return;
    if (snap.scrap < snap.costs[tier]) {
      this.handlers.onCantAfford();
      return;
    }
    this.busy = true;

    this.pending = null;
    this.chosenRemoval = null;
    this.result.hidden = true;
    this.room.hidden = true;
    this.confirmBtn.hidden = true;
    this.closeBtn.disabled = true;
    this.title.textContent = t(`gacha.${tier}`);
    this.note.textContent = t('gacha.mustEquip');

    this.buildWheel(tier);
    this.show();
    this.startIdleSpin();

    const outcome = await this.handlers.draw(tier);
    if (outcome === null) {
      this.stopSpin();
      this.busy = false;
      this.handlers.onCantAfford();
      this.closeBtn.disabled = false;
      this.hide();
      return;
    }

    await this.spinTo(tier, outcome.drawn);
    this.pending = { drawn: outcome.drawn, needsRoom: outcome.needsRoom };
    this.busy = false;
    this.showResult(outcome.drawn, outcome.needsRoom, outcome.removable);
  }

  private show(): void {
    this.root.hidden = false;
    this.scrim.hidden = false;
    requestAnimationFrame(() => {
      this.root.classList.add('is-open');
      this.scrim.classList.add('is-open');
    });
  }

  private buildWheel(tier: PartTier): void {
    // 돌림판에는 뽑힐 수 있는 것만 올린다 — weight 0(항해·방치 전용)이 보이면 사기다
    this.renderWheel(gachaKindsOfTier(tier).map((kind) => partLabel(kind, locale())));
  }

  /** 라벨만 받아 돌림판을 그린다 (부품·테마 공용) */
  private renderWheel(labels: string[]): void {
    const pool = labels;
    this.disc.textContent = '';
    this.labels = [];
    this.stopSpin();

    const step = 360 / pool.length;

    // 색 조각은 부채꼴로 잘라 내고(clip-path), 글자는 **자르지 않는 별도 층**에 올린다.
    // 부채꼴 각도는 조각 수에 따라 매번 계산한다 — 고정 각도를 쓰면 조각 사이가 뚫린다.
    // 조각은 라벨과 같은 중심각(i*step + step/2)에 세워 포인터가 조각 한가운데에 멈추게 한다.
    pool.forEach((_label, i) => {
      const slice = document.createElement('div');
      // 조각 수가 4k+1 이면 첫 조각과 마지막 조각이 같은 색으로 붙는다 — 마지막만 색을 튼다
      const color = i === pool.length - 1 && pool.length % 4 === 1 && pool.length > 1 ? (i + 2) % 4 : i % 4;
      slice.className = `wheel__slice wheel__slice--${color}`;
      slice.style.clipPath = wedgeClip(step);
      slice.style.transform = `rotate(${i * step + step / 2}deg)`;
      this.disc.append(slice);
    });

    // 글자는 중첩 회전 대신 **극좌표로 직접** 놓는다.
    // 회전 안에 회전을 넣으면 위치가 엉키고 잘려서, 계산으로 박아 두는 편이 확실하다.
    const radius = 34; // 원 반지름 대비 %
    pool.forEach((text, i) => {
      const rad = ((i * step + step / 2) * Math.PI) / 180;
      const label = document.createElement('span');
      label.className = 'wheel__label';
      label.style.left = `${50 + Math.sin(rad) * radius}%`;
      label.style.top = `${50 - Math.cos(rad) * radius}%`;
      label.textContent = text;
      this.disc.append(label);
      this.labels.push(label);
    });

    // 지난 스핀의 회전이 남아 있으면 새 판이 기울어진 채 열린다 — 0으로 되감는다
    this.setAngle(0);
  }

  /** 뽑힌 부품이 포인터 아래에 멈추도록 각도를 계산해 돌린다 */
  private spinTo(tier: PartTier, drawn: PartKind): Promise<void> {
    const pool = gachaKindsOfTier(tier);
    return this.spinToIndex(pool.length, Math.max(0, pool.indexOf(drawn)));
  }

  /** disc 는 시계 방향으로, 라벨은 그만큼 반대로 돌려 글자를 항상 똑바로 세운다 */
  private setAngle(angle: number): void {
    this.angle = angle;
    this.disc.style.transform = `rotate(${angle}deg)`;
    for (const label of this.labels) {
      label.style.transform = `translate(-50%, -50%) rotate(${-angle}deg)`;
    }
  }

  private stopSpin(): void {
    cancelAnimationFrame(this.spinRaf);
    this.spinRaf = 0;
  }

  /** 결과를 기다리는 동안의 예열 회전 — 열리는 즉시 돌기 시작한다 */
  private startIdleSpin(): void {
    this.stopSpin();
    let last = performance.now();
    const frame = (now: number): void => {
      this.setAngle(this.angle + ((now - last) / 1000) * IDLE_SPIN_SPEED);
      last = now;
      this.spinRaf = requestAnimationFrame(frame);
    };
    this.spinRaf = requestAnimationFrame(frame);
  }

  /** 지금 각도에서 이어서, 몇 바퀴 돈 뒤 목표 조각 한가운데에 멈춘다 */
  private async spinToIndex(count: number, index: number): Promise<void> {
    this.stopSpin();

    const step = 360 / count;
    // 슬라이스 중앙이 12시(포인터)에 오도록
    const target = 360 - (index * step + step / 2);

    const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    const spinMs = reduced ? 420 : SPIN_MS;
    const turns = reduced ? 1 : 5;

    const from = this.angle;
    const to = from + 360 * turns + (((target - (from % 360)) + 360) % 360);

    await new Promise<void>((resolve) => {
      const t0 = performance.now();
      const frame = (now: number): void => {
        const k = Math.min(1, (now - t0) / spinMs);
        // 급하게 출발해 부드럽게 멈춘다 — 옛 cubic-bezier(0.12, 0.72, 0.12, 1) 의 감각
        const eased = 1 - (1 - k) ** 3.6;
        this.setAngle(from + (to - from) * eased);
        if (k < 1) {
          this.spinRaf = requestAnimationFrame(frame);
          return;
        }
        this.spinRaf = 0;
        resolve();
      };
      this.spinRaf = requestAnimationFrame(frame);
    });

    // 멈춘 원판을 한 박자 보여 준 뒤에 결과를 띄운다
    await delay(140);
  }

  /**
   * 새로고침으로 날아간 뽑기 결과를 복구한다 — 고철은 이미 썼으므로 장착을 끝까지 받아낸다.
   * 돌림판은 스핀 없이 결과 위치에 멈춰 세워 둔다.
   */
  resume(tier: PartTier, kind: PartKind, needsRoom: boolean, removable: PartKind[]): void {
    if (this.busy || !this.root.hidden) return;

    this.pending = null;
    this.chosenRemoval = null;
    this.result.hidden = true;
    this.room.hidden = true;
    this.confirmBtn.hidden = true;
    this.closeBtn.disabled = true;
    this.title.textContent = t(`gacha.${tier}`);
    this.note.textContent = t('gacha.mustEquip');

    this.buildWheel(tier);
    const pool = gachaKindsOfTier(tier);
    const step = 360 / pool.length;
    this.setAngle(360 - (Math.max(0, pool.indexOf(kind)) * step + step / 2));

    this.show();

    this.pending = { drawn: kind, needsRoom };
    this.showResult(kind, needsRoom, removable);
  }

  private showResult(kind: PartKind, needsRoom: boolean, removable: PartKind[]): void {
    const def = PART_INFO[kind];
    const loc = locale();

    this.result.hidden = false;
    this.resultName.textContent = t('gacha.result', { name: partLabel(kind, loc) });
    this.resultBlurb.textContent = partBlurb(kind, loc);

    this.resultStats.textContent = '';
    this.resultStats.append(
      stat(t('gacha.statSlots'), def.addsSlots ? `+${def.addsSlots}` : `${def.slots}`),
      stat(t('gacha.statRate'), def.production > 0 ? `+${def.production.toFixed(1)}/s` : '—'),
    );
    // 생산 외의 효과(할인·상한·수거·속도)가 있으면 셋째 칸으로 보여 준다
    const fx = effectSummary(kind, loc);
    if (fx !== null) this.resultStats.append(stat(t('gacha.statEffect'), fx));

    this.confirmBtn.hidden = false;
    this.closeBtn.disabled = true;

    if (!needsRoom) {
      this.room.hidden = true;
      this.confirmBtn.disabled = false;
      this.confirmBtn.textContent = t('gacha.equip');
      return;
    }

    // 자리가 없다 — 뺄 부품을 고르기 전에는 확정 불가
    this.room.hidden = false;
    this.roomLead.textContent = t('gacha.needRoom');
    this.confirmBtn.disabled = true;
    this.confirmBtn.textContent = t('gacha.equip');
    this.chosenRemoval = null;

    this.roomList.textContent = '';
    for (const candidate of removable) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'room-pick';
      btn.textContent = `${partLabel(candidate, loc)} · ${PART_INFO[candidate].slots}`;
      btn.addEventListener('click', () => {
        this.chosenRemoval = candidate;
        for (const el of this.roomList.querySelectorAll('.room-pick')) {
          el.classList.remove('is-picked');
        }
        btn.classList.add('is-picked');
        this.confirmBtn.disabled = false;
        this.confirmBtn.textContent = t('gacha.replace', { name: partLabel(candidate, loc) });
      });
      li.append(btn);
      this.roomList.append(li);
    }
  }

  private async confirm(): Promise<void> {
    if (this.pending === null) return;
    if (this.pending.needsRoom && this.chosenRemoval === null) return;

    const { drawn } = this.pending;
    const remove = this.pending.needsRoom ? this.chosenRemoval : null;
    this.pending = null;
    this.confirmBtn.hidden = true;
    this.closeBtn.disabled = false;

    await this.handlers.install(drawn, remove);
    this.hide();
  }

  private hide(): void {
    this.root.classList.remove('is-open');
    this.scrim.classList.remove('is-open');
    globalThis.setTimeout(() => {
      if (this.pending === null) {
        this.root.hidden = true;
        this.scrim.hidden = true;
      }
    }, 240);
  }
}

function stat(label: string, value: string): HTMLElement {
  const box = document.createElement('div');
  box.className = 'gacha__stat';
  const v = document.createElement('strong');
  v.textContent = value;
  const l = document.createElement('span');
  l.textContent = label;
  box.append(v, l);
  return box;
}

export function drawButtonLabel(tier: PartTier, cost: number): string {
  return `${t(`gacha.${tier}`)} · ${amount(cost)}`;
}

/**
 * 중심각 stepDeg 의 부채꼴 clip-path.
 * 꼭짓점을 원 밖(반지름의 1.5배)까지 뻗고, 호는 30° 간격으로 쪼개 현이 원 안으로
 * 파고들지 않게 한다 — 원반의 overflow:hidden 이 바깥을 잘라 준다.
 */
function wedgeClip(stepDeg: number): string {
  if (stepDeg >= 360) return 'none';
  const half = stepDeg / 2;
  const r = 75;
  const points = ['50% 50%'];
  const n = Math.max(2, Math.ceil(stepDeg / 30) + 1);
  for (let i = 0; i < n; i++) {
    const a = ((-half + (stepDeg * i) / (n - 1)) * Math.PI) / 180;
    points.push(`${(50 + Math.sin(a) * r).toFixed(2)}% ${(50 - Math.cos(a) * r).toFixed(2)}%`);
  }
  return `polygon(${points.join(', ')})`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function must(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`[molehang] #${id} 를 찾을 수 없습니다`);
  return el;
}
