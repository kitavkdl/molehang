import { Color } from 'three';

/**
 * 몰래항 코어 팔레트 — 15색 고정.
 *
 * 이 파일은 프로젝트 전체 색의 **유일한 출처**다.
 * 씬 머티리얼, 하늘 4단계 보간, 라이트 색, 파츠, CSS 변수까지 전부 여기서 나온다.
 * 다른 파일 어디에도 hex/rgb/hsl 리터럴을 쓰지 않는다. (CLAUDE.md §3.1)
 *
 * 12 → 15 로 늘린 이유: 파츠 시스템에 금속(steel)·이끼(moss)·녹(rust)이 필요한데
 * 기존 12색으로는 전부 바다·하늘 계열이라 부품이 배경에 묻혔다.
 * 색이 더 필요하면 늘리지 말고 아래 15색 중에서 고른다.
 */
export const PALETTE = {
  /** 쨍한 한낮 하늘 */
  azure: '#2FB4F2',
  /** 옅은 하늘 / 수평선 하이라이트 */
  ice: '#B6EDFF',
  /** 햇빛, 자원, 황금빛 */
  sun: '#FFD24C',
  /** 노을 주황 */
  coral: '#FF8A5A',
  /** 노을·새벽 분홍 */
  blossom: '#FF6FA6',
  /** 밤하늘 남보라 */
  indigo: '#3D4BA8',
  /** 트와일라잇 연보라 */
  lilac: '#8C93E8',
  /** 깊은 바다 */
  abyss: '#0E63B0',
  /** 바다 중간 톤 */
  wave: '#2FA3E0',
  /** 물마루 / 포말 */
  foam: '#8AE6F2',
  /** 구름, 돛, 갑판, UI 표면 */
  cream: '#FFF7E6',
  /** 나무 선체 */
  timber: '#E08A4E',
  /** 이끼 — 방치된 배의 상징색 */
  moss: '#6FBF73',
  /** 금속 — 엔진, 대포, 기계류 */
  steel: '#A8B6C9',
  /** 녹슨 쇠 / 짙은 목재 트림 */
  rust: '#B4553A',
} as const;

export type PaletteKey = keyof typeof PALETTE;

/** hex 문자열 (CSS용) */
export const hex = (key: PaletteKey): string => PALETTE[key];

/** 0xRRGGBB 정수 (three.js용) */
export const int = (key: PaletteKey): number => Number.parseInt(PALETTE[key].slice(1), 16);

/** THREE.Color 새 인스턴스 */
export const col = (key: PaletteKey): Color => new Color(int(key));

// ---------------------------------------------------------------------------
// 시간대 (하루 4단계)
// ---------------------------------------------------------------------------

export const PHASES = ['dawn', 'day', 'dusk', 'night'] as const;
export type Phase = (typeof PHASES)[number];

/** 하늘 그라데이션 3스톱 (천정 / 중간 / 수평선) */
export interface SkyStops {
  top: PaletteKey;
  mid: PaletteKey;
  bottom: PaletteKey;
}

/** 바다 톤 스텝 3단계 (골 / 중간 / 마루) */
export interface OceanStops {
  deep: PaletteKey;
  mid: PaletteKey;
  crest: PaletteKey;
}

export interface PhaseColors {
  sky: SkyStops;
  ocean: OceanStops;
  /** 수평선 실루엣(먼 섬) */
  island: PaletteKey;
  cloud: PaletteKey;
  /** 방향광 색 */
  sunLight: PaletteKey;
  /** 헤미스피어 위쪽 */
  hemiSky: PaletteKey;
  /** 헤미스피어 아래쪽(바운스) */
  hemiGround: PaletteKey;
  /** 하늘의 해/달 원반 + 바다 위 반사光 */
  disc: PaletteKey;
}

export const PHASE_COLORS: Record<Phase, PhaseColors> = {
  // 새벽은 노을과 헷갈리면 안 된다 — 하늘은 차가운 보라, 바다만 첫 햇빛을 받아 따뜻하게
  dawn: {
    sky: { top: 'indigo', mid: 'lilac', bottom: 'blossom' },
    ocean: { deep: 'indigo', mid: 'lilac', crest: 'blossom' },
    island: 'indigo',
    cloud: 'cream',
    sunLight: 'sun',
    hemiSky: 'lilac',
    hemiGround: 'blossom',
    disc: 'sun',
  },
  day: {
    sky: { top: 'azure', mid: 'ice', bottom: 'ice' },
    ocean: { deep: 'abyss', mid: 'wave', crest: 'foam' },
    island: 'azure',
    cloud: 'cream',
    sunLight: 'cream',
    hemiSky: 'ice',
    hemiGround: 'wave',
    disc: 'sun',
  },
  dusk: {
    // 위를 깊게 눌러야 노을이 사탕색이 아니라 무드가 된다
    sky: { top: 'indigo', mid: 'blossom', bottom: 'coral' },
    // 노을 바다에 남색을 섞으면 얼룩처럼 탁해진다 — 자주→주황→금색으로
    ocean: { deep: 'blossom', mid: 'coral', crest: 'sun' },
    island: 'indigo',
    cloud: 'cream',
    sunLight: 'coral',
    hemiSky: 'blossom',
    hemiGround: 'coral',
    disc: 'sun',
  },
  night: {
    sky: { top: 'indigo', mid: 'indigo', bottom: 'lilac' },
    ocean: { deep: 'indigo', mid: 'lilac', crest: 'ice' },
    island: 'indigo',
    // 연보라 구름은 연보라 하늘에 묻힌다 — 달빛 받은 구름으로
    cloud: 'ice',
    sunLight: 'ice',
    hemiSky: 'lilac',
    hemiGround: 'indigo',
    disc: 'cream',
  },
};

/** 시간대별 라이팅 강도 — 밤에도 어두워지지 않게 바닥을 높게 잡는다 (CLAUDE.md §3.4) */
export const PHASE_LIGHT: Record<Phase, { sun: number; hemi: number; star: number; glint: number }> =
  {
    dawn: { sun: 1.05, hemi: 0.95, star: 0.3, glint: 0.85 },
    // 낮에는 해가 높아 반사 길이 길게 안 생긴다 — 세게 주면 물 위 얼룩이 된다
    day: { sun: 1.35, hemi: 1.0, star: 0.0, glint: 0.22 },
    dusk: { sun: 1.15, hemi: 0.95, star: 0.15, glint: 1.0 },
    night: { sun: 0.8, hemi: 1.0, star: 1.0, glint: 0.7 },
  };

/** 방향광(해) 위치 — 시간대별 단위벡터 */
export const PHASE_SUN_DIR: Record<Phase, [number, number, number]> = {
  dawn: [-0.55, 0.42, -0.72],
  day: [0.42, 0.85, 0.32],
  dusk: [0.55, 0.4, -0.73],
  night: [-0.4, 0.62, -0.45],
};

/**
 * 하늘에 그려지는 해/달 **원반**의 방향. 조명 방향과 일부러 분리했다.
 *
 * 원반은 수평선 바로 위에 낮게 걸려야 물 위로 반사光이 길게 떨어진다 — 이 씬의 무드 핵심.
 * 조명까지 그 높이로 내리면 갑판이 전부 그늘로 죽으므로 둘을 나눠 둔다.
 *
 * 세로 화면은 가로 시야각이 좁다 — 좌우로 크게 틀면 화면 밖으로 나간다.
 */
export const PHASE_DISC_DIR: Record<Phase, [number, number, number]> = {
  dawn: [-0.16, 0.045, -0.986],
  day: [0.3, 0.62, -0.72],
  dusk: [0.16, 0.05, -0.986],
  night: [-0.1, 0.055, -0.99],
};

// ---------------------------------------------------------------------------
// 배 / 파츠 / 이펙트
// ---------------------------------------------------------------------------

export const BOAT_COLORS = {
  hull: 'timber',
  hullTrim: 'rust',
  deck: 'cream',
  rail: 'coral',
  mast: 'timber',
  sail: 'cream',
  sailStripe: 'coral',
  crate: 'sun',
  crateTrim: 'cream',
  shadow: 'abyss',
} as const satisfies Record<string, PaletteKey>;

/** 파츠 색 — 배경(바다·하늘)에 묻히지 않게 금속/이끼 계열을 쓴다 */
export const PART_COLORS = {
  metal: 'steel',
  metalTrim: 'rust',
  glass: 'foam',
  frame: 'cream',
  wood: 'timber',
  moss: 'moss',
  glow: 'sun',
  cloth: 'cream',
  clothTrim: 'coral',
  flag: 'blossom',
} as const satisfies Record<string, PaletteKey>;

export const FX_COLORS = {
  mote: 'sun',
  moteAlt: 'coral',
  foam: 'foam',
  foamBright: 'cream',
} as const satisfies Record<string, PaletteKey>;

// ---------------------------------------------------------------------------
// UI — CSS 커스텀 프로퍼티로 주입
// ---------------------------------------------------------------------------

export const UI_COLORS = {
  /** 텍스트 잉크 */
  ink: 'indigo',
  /** 카드/시트 표면 */
  surface: 'cream',
  /** 강조 (수거 버튼) */
  accent: 'sun',
  /** 강조 보조 (버튼 그림자/눌림) */
  accentDeep: 'coral',
  /** 자원 게이지 */
  gauge: 'azure',
  gaugeTrack: 'ice',
  /** 페이지 배경 (셰이더 로딩 전 한 프레임) */
  backdrop: 'azure',
  /** 시트 뒤 스크림 */
  scrim: 'indigo',
  /** 보조 텍스트 */
  muted: 'lilac',
  /** 시크릿 전직 배지 */
  secret: 'blossom',
  /** 파츠 태그 */
  part: 'steel',
} as const satisfies Record<string, PaletteKey>;

/** :root 에 --mh-* 변수를 주입한다. CSS는 오직 이 변수만 쓴다. */
export function applyThemeVars(target: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(PALETTE)) {
    target.style.setProperty(`--mh-${name}`, value);
  }
  for (const [role, key] of Object.entries(UI_COLORS)) {
    target.style.setProperty(`--mh-role-${role}`, hex(key as PaletteKey));
  }
}
