/**
 * 선장 아바타 — 갑판 위에 서 있는 작은 사람.
 *
 * 아바타는 **배가 아니라 사람의 것**이다. 배 저장(gateway)이 아니라 선단 이름과 같은
 * 자리(localStorage, 좌석 접미사)에 산다 — 배를 갈아타도 내 모자는 내 모자다.
 *
 * 선단에 들어가면 프로필에 실려 방송되고(net/crew-channel.ts), 같이 접속해 있는
 * 선원들의 아바타가 **내 배 갑판에도** 나란히 선다. 같은 시간에 켜 둔 사람만
 * 보인다 — 선단의 "같이 있는 동안만" 원칙 그대로다. (CLAUDE.md §4.3)
 *
 * 옷 색 id 는 팔레트 키와 같은 문자열이다. 새 색을 만들 수 있는 경로는 여기에도 없다.
 */

export const AVATAR_OUTFITS = ['coral', 'wave', 'moss', 'sun', 'blossom', 'steel'] as const;
export type AvatarOutfit = (typeof AVATAR_OUTFITS)[number];

export const AVATAR_HATS = ['none', 'cap', 'tricorn', 'bucket'] as const;
export type AvatarHat = (typeof AVATAR_HATS)[number];

export interface AvatarSpec {
  outfit: AvatarOutfit;
  hat: AvatarHat;
}

/** 채널로 들어온 값은 남의 탭이 만든 것이다 — 반드시 거른다 */
export function sanitizeAvatar(raw: unknown): AvatarSpec {
  const fallback: AvatarSpec = { outfit: 'coral', hat: 'none' };
  if (typeof raw !== 'object' || raw === null) return fallback;
  const src = raw as Record<string, unknown>;
  return {
    outfit: (AVATAR_OUTFITS as readonly unknown[]).includes(src.outfit)
      ? (src.outfit as AvatarOutfit)
      : fallback.outfit,
    hat: (AVATAR_HATS as readonly unknown[]).includes(src.hat)
      ? (src.hat as AvatarHat)
      : fallback.hat,
  };
}

/** 첫 방문 — 아무거나 걸치고 시작한다. 마음에 안 들면 바꾸라고 시트에 문이 있다 */
export function randomAvatar(rand: () => number = Math.random): AvatarSpec {
  return {
    outfit: AVATAR_OUTFITS[Math.floor(rand() * AVATAR_OUTFITS.length)]!,
    hat: AVATAR_HATS[Math.floor(rand() * AVATAR_HATS.length)]!,
  };
}

const STORE_KEY = 'molehang.avatar';

/** 선단 이름(crew-session.ts)과 같은 방식의 정체성 저장 — 좌석이 나뉘면 아바타도 나뉜다 */
export class AvatarStore {
  private spec: AvatarSpec;
  private readonly key: string;

  constructor(
    seat: string | null = null,
    private readonly storage: Storage | null = safeStorage(),
  ) {
    this.key = seat === null ? STORE_KEY : `${STORE_KEY}.${seat}`;
    this.spec = this.read();
  }

  get current(): AvatarSpec {
    return { ...this.spec };
  }

  set(patch: Partial<AvatarSpec>): AvatarSpec {
    this.spec = sanitizeAvatar({ ...this.spec, ...patch });
    try {
      this.storage?.setItem(this.key, JSON.stringify(this.spec));
    } catch {
      // 저장 못 해도 이번 세션 동안은 입고 있는다
    }
    return this.current;
  }

  private read(): AvatarSpec {
    try {
      const raw = this.storage?.getItem(this.key);
      if (raw === null || raw === undefined) {
        const fresh = randomAvatar();
        this.storage?.setItem(this.key, JSON.stringify(fresh));
        return fresh;
      }
      return sanitizeAvatar(JSON.parse(raw));
    } catch {
      return randomAvatar();
    }
  }
}

function safeStorage(): Storage | null {
  try {
    const s = globalThis.localStorage;
    s.setItem('__mh__', '1');
    s.removeItem('__mh__');
    return s;
  } catch {
    return null;
  }
}
