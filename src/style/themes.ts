import type { Locale } from '../i18n/index.ts';
import {
  PHASE_COLORS,
  type OceanStops,
  type PaletteKey,
  type Phase,
  type PhaseColors,
  type SkyStops,
} from './palette.ts';

/**
 * 바다 테마.
 *
 * 규칙 하나 때문에 오히려 재미있어졌다: **새 색을 만들 수 없다.** (CLAUDE.md §3.1)
 * 테마는 같은 15색을 다르게 조합한 것뿐이고, 그래서 어떤 테마를 뽑아도
 * 게임 전체가 한 팔레트 안에 머문다 — 스크린샷이 죄다 같은 세계로 보인다.
 *
 * 바꾸는 건 바다와 하늘, 그리고 수평선 섬 색까지. 나머지(구름·조명)는 기본을 물려받는다.
 */
export const THEME_IDS = ['classic', 'emerald', 'rose', 'ember', 'steel', 'abyssal'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

type PhasePatch = {
  ocean?: OceanStops;
  sky?: SkyStops;
  island?: PaletteKey;
};

export interface ThemeDef {
  id: ThemeId;
  name: Record<Locale, string>;
  blurb: Record<Locale, string>;
  /** 뽑기 가중치. classic 은 기본 지급이라 뽑히지 않는다 */
  weight: number;
  patch: Partial<Record<Phase, PhasePatch>>;
}

export const THEMES: Record<ThemeId, ThemeDef> = {
  classic: {
    id: 'classic',
    name: { ko: '푸른 바다', en: 'Blue Sea' },
    blurb: { ko: '처음 떠난 그 바다.', en: 'The sea you started on.' },
    weight: 0,
    patch: {},
  },

  emerald: {
    id: 'emerald',
    name: { ko: '에메랄드 만', en: 'Emerald Bay' },
    blurb: { ko: '얕고 투명한 초록 바다.', en: 'Shallow, clear and green.' },
    weight: 24,
    patch: {
      day: { ocean: { deep: 'abyss', mid: 'moss', crest: 'foam' }, island: 'moss' },
      dawn: { ocean: { deep: 'indigo', mid: 'moss', crest: 'ice' } },
      dusk: { ocean: { deep: 'moss', mid: 'sun', crest: 'cream' }, island: 'moss' },
      night: { ocean: { deep: 'indigo', mid: 'moss', crest: 'foam' } },
    },
  },

  rose: {
    id: 'rose',
    name: { ko: '장밋빛 해협', en: 'Rose Strait' },
    blurb: { ko: '하루 종일 노을 같은 물빛.', en: 'Water that looks like dusk all day.' },
    weight: 22,
    patch: {
      day: {
        sky: { top: 'lilac', mid: 'blossom', bottom: 'ice' },
        ocean: { deep: 'indigo', mid: 'blossom', crest: 'cream' },
        island: 'lilac',
      },
      dawn: { ocean: { deep: 'lilac', mid: 'blossom', crest: 'cream' } },
      dusk: { ocean: { deep: 'blossom', mid: 'coral', crest: 'cream' } },
      night: { ocean: { deep: 'indigo', mid: 'blossom', crest: 'lilac' } },
    },
  },

  ember: {
    id: 'ember',
    name: { ko: '잿불 해역', en: 'Ember Waters' },
    blurb: { ko: '어딘가에서 불이 난 것 같다.', en: 'Something is burning, somewhere.' },
    weight: 16,
    patch: {
      day: {
        sky: { top: 'coral', mid: 'sun', bottom: 'cream' },
        ocean: { deep: 'rust', mid: 'coral', crest: 'sun' },
        island: 'rust',
      },
      dawn: { ocean: { deep: 'rust', mid: 'coral', crest: 'sun' }, island: 'rust' },
      dusk: { ocean: { deep: 'rust', mid: 'coral', crest: 'sun' }, island: 'rust' },
      night: { ocean: { deep: 'rust', mid: 'timber', crest: 'coral' }, island: 'rust' },
    },
  },

  steel: {
    id: 'steel',
    name: { ko: '강철 해협', en: 'Steel Channel' },
    blurb: { ko: '구름 낀 잿빛 바다. 조용하다.', en: 'Overcast and quiet.' },
    weight: 20,
    patch: {
      day: {
        sky: { top: 'lilac', mid: 'steel', bottom: 'ice' },
        ocean: { deep: 'indigo', mid: 'steel', crest: 'ice' },
        island: 'steel',
      },
      dawn: { ocean: { deep: 'indigo', mid: 'steel', crest: 'lilac' }, island: 'steel' },
      dusk: { ocean: { deep: 'indigo', mid: 'steel', crest: 'blossom' }, island: 'steel' },
      night: { ocean: { deep: 'indigo', mid: 'steel', crest: 'ice' }, island: 'steel' },
    },
  },

  abyssal: {
    id: 'abyssal',
    name: { ko: '심해 항로', en: 'Abyssal Route' },
    blurb: { ko: '바닥이 보이지 않는다.', en: 'No bottom in sight.' },
    weight: 10,
    patch: {
      day: {
        sky: { top: 'indigo', mid: 'azure', bottom: 'foam' },
        ocean: { deep: 'indigo', mid: 'abyss', crest: 'azure' },
        island: 'indigo',
      },
      dawn: { ocean: { deep: 'indigo', mid: 'abyss', crest: 'lilac' } },
      dusk: { ocean: { deep: 'indigo', mid: 'abyss', crest: 'blossom' } },
      night: { ocean: { deep: 'indigo', mid: 'abyss', crest: 'foam' } },
    },
  },
};

export function themeName(id: ThemeId, loc: Locale): string {
  return THEMES[id].name[loc];
}

export function themeBlurb(id: ThemeId, loc: Locale): string {
  return THEMES[id].blurb[loc];
}

/** 기본 팔레트에 테마 패치를 얹은 최종 색표 */
export function phaseColorsFor(id: ThemeId): Record<Phase, PhaseColors> {
  const theme = THEMES[id] ?? THEMES.classic;
  const out = {} as Record<Phase, PhaseColors>;
  for (const phase of Object.keys(PHASE_COLORS) as Phase[]) {
    const base = PHASE_COLORS[phase];
    const patch = theme.patch[phase];
    out[phase] =
      patch === undefined
        ? base
        : {
            ...base,
            ...(patch.ocean !== undefined ? { ocean: patch.ocean } : {}),
            ...(patch.sky !== undefined ? { sky: patch.sky } : {}),
            ...(patch.island !== undefined ? { island: patch.island } : {}),
          };
  }
  return out;
}

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && (THEME_IDS as readonly string[]).includes(v);
}

/** 테마 뽑기 — 아직 없는 것 중에서만 나온다 (중복 없음) */
export function rollTheme(owned: readonly ThemeId[], rand: () => number = Math.random): ThemeId | null {
  const pool = THEME_IDS.filter((id) => THEMES[id].weight > 0 && !owned.includes(id));
  if (pool.length === 0) return null;

  const total = pool.reduce((s, id) => s + THEMES[id].weight, 0);
  let ticket = rand() * total;
  for (const id of pool) {
    ticket -= THEMES[id].weight;
    if (ticket <= 0) return id;
  }
  return pool[pool.length - 1]!;
}

/** 테마 뽑기 가격 — 뽑을수록 오른다 */
export const THEME_GACHA = { base: 1500, growth: 1.6 } as const;

export function themeCost(pulls: number): number {
  return Math.ceil(THEME_GACHA.base * THEME_GACHA.growth ** Math.max(0, pulls));
}
