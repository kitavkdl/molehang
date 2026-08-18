import type { Clock } from '../core/clock.ts';
import {
  AVATAR_HATS,
  AVATAR_OUTFITS,
  type AvatarHat,
  type AvatarOutfit,
  type AvatarSpec,
} from '../game/avatar.ts';
import { CREW_MAX, bonusLabel } from '../game/crew.ts';
import type { GameSnapshot } from '../game/game.ts';
import type { CollectLogEntry } from '../game/gateway.ts';
import {
  PART_INFO,
  PART_KINDS,
  SHIP_TITLES,
  effectSummary,
  partBlurb,
  partLabel,
  type PartKind,
} from '../game/parts.ts';
import { locale, t } from '../i18n/index.ts';
import { THEME_IDS, themeName, type ThemeId } from '../style/themes.ts';
import { amount, duration, relative, timestamp } from './format.ts';
import { afterPaint } from './paint.ts';

/**
 * 항해 기록 시트 — 지금 이 배 / 선단 / 칭호 / 수거 기록.
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
  private readonly shipSlots = must('ship-slots');
  private readonly slotFill = must('slot-fill');
  private readonly closeBtn = must('close-sheet');
  private readonly grip = must('sheet-grip');
  private readonly replayBtn = must('replay-tutorial');
  private readonly crewSize = must('crew-size');
  private readonly crewLead = must('crew-lead');
  private readonly crewList = must('crew-list') as HTMLUListElement;
  private readonly crewCode = must('crew-code');
  private readonly crewCopy = must('crew-copy') as HTMLButtonElement;
  private readonly crewJoin = must('crew-join');
  private readonly themeCount = must('theme-count');
  private readonly themeLead = must('theme-lead');
  private readonly themeList = must('theme-list') as HTMLUListElement;
  private readonly themeDraw = must('theme-draw') as HTMLButtonElement;
  private readonly themeDrawLabel = must('theme-draw-label');
  private readonly themeCostEl = must('theme-cost');
  private readonly avatarLead = must('avatar-lead');
  private readonly avatarHatLabel = must('avatar-hat-label');
  private readonly avatarOutfitLabel = must('avatar-outfit-label');
  private readonly avatarHats = must('avatar-hats');
  private readonly avatarOutfits = must('avatar-outfits');

  private open = false;

  constructor(
    private readonly clock: Clock,
    private readonly load: () => Promise<CollectLogEntry[]>,
    private readonly snapshot: () => GameSnapshot,
    onReplayTutorial: () => void,
    private readonly crewActions: {
      code: () => string;
      inviteLink: () => string;
      join: (code: string) => void;
    },
    private readonly themeActions: {
      draw: () => void;
      select: (id: ThemeId) => void;
    },
    private readonly avatarActions: {
      current: () => AvatarSpec;
      setHat: (hat: AvatarHat) => void;
      setOutfit: (outfit: AvatarOutfit) => void;
    },
  ) {
    this.themeDraw.addEventListener('click', () => themeActions.draw());
    this.closeBtn.addEventListener('click', () => this.hide());
    this.scrim.addEventListener('click', () => this.hide());
    this.grip.addEventListener('click', () => this.hide());
    this.replayBtn.addEventListener('click', () => {
      this.hide();
      onReplayTutorial();
    });
    this.crewCopy.addEventListener('click', () => void this.copyInvite());
    this.crewJoin.addEventListener('click', () => {
      const input = globalThis.prompt(t('crew.joinPrompt'));
      if (input !== null && input.trim() !== '') this.crewActions.join(input);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.open) this.hide();
    });
  }

  async show(): Promise<void> {
    await this.refresh();
    this.root.hidden = false;
    this.scrim.hidden = false;
    afterPaint(() => {
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
    const loc = locale();

    // --- 통계 ---
    this.stats.textContent = '';
    this.stats.append(
      stat(t('sheet.statLifetime'), amount(snap.lifetime)),
      stat(t('sheet.statCollects'), t('sheet.times', { n: entries.length })),
      stat(t('sheet.statParts'), amount(snap.partCount)),
    );

    // --- 지금 이 배 ---
    this.shipName.textContent = snap.title.name[loc];
    this.shipHint.textContent = t('sheet.condition', { hint: snap.title.hint[loc] });
    this.shipSlots.textContent = t('ship.slots', { used: snap.slotsUsed, max: snap.slotsMax });
    const ratio = snap.slotsMax > 0 ? Math.min(1, snap.slotsUsed / snap.slotsMax) : 0;
    this.slotFill.style.transform = `scaleX(${ratio.toFixed(3)})`;
    this.slotFill.classList.toggle('is-full', snap.slotsUsed >= snap.slotsMax);

    this.parts.textContent = '';
    const owned = PART_KINDS.filter((k) => snap.parts[k] > 0);
    if (owned.length === 0) {
      const li = document.createElement('li');
      li.className = 'parts__empty';
      li.textContent = t('sheet.noParts');
      this.parts.append(li);
    } else {
      // 생산량이 큰 것부터 — 무엇을 뺄지 판단할 때 이 순서가 제일 쓸모 있다
      const sorted = [...owned].sort(
        (a, b) => PART_INFO[b].production * snap.parts[b] - PART_INFO[a].production * snap.parts[a],
      );
      for (const kind of sorted) this.parts.append(partRow(kind, snap.parts[kind], loc));
    }

    // --- 바다 테마 ---
    this.themeCount.textContent = `${snap.themes.length} / ${THEME_IDS.length}`;
    this.themeLead.textContent =
      snap.themesLeft > 0 ? t('theme.lead') : t('theme.allOwned');
    this.themeCostEl.textContent = amount(snap.themeCost);
    this.themeDrawLabel.textContent = t('theme.draw');
    this.themeDraw.disabled = snap.themesLeft === 0 || snap.scrap < snap.themeCost;
    this.themeCostEl.hidden = snap.themesLeft === 0;

    this.themeList.textContent = '';
    for (const id of THEME_IDS) {
      const owned = snap.themes.includes(id);
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `theme-chip${id === snap.theme ? ' is-active' : ''}${owned ? '' : ' is-locked'}`;
      btn.disabled = !owned;
      btn.textContent = owned ? themeName(id, loc) : '???';
      btn.addEventListener('click', () => {
        if (owned && id !== snap.theme) this.themeActions.select(id);
      });
      li.append(btn);
      this.themeList.append(li);
    }

    // --- 선장 아바타 ---
    this.renderAvatar();

    // --- 선단 ---
    this.crewSize.textContent = `${snap.crewSize} / ${CREW_MAX}`;
    this.crewCode.textContent = this.crewActions.code();
    this.crewLead.textContent =
      snap.crewSize > 1
        ? t('crew.leadTogether', { bonus: bonusLabel(snap.crewSize) })
        : t('crew.leadSolo');

    this.crewList.textContent = '';
    this.crewList.append(crewRow(t('crew.me'), snap.title.name[loc], snap.partCount, true));
    for (const m of snap.crew) {
      this.crewList.append(crewRow(m.name, m.title === '' ? t('crew.sailing') : m.title, m.partCount, false));
    }

    // --- 칭호 ---
    const unlocked = new Set(snap.unlockedTitles);
    this.titlesCount.textContent = `${unlocked.size} / ${SHIP_TITLES.length}`;
    this.titles.textContent = '';
    for (const title of SHIP_TITLES) {
      const got = unlocked.has(title.id);
      const li = document.createElement('li');
      li.className = got ? 'title-row is-got' : 'title-row';

      const name = document.createElement('span');
      name.className = 'title-row__name';
      name.textContent = got ? title.name[loc] : '???';

      const hint = document.createElement('span');
      hint.className = 'title-row__hint';
      hint.textContent = title.hint[loc];

      li.append(name, hint);
      if (title.id === snap.title.id) {
        const badge = document.createElement('span');
        badge.className = 'title-row__now';
        badge.textContent = t('sheet.now');
        li.append(badge);
      }
      this.titles.append(li);
    }

    // --- 수거 기록 ---
    this.empty.hidden = entries.length > 0;
    this.empty.textContent = t('sheet.empty');
    this.list.textContent = '';
    for (const entry of entries) this.list.append(logRow(entry, now));
  }

  /** 모자·옷 색 고르기 — 누르면 그 자리에서 갑판의 내가 갈아입는다 */
  private renderAvatar(): void {
    const spec = this.avatarActions.current();
    this.avatarLead.textContent = t('avatar.lead');
    this.avatarHatLabel.textContent = t('avatar.hat');
    this.avatarOutfitLabel.textContent = t('avatar.outfit');

    this.avatarHats.textContent = '';
    for (const hat of AVATAR_HATS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `theme-chip${hat === spec.hat ? ' is-active' : ''}`;
      btn.textContent = t(`avatar.hat.${hat}`);
      btn.addEventListener('click', () => {
        this.avatarActions.setHat(hat);
        this.renderAvatar();
      });
      this.avatarHats.append(btn);
    }

    this.avatarOutfits.textContent = '';
    for (const outfit of AVATAR_OUTFITS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `avatar-dot${outfit === spec.outfit ? ' is-active' : ''}`;
      // 옷 색 id 가 곧 팔레트 키다 — CSS 변수로 그대로 칠한다
      btn.style.background = `var(--mh-${outfit})`;
      btn.setAttribute('aria-label', outfit);
      btn.addEventListener('click', () => {
        this.avatarActions.setOutfit(outfit);
        this.renderAvatar();
      });
      this.avatarOutfits.append(btn);
    }
  }

  private async copyInvite(): Promise<void> {
    const link = this.crewActions.inviteLink();
    try {
      await navigator.clipboard.writeText(link);
      this.crewCopy.textContent = t('crew.copied');
      globalThis.setTimeout(() => {
        this.crewCopy.textContent = t('crew.copy');
      }, 1600);
    } catch {
      globalThis.prompt(t('crew.copyFallback'), link);
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

function partRow(kind: PartKind, count: number, loc: 'ko' | 'en'): HTMLLIElement {
  const def = PART_INFO[kind];
  const li = document.createElement('li');
  li.className = 'part-row';

  const left = document.createElement('div');
  left.className = 'part-row__text';

  const head = document.createElement('div');
  head.className = 'part-row__head';

  const name = document.createElement('span');
  name.className = 'part-row__name';
  name.textContent = partLabel(kind, loc);

  const tier = document.createElement('span');
  tier.className = `part-row__tier is-${def.tier}`;
  tier.textContent = t(`gacha.${def.tier}`);

  head.append(name, tier);

  const desc = document.createElement('span');
  desc.className = 'part-row__blurb';
  desc.textContent = partBlurb(kind, loc);

  left.append(head, desc);

  // 생산 외 효과 — 교체 결정의 근거이므로 시트에서도 보인다
  const fx = effectSummary(kind, loc);
  if (fx !== null) {
    const fxEl = document.createElement('span');
    fxEl.className = 'part-row__fx';
    fxEl.textContent = fx;
    left.append(fxEl);
  }

  const right = document.createElement('div');
  right.className = 'part-row__nums';

  const n = document.createElement('span');
  n.className = 'part-row__count';
  n.textContent = `×${count}`;

  const rate = document.createElement('span');
  rate.className = 'part-row__rate';
  rate.textContent =
    def.production > 0
      ? `+${(def.production * count).toFixed(1)}/s · ${def.slots * count}`
      : `— · ${def.slots * count}`;

  right.append(n, rate);
  li.append(left, right);
  return li;
}

function crewRow(name: string, title: string, partCount: number, isSelf: boolean): HTMLLIElement {
  const li = document.createElement('li');
  li.className = isSelf ? 'crew-row is-self' : 'crew-row';

  const who = document.createElement('span');
  who.className = 'crew-row__name';
  who.textContent = name;

  const what = document.createElement('span');
  what.className = 'crew-row__title';
  what.textContent = title;

  const n = document.createElement('span');
  n.className = 'crew-row__parts';
  n.textContent = t('ship.parts', { n: partCount });

  li.append(who, what, n);
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
  ago.textContent =
    entry.sinceMs === null
      ? t('log.first')
      : `${relative(entry.at, now)} · ${t('log.gathered', { t: duration(entry.sinceMs) })}`;

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
