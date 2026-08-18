import type { CrewGift } from '../game/crew.ts';
import { PART_INFO, partLabel, type PartKind, type ShipTitle } from '../game/parts.ts';
import { locale, t } from '../i18n/index.ts';
import { amount } from './format.ts';
import { afterPaint } from './paint.ts';

/**
 * 짧은 알림.
 *
 * 뽑기 결과는 돌림판이 크게 보여 주므로, 여기서는 장착이 끝났다는 확인과
 * 새 칭호·선단 배당처럼 "화면 밖에서 일어난 일"만 알린다.
 */
export class Toasts {
  private readonly root = must('toasts');

  installed(kind: PartKind, removed: PartKind | null): void {
    const loc = locale();
    const el = document.createElement('div');
    el.className = 'toast';

    const tag = document.createElement('span');
    tag.className = 'toast__part';
    tag.textContent = partLabel(kind, loc);
    el.append(tag);

    const suffix = document.createElement('span');
    suffix.className = 'toast__suffix';
    suffix.textContent =
      removed === null
        ? t('toast.installed')
        : t('toast.replaced', { name: partLabel(removed, loc) });
    el.append(suffix);

    const rate = PART_INFO[kind].production;
    if (rate > 0) {
      const gain = document.createElement('span');
      gain.className = 'toast__gain';
      gain.textContent = `+${rate.toFixed(1)}/s`;
      el.append(gain);
    }

    this.push(el, 2800);
  }

  /** 친구 수거로 나에게 떨어진 몫 */
  gift(gift: CrewGift): void {
    const el = document.createElement('div');
    el.className = 'toast toast--gift';

    const who = document.createElement('span');
    who.className = 'toast__label';
    who.textContent = t('crew.giftFrom', { name: gift.fromName });

    const body = document.createElement('span');
    body.className = 'toast__gift-body';
    body.textContent = `+${amount(gift.scrap)}`;

    el.append(who, body);
    this.push(el, 3200);
  }

  title(title: ShipTitle): void {
    const el = document.createElement('div');
    el.className = 'toast toast--title';

    const label = document.createElement('span');
    label.className = 'toast__label';
    label.textContent = t('toast.newTitle');

    const name = document.createElement('strong');
    name.className = 'toast__name';
    name.textContent = title.name[locale()];

    el.append(label, name);
    this.push(el, 4200);
  }

  /** 고철 부족처럼 가벼운 거절 */
  warn(message: string): void {
    const el = document.createElement('div');
    el.className = 'toast toast--warn';
    el.textContent = message;
    this.push(el, 2000);
  }

  /** 방치 컨텐츠처럼 "그 사이 배에 생긴 일"을 담담하게 알린다 */
  note(message: string): void {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    this.push(el, 3600);
  }

  private push(el: HTMLElement, ms: number): void {
    this.root.append(el);
    afterPaint(() => el.classList.add('is-in'));
    globalThis.setTimeout(() => {
      el.classList.remove('is-in');
      globalThis.setTimeout(() => el.remove(), 320);
    }, ms);
  }
}

function must(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`[molehang] #${id} 를 찾을 수 없습니다`);
  return el;
}
