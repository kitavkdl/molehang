import { bonusLabel } from '../game/crew.ts';
import type { GameSnapshot } from '../game/game.ts';
import { PART_TIERS, type PartTier } from '../game/parts.ts';
import { locale, t } from '../i18n/index.ts';
import { amount, duration, slotsLabel } from './format.ts';

/**
 * 상시 노출 UI. (CLAUDE.md §4)
 *
 * 유휴 게임에서 제일 중요한 숫자는 "지금 얼마나 쌓였나"가 아니라
 * **초당 얼마나 벌고 있나**다. 그게 부품 교체 결정의 근거이기 때문에 항상 띄워 둔다.
 */
export class Hud {
  private readonly stockAmount = must('stock-amount');
  private readonly stockCap = must('stock-cap');
  private readonly stockFill = must('stock-fill');
  private readonly stockNote = must('stock-note');
  private readonly stockRate = must('stock-rate');
  private readonly collectBtn = must('collect') as HTMLButtonElement;
  private readonly collectLabel = must('collect-label');
  private readonly collectSub = must('collect-sub');
  private readonly openSheet = must('open-sheet');
  private readonly sheetChipLabel = must('sheet-chip-label');
  private readonly titleBadge = must('title-badge');
  private readonly titleName = must('title-name');
  private readonly titleSlots = must('title-slots');
  private readonly crewChip = must('crew-chip');
  private readonly crewCount = must('crew-count');
  private readonly crewBonus = must('crew-bonus');
  private readonly walletAmount = must('wallet-amount');
  private readonly walletLabel = must('wallet-label');
  private readonly langToggle = must('lang-toggle');

  private readonly drawButtons = new Map<PartTier, HTMLButtonElement>();
  private lastShown = -1;
  private lastTitleId = '';
  private lastCrewSize = -1;
  /** 수거 요청이 게이트웨이(네트워크)를 도는 중 — 버튼이 죽은 척하지 않게 표시한다 */
  private collecting = false;

  constructor(handlers: {
    onCollect: () => void;
    onOpenLog: () => void;
    onDraw: (tier: PartTier) => void;
    onToggleLang: () => void;
  }) {
    this.collectBtn.addEventListener('click', () => {
      if (this.collectBtn.disabled) return;
      handlers.onCollect();
    });
    this.openSheet.addEventListener('click', handlers.onOpenLog);
    this.titleBadge.addEventListener('click', handlers.onOpenLog);
    this.crewChip.addEventListener('click', handlers.onOpenLog);
    this.langToggle.addEventListener('click', handlers.onToggleLang);

    for (const tier of PART_TIERS) {
      const btn = must(`draw-${tier}`) as HTMLButtonElement;
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        handlers.onDraw(tier);
      });
      this.drawButtons.set(tier, btn);
    }
  }

  render(snap: GameSnapshot): void {
    const shown = Math.floor(snap.pending);
    if (shown !== this.lastShown) {
      this.stockAmount.textContent = amount(shown);
      this.lastShown = shown;
    }
    this.stockCap.textContent = `/ ${amount(snap.capacity)}`;
    this.stockFill.style.transform = `scaleX(${snap.fill.toFixed(4)})`;
    this.stockRate.textContent = t('res.perSecond', { n: snap.perSecond.toFixed(1) });

    const full = snap.msUntilFull <= 0;
    this.stockNote.textContent = full
      ? t('res.full')
      : t('res.untilFull', { t: duration(snap.msUntilFull) });
    this.stockNote.classList.toggle('is-full', full);

    this.collectBtn.disabled = !snap.canCollect || this.collecting;
    this.collectBtn.classList.toggle('is-full', full);
    this.collectLabel.textContent = t('res.collect');
    this.collectSub.textContent = snap.canCollect
      ? t('res.collectSub', { n: amount(shown) })
      : t('res.collectIdle');

    // 지갑 · 뽑기
    this.walletAmount.textContent = amount(snap.scrap);
    this.walletLabel.textContent = t('res.name');
    for (const tier of PART_TIERS) {
      const btn = this.drawButtons.get(tier);
      if (btn === undefined) continue;
      const cost = snap.costs[tier];
      btn.querySelector('.draw__name')!.textContent = t(`gacha.${tier}`);
      btn.querySelector('.draw__cost')!.textContent = amount(cost);
      btn.disabled = snap.scrap < cost;
    }

    // 칭호 · 자리
    if (snap.title.id !== this.lastTitleId) {
      this.titleName.textContent = snap.title.name[locale()];
      if (this.lastTitleId !== '') {
        this.titleBadge.classList.remove('is-new');
        void this.titleBadge.offsetWidth;
        this.titleBadge.classList.add('is-new');
      }
      this.lastTitleId = snap.title.id;
    }
    const noRoom = snap.slotsUsed >= snap.slotsMax;
    this.titleSlots.textContent = t('ship.slots', {
      used: slotsLabel(snap.slotsUsed),
      max: slotsLabel(snap.slotsMax),
    });
    this.titleSlots.classList.toggle('is-full', noRoom);

    this.sheetChipLabel.textContent = t('sheet.title');
    this.langToggle.textContent = locale() === 'ko' ? 'EN' : '한';

    // 선단 — 혼자일 때는 아예 숨긴다
    const solo = snap.crewSize <= 1;
    this.crewChip.hidden = solo;
    if (!solo) {
      this.crewCount.textContent = t('crew.chip', { n: snap.crewSize });
      this.crewBonus.textContent = bonusLabel(snap.crewSize);
      if (snap.crewSize !== this.lastCrewSize && this.lastCrewSize !== -1) {
        this.crewChip.classList.remove('is-new');
        void this.crewChip.offsetWidth;
        this.crewChip.classList.add('is-new');
      }
    }
    this.lastCrewSize = snap.crewSize;
  }

  /**
   * 수거 요청이 도는 동안 버튼을 잠그고 일하는 티를 낸다.
   * 로그인 상태에선 수거가 서버를 타서 1~2초 걸린다 — 아무 반응 없는 버튼은
   * "고장"으로 읽히고, 연타를 부른다.
   */
  setCollecting(active: boolean): void {
    this.collecting = active;
    this.collectBtn.classList.toggle('is-working', active);
    if (active) this.collectBtn.disabled = true;
  }

  /** 수거 순간 버튼 피드백 */
  pulse(): void {
    this.collectBtn.classList.remove('is-pulsing');
    void this.collectBtn.offsetWidth;
    this.collectBtn.classList.add('is-pulsing');
  }

  /** 언어가 바뀌면 다음 render 에서 전부 다시 쓰도록 캐시를 비운다 */
  invalidate(): void {
    this.lastShown = -1;
    this.lastTitleId = '';
    this.lastCrewSize = -1;
  }
}

function must(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`[molehang] #${id} 를 찾을 수 없습니다`);
  return el;
}
