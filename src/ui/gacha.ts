import type { GameSnapshot } from '../game/game.ts';
import {
  PART_INFO,
  kindsOfTier,
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
 */
const SPIN_MS = 2100;

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

  private spinning = false;
  private pending: { drawn: PartKind; needsRoom: boolean } | null = null;
  private chosenRemoval: PartKind | null = null;
  private angle = 0;

  constructor(private readonly handlers: GachaHandlers) {
    this.closeBtn.addEventListener('click', () => {
      // 결과가 떠 있는데 닫으면 안 된다 — 나온 건 반드시 장착이다
      if (this.pending !== null || this.spinning) return;
      this.hide();
    });
    this.confirmBtn.addEventListener('click', () => void this.confirm());
  }

  /**
   * 테마 뽑기 — 부품과 같은 돌림판을 쓴다.
   * 결과가 되돌릴 수 없는 건 아니라서(테마는 바꿔 낄 수 있다) 확정 버튼 없이 바로 닫힌다.
   */
  async openTheme(
    labels: string[],
    draw: () => Promise<{ label: string; index: number } | null>,
  ): Promise<void> {
    if (this.spinning || labels.length === 0) return;

    this.pending = null;
    this.result.hidden = true;
    this.room.hidden = true;
    this.confirmBtn.hidden = true;
    this.closeBtn.disabled = true;
    this.title.textContent = t('theme.draw');
    this.note.textContent = t('theme.note');

    this.renderWheel(labels);
    this.root.hidden = false;
    this.scrim.hidden = false;
    requestAnimationFrame(() => {
      this.root.classList.add('is-open');
      this.scrim.classList.add('is-open');
    });

    const outcome = await draw();
    if (outcome === null) {
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
  }

  /** 등급 뽑기를 시작한다 */
  async open(tier: PartTier, snap: GameSnapshot): Promise<void> {
    if (this.spinning) return;
    if (snap.scrap < snap.costs[tier]) {
      this.handlers.onCantAfford();
      return;
    }

    this.pending = null;
    this.chosenRemoval = null;
    this.result.hidden = true;
    this.room.hidden = true;
    this.confirmBtn.hidden = true;
    this.closeBtn.disabled = true;
    this.title.textContent = t(`gacha.${tier}`);
    this.note.textContent = t('gacha.mustEquip');

    this.buildWheel(tier);
    this.root.hidden = false;
    this.scrim.hidden = false;
    requestAnimationFrame(() => {
      this.root.classList.add('is-open');
      this.scrim.classList.add('is-open');
    });

    const outcome = await this.handlers.draw(tier);
    if (outcome === null) {
      this.handlers.onCantAfford();
      this.closeBtn.disabled = false;
      this.hide();
      return;
    }

    await this.spinTo(tier, outcome.drawn);
    this.pending = { drawn: outcome.drawn, needsRoom: outcome.needsRoom };
    this.showResult(outcome.drawn, outcome.needsRoom, outcome.removable);
  }

  private buildWheel(tier: PartTier): void {
    this.renderWheel(kindsOfTier(tier).map((kind) => partLabel(kind, locale())));
  }

  /** 라벨만 받아 돌림판을 그린다 (부품·테마 공용) */
  private renderWheel(labels: string[]): void {
    const pool = labels;
    this.disc.textContent = '';
    const step = 360 / pool.length;

    // 색 조각은 부채꼴로 잘라 내고(clip-path), 글자는 **자르지 않는 별도 층**에 올린다.
    // 글자를 조각 안에 넣으면 되돌려 세우는 순간 잘려 나간다.
    pool.forEach((_label, i) => {
      const slice = document.createElement('div');
      slice.className = `wheel__slice wheel__slice--${i % 4}`;
      slice.style.transform = `rotate(${i * step}deg)`;
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
    });
  }

  /** 뽑힌 부품이 포인터 아래에 멈추도록 각도를 계산해 돌린다 */
  private spinTo(tier: PartTier, drawn: PartKind): Promise<void> {
    const pool = kindsOfTier(tier);
    return this.spinToIndex(pool.length, Math.max(0, pool.indexOf(drawn)));
  }

  private spinToIndex(count: number, index: number): Promise<void> {
    const step = 360 / count;
    // 슬라이스 중앙이 12시(포인터)에 오도록
    const target = 360 - (index * step + step / 2);
    this.angle += 360 * 5 + ((target - (this.angle % 360)) + 360) % 360;

    this.spinning = true;
    this.disc.style.transition = `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.72, 0.12, 1)`;
    this.disc.style.transform = `rotate(${this.angle}deg)`;

    return new Promise((resolve) => {
      globalThis.setTimeout(() => {
        this.spinning = false;
        resolve();
      }, SPIN_MS + 60);
    });
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

function must(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`[molehang] #${id} 를 찾을 수 없습니다`);
  return el;
}
