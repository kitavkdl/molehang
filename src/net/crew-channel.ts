import { sanitizeAvatar, type AvatarSpec } from '../game/avatar.ts';
import {
  CREW_MAX,
  giftFromCollect,
  type CrewGift,
  type CrewMember,
} from '../game/crew.ts';
import type { PartKind } from '../game/parts.ts';

/**
 * 선단 통신 경계.
 *
 * 지금 구현체는 `BroadcastChannel` 이라 **같은 브라우저의 다른 탭/창끼리만** 연결된다.
 * 진짜 친구(다른 기기)와 붙이려면 이 인터페이스를 Supabase Realtime 구현체로
 * 갈아끼우면 된다 — 게임 쪽 코드는 한 줄도 안 바뀐다. (CLAUDE.md §5)
 *
 * 프로토콜은 아주 단순하다.
 *   ping    : 3초마다 내 상태를 알린다 (이름/칭호/파츠 수)
 *   bye     : 창을 닫을 때
 *   collect : 수거했다고 알린다 → 받는 쪽이 각자 자기 선물을 굴린다
 */

export interface CrewProfile {
  name: string;
  title: string;
  partCount: number;
  /** 선장 아바타 — 받은 쪽 갑판에 세울 때 쓴다 */
  avatar: AvatarSpec;
}

export interface CrewChannel {
  readonly selfId: string;
  /** 현재 접속해 있는 선원 (본인 제외) */
  readonly members: CrewMember[];
  join(code: string, profile: CrewProfile): void;
  leave(): void;
  updateProfile(profile: CrewProfile): void;
  announceCollect(amount: number, parts: readonly PartKind[]): void;
  onPresence(cb: (members: CrewMember[]) => void): () => void;
  onGift(cb: (gift: CrewGift) => void): () => void;
  dispose(): void;
}

const PING_MS = 3000;
const STALE_MS = 9000;
const PRUNE_MS = 2000;

type Message =
  | {
      type: 'ping' | 'bye';
      from: string;
      name: string;
      title: string;
      partCount: number;
      avatar?: AvatarSpec;
    }
  | {
      type: 'collect';
      from: string;
      name: string;
      title: string;
      partCount: number;
      avatar?: AvatarSpec;
      amount: number;
      parts: PartKind[];
    };

export class BroadcastCrewChannel implements CrewChannel {
  readonly selfId: string;
  private channel: BroadcastChannel | null = null;
  private code: string | null = null;
  private profile: CrewProfile = {
    name: '나',
    title: '',
    partCount: 0,
    avatar: sanitizeAvatar(null),
  };
  private readonly seen = new Map<string, CrewMember>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  private readonly presenceListeners = new Set<(m: CrewMember[]) => void>();
  private readonly giftListeners = new Set<(g: CrewGift) => void>();

  constructor(selfId: string = crypto.randomUUID()) {
    this.selfId = selfId;
    globalThis.addEventListener('pagehide', () => this.leave());
  }

  get members(): CrewMember[] {
    return [...this.seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }

  join(code: string, profile: CrewProfile): void {
    this.leave();
    if (typeof BroadcastChannel === 'undefined') return;

    this.code = code;
    this.profile = profile;
    this.channel = new BroadcastChannel(`molehang.crew.${code}`);
    this.channel.onmessage = (e: MessageEvent<Message>) => this.receive(e.data);

    this.ping();
    this.pingTimer = setInterval(() => this.ping(), PING_MS);
    this.pruneTimer = setInterval(() => this.prune(), PRUNE_MS);
  }

  leave(): void {
    if (this.channel !== null) {
      this.post({ type: 'bye', from: this.selfId, ...this.profileFields() });
      this.channel.close();
      this.channel = null;
    }
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    if (this.pruneTimer !== null) clearInterval(this.pruneTimer);
    this.pingTimer = null;
    this.pruneTimer = null;
    this.code = null;
    if (this.seen.size > 0) {
      this.seen.clear();
      this.emitPresence();
    }
  }

  updateProfile(profile: CrewProfile): void {
    this.profile = profile;
  }

  announceCollect(amount: number, parts: readonly PartKind[]): void {
    this.post({
      type: 'collect',
      from: this.selfId,
      ...this.profileFields(),
      amount,
      parts: [...parts],
    });
  }

  onPresence(cb: (members: CrewMember[]) => void): () => void {
    this.presenceListeners.add(cb);
    return () => this.presenceListeners.delete(cb);
  }

  onGift(cb: (gift: CrewGift) => void): () => void {
    this.giftListeners.add(cb);
    return () => this.giftListeners.delete(cb);
  }

  dispose(): void {
    this.leave();
    this.presenceListeners.clear();
    this.giftListeners.clear();
  }

  private profileFields(): {
    name: string;
    title: string;
    partCount: number;
    avatar: AvatarSpec;
  } {
    return {
      name: this.profile.name,
      title: this.profile.title,
      partCount: this.profile.partCount,
      avatar: this.profile.avatar,
    };
  }

  private ping(): void {
    this.post({ type: 'ping', from: this.selfId, ...this.profileFields() });
  }

  private post(msg: Message): void {
    try {
      this.channel?.postMessage(msg);
    } catch {
      // 채널이 이미 닫혔으면 무시 — 선단은 어디까지나 덤이다
    }
  }

  private receive(msg: Message): void {
    if (msg.from === this.selfId || this.code === null) return;

    if (msg.type === 'bye') {
      if (this.seen.delete(msg.from)) this.emitPresence();
      return;
    }

    const known = this.seen.has(msg.from);
    // 정원이 찼으면 새 사람은 받지 않는다 (이미 있던 사람 갱신은 계속)
    if (!known && this.seen.size >= CREW_MAX - 1) return;

    // 처음 보는 사람이면 즉시 내 존재를 알린다.
    // 안 그러면 늦게 들어온 쪽은 다음 하트비트(3초)까지 나를 못 본다.
    if (!known) this.ping();

    this.seen.set(msg.from, {
      id: msg.from,
      name: msg.name,
      title: msg.title,
      partCount: msg.partCount,
      // 다른 탭이 보낸 값이다 — 옛 버전 탭에는 아예 없을 수도 있다. 반드시 거른다
      avatar: sanitizeAvatar(msg.avatar),
      lastSeen: Date.now(),
    });
    this.emitPresence();

    if (msg.type === 'collect') {
      const gift = giftFromCollect(msg.name, msg.amount);
      for (const fn of this.giftListeners) fn(gift);
    }
  }

  private prune(): void {
    const cutoff = Date.now() - STALE_MS;
    let changed = false;
    for (const [id, m] of this.seen) {
      if (m.lastSeen < cutoff) {
        this.seen.delete(id);
        changed = true;
      }
    }
    if (changed) this.emitPresence();
  }

  private emitPresence(): void {
    const list = this.members;
    for (const fn of this.presenceListeners) fn(list);
  }
}

/** BroadcastChannel 이 없는 환경(구형 사파리 등)용 무해한 대체품 */
export class NoopCrewChannel implements CrewChannel {
  readonly selfId = 'solo';
  readonly members: CrewMember[] = [];
  join(): void {}
  leave(): void {}
  updateProfile(): void {}
  announceCollect(): void {}
  onPresence(): () => void {
    return () => {};
  }
  onGift(): () => void {
    return () => {};
  }
  dispose(): void {}
}

export function createCrewChannel(selfId?: string): CrewChannel {
  return typeof BroadcastChannel === 'undefined'
    ? new NoopCrewChannel()
    : new BroadcastCrewChannel(selfId);
}
