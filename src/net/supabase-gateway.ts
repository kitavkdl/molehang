import { capacityFor, collectFrom } from '../game/accrual.ts';
import { GAME_CONFIG, type GameConfig } from '../game/config.ts';
import type {
  CollectLogEntry,
  CollectOutcome,
  DrawOutcome,
  InstallOutcome,
  MolehangGateway,
  PersistedState,
} from '../game/gateway.ts';
import {
  PART_INFO,
  emptyInventory,
  gachaCost,
  maxSlots,
  productionPerSecond,
  rollPart,
  sanitizeInventory,
  unlockedTitleIds,
  usedSlots,
  type PartKind,
  type PartTier,
} from '../game/parts.ts';
import { sanitizePlacements, sanitizeThemes } from '../game/local-gateway.ts';
import { isThemeId, rollTheme, themeCost, type ThemeId } from '../style/themes.ts';
import { supabase } from './auth.ts';

/**
 * 클라우드 세이브. `LocalGateway` 와 **완전히 같은 인터페이스**라
 * 게임·UI 코드는 어느 쪽이 붙었는지 모른다. (CLAUDE.md §5)
 *
 * 시간의 권위는 서버에 있다 — 축적 정산은 `sync_ship` RPC 가 now() 로 계산한다.
 * 기기 시계를 앞으로 돌려도 소용없다.
 */
export interface ShipSummary {
  id: string;
  name: string;
  lifetime: number;
  partCount: number;
  updatedAt: string;
}

interface ShipRow {
  id: string;
  name: string;
  pending: number | string;
  scrap: number | string;
  lifetime: number | string;
  last_accrued_at: string;
  last_collected_at: string | null;
  parts: unknown;
  pulls: unknown;
  placements: unknown;
  titles: string[] | null;
  theme: unknown;
  themes: unknown;
  theme_pulls: unknown;
  log: unknown;
}

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'string' ? Number.parseFloat(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
};

function toState(row: ShipRow): PersistedState {
  const pulls = (row.pulls ?? {}) as Record<string, unknown>;
  return {
    lastAccruedAt: new Date(row.last_accrued_at).getTime(),
    pending: num(row.pending),
    scrap: num(row.scrap),
    lifetime: num(row.lifetime),
    lastCollectedAt: row.last_collected_at === null ? null : new Date(row.last_collected_at).getTime(),
    parts: sanitizeInventory(row.parts),
    pulls: {
      small: num(pulls.small),
      medium: num(pulls.medium),
      large: num(pulls.large),
    },
    placements: sanitizePlacements(row.placements),
    titles: Array.isArray(row.titles) ? row.titles : [],
    theme: isThemeId(row.theme) ? row.theme : 'classic',
    themes: sanitizeThemes(row.themes),
    themePulls: num(row.theme_pulls),
    log: Array.isArray(row.log) ? (row.log as CollectLogEntry[]) : [],
  };
}

export class SupabaseGateway implements MolehangGateway {
  private state: PersistedState;

  constructor(
    private readonly shipId: string,
    private readonly config: GameConfig = GAME_CONFIG,
    private readonly rand: () => number = Math.random,
  ) {
    this.state = {
      lastAccruedAt: Date.now(),
      pending: 0,
      scrap: 0,
      lifetime: 0,
      lastCollectedAt: null,
      parts: emptyInventory(),
      pulls: { small: 0, medium: 0, large: 0 },
      placements: {},
      titles: [],
      theme: 'classic',
      themes: ['classic'],
      themePulls: 0,
      log: [],
    };
  }

  async load(): Promise<PersistedState> {
    const { data, error } = await supabase()
      .from('ships')
      .select('*')
      .eq('id', this.shipId)
      .single();
    if (error !== null) throw new Error(`[molehang] 배를 불러오지 못했습니다: ${error.message}`);

    this.state = toState(data as ShipRow);
    // 불러온 직후 서버 기준으로 한 번 정산한다 (오프라인 축적)
    return this.sync(Date.now(), 1);
  }

  async sync(_now: number, _multiplier = 1): Promise<PersistedState> {
    const perSecond = productionPerSecond(this.state.parts, this.config.baseProduction);
    const { data, error } = await supabase().rpc('sync_ship', {
      p_ship: this.shipId,
      p_per_second: perSecond,
      p_capacity: capacityFor(perSecond, this.config),
    });
    if (error !== null || data === null) return this.snapshot();

    const row = (Array.isArray(data) ? data[0] : data) as ShipRow;
    this.state = toState(row);
    return this.snapshot();
  }

  async collect(now: number, multiplier = 1): Promise<CollectOutcome> {
    await this.sync(now, multiplier);
    const { taken, left } = collectFrom(this.state.pending, this.config);
    if (taken <= 0) return { state: this.snapshot(), taken: 0, entry: null };

    const entry: CollectLogEntry = {
      id: `${now.toString(36)}-${Math.floor(this.rand() * 1e6).toString(36)}`,
      at: now,
      amount: taken,
      total: this.state.lifetime + taken,
      sinceMs: this.state.lastCollectedAt === null ? null : now - this.state.lastCollectedAt,
    };

    this.state.pending = left;
    this.state.scrap += taken;
    this.state.lifetime = entry.total;
    this.state.lastCollectedAt = now;
    this.state.log = [entry, ...this.state.log].slice(0, this.config.logLimit);

    await this.push({
      pending: this.state.pending,
      scrap: this.state.scrap,
      lifetime: this.state.lifetime,
      last_collected_at: new Date(now).toISOString(),
      log: this.state.log,
    });

    return { state: this.snapshot(), taken, entry };
  }

  // 서버 정산(sync_ship)은 선단 배율을 모른다 — 배율 인자는 인터페이스 호환용으로만 받는다
  async draw(tier: PartTier, now: number, _multiplier = 1): Promise<DrawOutcome> {
    await this.sync(now, 1);
    const cost = gachaCost(tier, this.state.pulls[tier]);
    if (this.state.scrap < cost) return { state: this.snapshot(), drawn: null, needsRoom: false };

    this.state.scrap -= cost;
    this.state.pulls[tier] += 1;
    const drawn = rollPart(tier, this.rand);

    await this.push({ scrap: this.state.scrap, pulls: this.state.pulls });

    const free = maxSlots(this.state.parts, this.config.baseSlots) - usedSlots(this.state.parts);
    return { state: this.snapshot(), drawn, needsRoom: PART_INFO[drawn].slots > free };
  }

  async install(
    kind: PartKind,
    remove: PartKind | null,
    now: number,
    _multiplier = 1,
  ): Promise<InstallOutcome> {
    await this.sync(now, 1);
    if (remove !== null && this.state.parts[remove] > 0) this.state.parts[remove] -= 1;
    this.state.parts[kind] += 1;

    const before = new Set(this.state.titles);
    const unlocked = unlockedTitleIds(this.state.parts);
    const fresh = unlocked.filter((id) => !before.has(id));
    this.state.titles = [...new Set([...this.state.titles, ...unlocked])];

    await this.push({ parts: this.state.parts, titles: this.state.titles });

    return {
      state: this.snapshot(),
      installed: kind,
      removed: remove,
      newTitleId: fresh.length > 0 ? fresh[fresh.length - 1]! : null,
    };
  }

  async drawTheme(): Promise<{ state: PersistedState; drawn: ThemeId | null; soldOut: boolean }> {
    const cost = themeCost(this.state.themePulls);
    const drawn = rollTheme(this.state.themes, this.rand);
    if (drawn === null) return { state: this.snapshot(), drawn: null, soldOut: true };
    if (this.state.scrap < cost) return { state: this.snapshot(), drawn: null, soldOut: false };

    this.state.scrap -= cost;
    this.state.themePulls += 1;
    this.state.themes = [...this.state.themes, drawn];
    this.state.theme = drawn;
    await this.push({
      scrap: this.state.scrap,
      theme_pulls: this.state.themePulls,
      themes: this.state.themes,
      theme: this.state.theme,
    });
    return { state: this.snapshot(), drawn, soldOut: false };
  }

  async setTheme(id: ThemeId): Promise<PersistedState> {
    if (!this.state.themes.includes(id)) return this.snapshot();
    this.state.theme = id;
    await this.push({ theme: id });
    return this.snapshot();
  }

  async setPlacements(
    placements: Record<string, [number, number, number]>,
  ): Promise<PersistedState> {
    this.state.placements = { ...placements };
    await this.push({ placements: this.state.placements });
    return this.snapshot();
  }

  async receiveGift(now: number, scrap: number, _multiplier = 1): Promise<PersistedState> {
    await this.sync(now, 1);
    this.state.scrap += Math.max(0, Math.round(scrap));
    await this.push({ scrap: this.state.scrap });
    return this.snapshot();
  }

  async log(limit = this.config.logLimit): Promise<CollectLogEntry[]> {
    return this.state.log.slice(0, limit).map((e) => ({ ...e }));
  }

  async reset(): Promise<PersistedState> {
    this.state = {
      ...this.state,
      pending: 0,
      scrap: 0,
      lifetime: 0,
      lastCollectedAt: null,
      parts: emptyInventory(),
      pulls: { small: 0, medium: 0, large: 0 },
      titles: [],
      log: [],
    };
    await this.push({
      pending: 0,
      scrap: 0,
      lifetime: 0,
      last_collected_at: null,
      parts: this.state.parts,
      pulls: this.state.pulls,
      titles: [],
      log: [],
    });
    return this.snapshot();
  }

  private async push(patch: Record<string, unknown>): Promise<void> {
    const { error } = await supabase().from('ships').update(patch).eq('id', this.shipId);
    if (error !== null) {
      // 저장 실패가 게임을 멈추면 안 된다 — 다음 정산 때 다시 올라간다
      console.warn('[molehang] 저장 실패', error.message);
    }
  }

  private snapshot(): PersistedState {
    return {
      ...this.state,
      parts: { ...this.state.parts },
      pulls: { ...this.state.pulls },
      titles: [...this.state.titles],
      log: this.state.log.map((e) => ({ ...e })),
    };
  }
}

// ---------------------------------------------------------------------------
// 배 목록 (계정 하나가 여러 척)
// ---------------------------------------------------------------------------

export async function listShips(): Promise<ShipSummary[]> {
  const { data, error } = await supabase()
    .from('ships')
    .select('id, name, lifetime, parts, updated_at')
    .order('created_at', { ascending: true });
  if (error !== null || data === null) return [];

  return data.map((row) => {
    const parts = sanitizeInventory(row.parts);
    return {
      id: String(row.id),
      name: String(row.name),
      lifetime: num(row.lifetime),
      partCount: Object.values(parts).reduce((a, b) => a + b, 0),
      updatedAt: String(row.updated_at),
    };
  });
}

export async function createShip(name: string): Promise<ShipSummary | null> {
  const { data: userData } = await supabase().auth.getUser();
  const userId = userData.user?.id;
  if (userId === undefined) return null;

  const { data, error } = await supabase()
    .from('ships')
    .insert({ user_id: userId, name })
    .select('id, name, lifetime, parts, updated_at')
    .single();
  if (error !== null || data === null) return null;

  return {
    id: String(data.id),
    name: String(data.name),
    lifetime: 0,
    partCount: 0,
    updatedAt: String(data.updated_at),
  };
}

export async function renameShip(id: string, name: string): Promise<void> {
  await supabase().from('ships').update({ name }).eq('id', id);
}

/**
 * 게스트로 놀던 배를 계정으로 통째로 옮긴다.
 *
 * 게스트 기록은 탭을 닫으면 사라지므로, 여기서 빠뜨린 값은 **영영 없어진다.**
 * 그래서 배치·테마·뽑기 횟수까지 `PersistedState` 전부를 넘긴다 —
 * 새 칸이 생기면 여기도 같이 늘려야 한다.
 *
 * 딱 하나, 마지막 정산 시각만 안 보낸다. 시간의 권위는 서버에 있고(CLAUDE.md §5),
 * 기기 시계를 앞당겨 둔 채 로그인하면 그만큼 공짜 축적이 되기 때문이다.
 * 서버는 now() 부터 세기 시작하고, 이미 쌓아 둔 미수거분은 pending 으로 그대로 간다.
 */
export async function importLocalShip(name: string, state: PersistedState): Promise<string | null> {
  const { data: userData } = await supabase().auth.getUser();
  const userId = userData.user?.id;
  if (userId === undefined) return null;

  const { data, error } = await supabase()
    .from('ships')
    .insert({
      user_id: userId,
      name,
      pending: state.pending,
      scrap: state.scrap,
      lifetime: state.lifetime,
      last_collected_at:
        state.lastCollectedAt === null ? null : new Date(state.lastCollectedAt).toISOString(),
      parts: state.parts,
      pulls: state.pulls,
      placements: state.placements,
      titles: state.titles,
      theme: state.theme,
      themes: state.themes,
      theme_pulls: state.themePulls,
      log: state.log,
    })
    .select('id')
    .single();

  if (error !== null || data === null) {
    // 실패를 삼키면 게스트 기록이 조용히 사라진다 — 호출부가 알아야 한다
    console.warn('[molehang] 게스트 배를 계정으로 옮기지 못했습니다', error?.message);
    return null;
  }
  return String(data.id);
}
