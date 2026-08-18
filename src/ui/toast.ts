import { PART_INFO, type PartKind } from '../game/parts.ts';
import type { ShipTitle } from '../game/parts.ts';

/**
 * 수거 직후 뜨는 짧은 알림.
 *
 * "뭐가 붙었는지"를 즉시 보여주는 게 이 게임의 도파민이다.
 * 파츠는 한 줄로 묶고, 새 칭호는 따로 크게 띄운다.
 */
export class Toasts {
  private readonly root = must('toasts');

  parts(kinds: PartKind[]): void {
    if (kinds.length === 0) return;

    const counted = new Map<PartKind, number>();
    for (const k of kinds) counted.set(k, (counted.get(k) ?? 0) + 1);

    const el = document.createElement('div');
    el.className = 'toast';
    for (const [kind, n] of counted) {
      const tag = document.createElement('span');
      tag.className = 'toast__part';
      tag.textContent = n > 1 ? `${PART_INFO[kind].label} ×${n}` : PART_INFO[kind].label;
      el.append(tag);
    }
    const suffix = document.createElement('span');
    suffix.className = 'toast__suffix';
    suffix.textContent = '장착';
    el.append(suffix);

    this.push(el, 2600);
  }

  title(title: ShipTitle): void {
    const el = document.createElement('div');
    el.className = 'toast toast--title';

    const label = document.createElement('span');
    label.className = 'toast__label';
    label.textContent = '새 칭호';

    const name = document.createElement('strong');
    name.className = 'toast__name';
    name.textContent = title.name;

    el.append(label, name);
    this.push(el, 4200);
  }

  private push(el: HTMLElement, ms: number): void {
    this.root.append(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
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
