import type { CrewChannel, CrewProfile } from '../net/crew-channel.ts';
import {
  inviteUrl,
  makeCrewCode,
  normalizeCrewCode,
  randomCrewName,
} from './crew.ts';

/**
 * 내 선단 소속 상태를 붙들고 있는 얇은 층.
 *
 * - 초대 코드는 처음 한 번 만들어 저장한다 (내 항구 번호처럼 계속 같은 값)
 * - `?crew=CODE` 로 들어오면 그 코드로 갈아탄다
 * - 채널 연결/이름 부여를 여기서 처리하고, 게임 로직은 아무것도 모르게 둔다
 */
const CODE_KEY = 'molehang.crew.code';
const NAME_KEY = 'molehang.crew.name';

export class CrewSession {
  private code: string;
  private name: string;

  constructor(
    private readonly channel: CrewChannel,
    seat: string | null = null,
    private readonly storage: Storage | null = safeStorage(),
  ) {
    // 좌석이 나뉘면 이름도 나뉘어야 누가 누군지 보인다
    const nameKey = seat === null ? NAME_KEY : `${NAME_KEY}.${seat}`;
    this.code = this.storage?.getItem(CODE_KEY) ?? makeCrewCode();
    this.name = this.storage?.getItem(nameKey) ?? randomCrewName();
    this.persist(CODE_KEY, this.code);
    this.persist(nameKey, this.name);
  }

  /** URL 의 `?crew=` 를 반영하고 채널에 접속한다 */
  start(params: URLSearchParams, profile: CrewProfile): void {
    const invited = params.get('crew');
    if (invited !== null) {
      const normalized = normalizeCrewCode(invited);
      if (normalized !== null) {
        this.code = normalized;
        this.persist(CODE_KEY, this.code);
      }
    }
    this.channel.join(this.code, { ...profile, name: this.name });
  }

  /** 친구 코드로 갈아타기 */
  join(raw: string, profile: CrewProfile): boolean {
    const normalized = normalizeCrewCode(raw);
    if (normalized === null) return false;
    this.code = normalized;
    this.persist(CODE_KEY, this.code);
    this.channel.join(this.code, { ...profile, name: this.name });
    return true;
  }

  update(profile: CrewProfile): void {
    this.channel.updateProfile({ ...profile, name: this.name });
  }

  get currentCode(): string {
    return this.code;
  }

  get displayName(): string {
    return this.name;
  }

  inviteLink(): string {
    return inviteUrl(this.code, globalThis.location.href);
  }

  private persist(key: string, value: string): void {
    try {
      this.storage?.setItem(key, value);
    } catch {
      // 저장 못 해도 이번 세션 동안은 동작한다
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
