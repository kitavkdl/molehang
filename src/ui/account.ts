import { hasProgress, type PersistedState } from '../game/gateway.ts';
import { t } from '../i18n/index.ts';
import type { Auth } from '../net/auth.ts';
import {
  createShip,
  importLocalShip,
  listShips,
  type ShipSummary,
} from '../net/supabase-gateway.ts';
import { amount } from './format.ts';

/**
 * 계정 패널 — 게스트 / 코드 인증 / 배 목록.
 *
 * 게스트가 기본이고 로그인은 선택이다. 그래서 이 패널은 게임을 막지 않는다.
 * 다만 게스트 기록은 **탭을 닫으면 사라진다.** 그래서 처음 로그인할 때
 * 게스트로 만들던 배를 **묻지 않고 계정으로 옮긴다** — 여기서 "아니오"를 만들면
 * 그 선택이 곧 삭제가 되고, 여태 키운 게 사라지는 게임에는 아무도 로그인하지 않는다.
 */
const SHIP_KEY = 'molehang.ship';

/** 게스트 저장에 닿는 통로. 계정 패널이 게이트웨이 자체를 알 필요는 없다 */
export interface GuestSave {
  snapshot(): PersistedState;
  /** 계정으로 옮긴 뒤 호출 — 게스트 흔적을 지운다 */
  clear(): void;
}

export function selectedShipId(): string | null {
  try {
    return globalThis.localStorage?.getItem(SHIP_KEY);
  } catch {
    return null;
  }
}

export function selectShip(id: string): void {
  try {
    globalThis.localStorage?.setItem(SHIP_KEY, id);
  } catch {
    // 저장 못 하면 이번 세션만 유지된다
  }
}

export class AccountPanel {
  private readonly root = must('account');
  private readonly scrim = must('account-scrim');
  private readonly chip = must('account-chip');
  private readonly chipLabel = must('account-chip-label');
  private readonly closeBtn = must('account-close');

  private readonly guestPane = must('account-guest');
  private readonly codePane = must('account-code');
  private readonly shipsPane = must('account-ships');

  private readonly emailInput = must('account-email') as HTMLInputElement;
  private readonly sendBtn = must('account-send') as HTMLButtonElement;
  private readonly guestHint = must('account-guest-hint');

  private readonly otpInput = must('account-otp') as HTMLInputElement;
  private readonly verifyBtn = must('account-verify') as HTMLButtonElement;
  private readonly codeLead = must('account-code-lead');
  private readonly codeHint = must('account-code-hint');

  private readonly userLine = must('account-user');
  private readonly shipList = must('ship-list') as HTMLUListElement;
  private readonly newShipBtn = must('ship-new') as HTMLButtonElement;
  private readonly shipsHint = must('account-ships-hint');

  private email = '';

  constructor(
    private readonly auth: Auth,
    private readonly guest: GuestSave,
    private readonly onSwitch: () => void,
  ) {
    this.chip.addEventListener('click', () => void this.open());
    this.closeBtn.addEventListener('click', () => this.hide());
    this.scrim.addEventListener('click', () => this.hide());

    this.sendBtn.addEventListener('click', () => void this.send());
    this.verifyBtn.addEventListener('click', () => void this.verify());
    must('account-resend').addEventListener('click', () => void this.send());
    must('account-back').addEventListener('click', () => this.showPane('guest'));
    must('account-signout').addEventListener('click', () => void this.signOut());
    this.newShipBtn.addEventListener('click', () => void this.addShip());

    this.otpInput.addEventListener('input', () => {
      this.otpInput.value = this.otpInput.value.replace(/\D/g, '').slice(0, 6);
      if (this.otpInput.value.length === 6) void this.verify();
    });

    // 키보드로도 막힘 없이 — Enter 제출, Esc 닫기
    this.emailInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void this.send();
    });
    this.otpInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void this.verify();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.root.hidden) this.hide();
    });

    this.auth.onChange(() => this.renderChip());
    this.renderChip();
  }

  renderChip(): void {
    const state = this.auth.current;
    this.chipLabel.textContent =
      state.kind === 'guest' ? t('auth.guest') : state.email.split('@')[0] ?? t('auth.account');
  }

  async open(): Promise<void> {
    this.root.hidden = false;
    this.scrim.hidden = false;
    requestAnimationFrame(() => {
      this.root.classList.add('is-open');
      this.scrim.classList.add('is-open');
    });
    if (this.auth.isSignedIn) await this.showShips();
    else this.showPane('guest');
  }

  hide(): void {
    this.root.classList.remove('is-open');
    this.scrim.classList.remove('is-open');
    globalThis.setTimeout(() => {
      this.root.hidden = true;
      this.scrim.hidden = true;
    }, 240);
  }

  private showPane(pane: 'guest' | 'code' | 'ships'): void {
    this.guestPane.hidden = pane !== 'guest';
    this.codePane.hidden = pane !== 'code';
    this.shipsPane.hidden = pane !== 'ships';
  }

  private async send(): Promise<void> {
    const address = this.emailInput.value.trim() || this.email;
    this.sendBtn.disabled = true;
    this.guestHint.textContent = t('auth.sending');

    const result = await this.auth.sendCode(address);
    this.sendBtn.disabled = false;

    if (!result.ok) {
      this.guestHint.textContent = result.message.startsWith('auth.')
        ? t(result.message)
        : result.message;
      return;
    }

    this.email = address;
    this.guestHint.textContent = '';
    this.codeLead.textContent = t('auth.codeSent', { email: address });
    this.codeHint.textContent = '';
    this.otpInput.value = '';
    this.showPane('code');
    this.otpInput.focus();
  }

  private async verify(): Promise<void> {
    if (this.verifyBtn.disabled) return;
    this.verifyBtn.disabled = true;
    this.codeHint.textContent = t('auth.verifying');

    const result = await this.auth.verifyCode(this.email, this.otpInput.value);
    this.verifyBtn.disabled = false;

    if (!result.ok) {
      this.codeHint.textContent = result.message.startsWith('auth.')
        ? t(result.message)
        : result.message;
      return;
    }

    // 게스트로 키우던 배를 계정으로 옮긴다 — 묻지 않는다.
    // 게스트 기록은 어차피 탭을 닫으면 사라지므로, 물어서 얻는 건 실수로 잃을 기회뿐이다.
    const local = this.guest.snapshot();
    if (hasProgress(local)) {
      const id = await importLocalShip(t('auth.importedName'), local);
      if (id === null) {
        // 못 옮겼으면 게스트 기록을 지우지도, 화면을 갈아엎지도 않는다.
        // 이 탭을 그대로 두면 여태 만들던 배는 살아 있다.
        this.codeHint.textContent = t('auth.importFailed');
        return;
      }
      selectShip(id);
      this.guest.clear();
    }
    await this.showShips();
    this.onSwitch();
  }

  private async signOut(): Promise<void> {
    await this.auth.signOut();
    this.showPane('guest');
    this.onSwitch();
  }

  private async addShip(): Promise<void> {
    const name = globalThis.prompt(t('auth.newShipPrompt'), t('auth.newShipDefault'));
    if (name === null || name.trim() === '') return;
    this.newShipBtn.disabled = true;
    const ship = await createShip(name.trim());
    this.newShipBtn.disabled = false;
    if (ship === null) {
      this.shipsHint.textContent = t('auth.shipFailed');
      return;
    }
    selectShip(ship.id);
    this.onSwitch();
  }

  private async showShips(): Promise<void> {
    this.showPane('ships');
    const state = this.auth.current;
    this.userLine.textContent =
      state.kind === 'signed-in' ? t('auth.signedInAs', { email: state.email }) : '';

    this.shipsHint.textContent = t('auth.loading');
    const ships = await listShips();
    this.shipsHint.textContent = '';

    const current = selectedShipId();
    this.shipList.textContent = '';
    for (const ship of ships) {
      this.shipList.append(this.shipRow(ship, ship.id === current));
    }
  }

  private shipRow(ship: ShipSummary, isCurrent: boolean): HTMLLIElement {
    const li = document.createElement('li');
    li.className = isCurrent ? 'ship-row is-current' : 'ship-row';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ship-row__pick';

    const name = document.createElement('span');
    name.className = 'ship-row__name';
    name.textContent = ship.name;

    const meta = document.createElement('span');
    meta.className = 'ship-row__meta';
    meta.textContent = `${t('ship.parts', { n: ship.partCount })} · ${amount(ship.lifetime)}`;

    btn.append(name, meta);
    if (isCurrent) {
      const now = document.createElement('span');
      now.className = 'title-row__now';
      now.textContent = t('sheet.now');
      btn.append(now);
    }

    btn.addEventListener('click', () => {
      if (isCurrent) return;
      selectShip(ship.id);
      this.onSwitch();
    });

    li.append(btn);
    return li;
  }
}

function must(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`[molehang] #${id} 를 찾을 수 없습니다`);
  return el;
}
