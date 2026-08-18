import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from './supabase-config.ts';

/**
 * 로그인 — 이메일 6자리 코드.
 *
 * 매직 링크가 아니라 **코드**를 쓴다. 수업 중에 몰래 하는 게임인데 메일함을 열고
 * 링크를 눌러 새 탭으로 튕겨 나가면 그 자체로 들키는 동선이다. 코드는 그냥 옮겨 적으면 된다.
 *
 * 게스트로도 전부 즐길 수 있다 — 로그인은 "기기를 옮겨도 남는다"와
 * "배를 여러 척 굴린다"를 위한 것이지, 게임을 잠그는 문이 아니다.
 */
export type AuthState =
  | { kind: 'guest' }
  | { kind: 'signed-in'; userId: string; email: string };

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  client ??= createClient(SUPABASE.url, SUPABASE.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return client;
}

export class Auth {
  private state: AuthState = { kind: 'guest' };
  private readonly listeners = new Set<(s: AuthState) => void>();

  /** 저장된 세션을 복구한다. 없으면 게스트. */
  async restore(): Promise<AuthState> {
    try {
      const { data } = await supabase().auth.getSession();
      this.apply(data.session);
      supabase().auth.onAuthStateChange((_event, session) => this.apply(session));
    } catch {
      // 네트워크가 없으면 게스트로 계속 논다 — 게임이 멈추면 안 된다
      this.state = { kind: 'guest' };
    }
    return this.state;
  }

  get current(): AuthState {
    return this.state;
  }

  get isSignedIn(): boolean {
    return this.state.kind === 'signed-in';
  }

  /** 6자리 코드를 메일로 보낸다. 계정이 없으면 이때 만들어진다. */
  async sendCode(email: string): Promise<{ ok: true } | { ok: false; message: string }> {
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      return { ok: false, message: 'auth.badEmail' };
    }
    const { error } = await supabase().auth.signInWithOtp({
      email: address,
      options: { shouldCreateUser: true },
    });
    return error === null ? { ok: true } : { ok: false, message: error.message };
  }

  /** 받은 코드로 인증을 마친다 */
  async verifyCode(
    email: string,
    code: string,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const token = code.replace(/\D/g, '');
    if (token.length !== 6) return { ok: false, message: 'auth.badCode' };

    const { data, error } = await supabase().auth.verifyOtp({
      email: email.trim(),
      token,
      type: 'email',
    });
    if (error !== null) return { ok: false, message: error.message };
    this.apply(data.session);
    return { ok: true };
  }

  async signOut(): Promise<void> {
    await supabase().auth.signOut();
    this.apply(null);
  }

  onChange(fn: (s: AuthState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private apply(session: Session | null): void {
    this.state =
      session === null
        ? { kind: 'guest' }
        : {
            kind: 'signed-in',
            userId: session.user.id,
            email: session.user.email ?? '',
          };
    for (const fn of this.listeners) fn(this.state);
  }
}
