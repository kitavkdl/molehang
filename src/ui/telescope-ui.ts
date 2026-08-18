import { ZOOM } from '../scene/framing.ts';
import { t } from '../i18n/index.ts';

/**
 * 망원경 껍데기 — 오른쪽 가장자리의 배율 슬라이더.
 *
 * 슬라이더 눈금은 **로그**로 배율에 대응한다. 선형으로 두면 1배 근처가 눈금 한 칸에
 * 몰려 미세 조정이 안 되고, 아래쪽 절반이 전부 "거의 다 축소" 가 된다.
 * 로그로 두면 어디를 잡아도 같은 비율만큼 커지고 작아진다.
 *
 * 배율 숫자를 누르면 기본 배율로 돌아온다 — 확대한 채 길을 잃었을 때의 탈출구다.
 */
const STEPS = 1000;
const RATIO = ZOOM.max / ZOOM.min;

function zoomFromSlider(value: number): number {
  return ZOOM.min * RATIO ** (value / STEPS);
}

function sliderFromZoom(zoom: number): number {
  return Math.round((Math.log(zoom / ZOOM.min) / Math.log(RATIO)) * STEPS);
}

export class TelescopeUi {
  private readonly range = must<HTMLInputElement>('scope-range');
  private readonly value = must<HTMLElement>('scope-reset');

  constructor(handlers: { onZoom: (zoom: number) => void; onReset: () => void }) {
    this.range.min = '0';
    this.range.max = String(STEPS);

    this.range.addEventListener('input', () => {
      handlers.onZoom(zoomFromSlider(Number(this.range.value)));
    });
    this.value.addEventListener('click', () => handlers.onReset());
  }

  /** 휠·핀치로 배율이 바뀌었을 때도 슬라이더가 따라와야 한다 */
  render(zoom: number): void {
    const step = String(sliderFromZoom(zoom));
    if (this.range.value !== step) this.range.value = step;
    this.value.textContent = t('scope.value', { n: zoom.toFixed(1) });
    this.value.setAttribute('aria-label', t('scope.reset'));
  }
}

function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id) as T | null;
  if (el === null) throw new Error(`[molehang] #${id} 를 찾을 수 없습니다`);
  return el;
}
