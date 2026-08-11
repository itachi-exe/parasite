/**
 * Colour language for the in-game art.
 *
 * The character palette is lifted from `assets/characters.jpg` — white lab
 * coats, near-black undershirt and trousers, one hair colour and one accessory
 * per scientist, grey-green cracked skin with green eyeshine when infected. The
 * reference is used as a palette and silhouette guide only; nothing here samples
 * or traces the image, because every character below is drawn from primitives.
 *
 * The environment palette keeps the existing bioluminescent-jungle language of
 * the HUD (`globals.css`) so the canvas and the React chrome still look like one
 * game: deep blue-greens, with #2ef2b0 as the accent that means "interactive".
 */

export interface CharPalette {
  skin: number;
  skinShade: number;
  hair: number;
  hairShade: number;
  hairLight: number;
  coat: number;
  coatShade: number;
  coatLine: number;
  shirt: number;
  pants: number;
  shoe: number;
  strap: number;
  /** Small colour flash — badge, device screen, cap panel. */
  accent: number;
  eye: number;
  /**
   * Cool bounce light from the environment, used as a rim on back-facing views.
   * Dark hair against a dark floor has almost no internal contrast to work with,
   * so the silhouette is separated with light from the scene rather than with a
   * lighter shade of the hair itself.
   */
  rim: number;
  /** Non-null only for infected/parasite forms: eyes emit instead of absorb. */
  eyeGlow: number | null;
  outline: number;
}

export type Accessory = 'cap' | 'ponytail' | 'headlamp' | 'scanner';

const COAT = 0xf1f4f6;
const COAT_SHADE = 0xcfd8de;
const COAT_LINE = 0xa8b5bd;
const SHIRT = 0x24272c;
const PANTS = 0x1b1e23;
const SHOE = 0x0e1014;
const STRAP = 0x2a2d33;
const OUTLINE = 0x0b1a16;

/** The four playable scientists, in skin-id order. */
export const SKINS: readonly { pal: CharPalette; accessory: Accessory }[] = [
  {
    // 0 — black cap, short dark hair.
    accessory: 'cap',
    pal: {
      skin: 0xf0c9a4,
      skinShade: 0xd8a87e,
      hair: 0x1d1d22,
      hairShade: 0x101014,
      hairLight: 0x4b4b59,
      coat: COAT,
      coatShade: COAT_SHADE,
      coatLine: COAT_LINE,
      shirt: SHIRT,
      pants: PANTS,
      shoe: SHOE,
      strap: STRAP,
      accent: 0x3a3f47,
      eye: 0x241c18,
      eyeGlow: null,
      rim: 0x7fd9c4,
      outline: OUTLINE,
    },
  },
  {
    // 1 — long black hair worn in a ponytail, satchel.
    accessory: 'ponytail',
    pal: {
      skin: 0xf3d3b2,
      skinShade: 0xdbb189,
      hair: 0x15151b,
      hairShade: 0x0a0a0e,
      hairLight: 0x444452,
      coat: COAT,
      coatShade: COAT_SHADE,
      coatLine: COAT_LINE,
      shirt: SHIRT,
      pants: PANTS,
      shoe: SHOE,
      strap: STRAP,
      accent: 0x2f6f5c,
      eye: 0x1f1a18,
      eyeGlow: null,
      rim: 0x7fd9c4,
      outline: OUTLINE,
    },
  },
  {
    // 2 — headlamp over mid-brown hair.
    accessory: 'headlamp',
    pal: {
      skin: 0xe9bb95,
      skinShade: 0xcd9a72,
      hair: 0x5b3a24,
      hairShade: 0x3d2617,
      hairLight: 0x7d5535,
      coat: COAT,
      coatShade: COAT_SHADE,
      coatLine: COAT_LINE,
      shirt: SHIRT,
      pants: PANTS,
      shoe: SHOE,
      strap: STRAP,
      accent: 0xbfc7cd,
      eye: 0x241a14,
      eyeGlow: null,
      rim: 0x7fd9c4,
      outline: OUTLINE,
    },
  },
  {
    // 3 — dark brown hair, handheld scanner.
    accessory: 'scanner',
    pal: {
      skin: 0xdda87f,
      skinShade: 0xbe8760,
      hair: 0x3a2418,
      hairShade: 0x24150d,
      hairLight: 0x5a3a26,
      coat: COAT,
      coatShade: COAT_SHADE,
      coatLine: COAT_LINE,
      shirt: SHIRT,
      pants: PANTS,
      shoe: SHOE,
      strap: STRAP,
      accent: 0x53ff9b,
      eye: 0x1e1512,
      eyeGlow: null,
      rim: 0x7fd9c4,
      outline: OUTLINE,
    },
  },
];

/**
 * The "just infected" form: the host is still recognisably themselves — same
 * hair, same accessory, same coat — which is the whole horror of it. Skin has
 * gone grey-green and cracked, the coat is mossy at the hem, and the eyes have
 * started to emit.
 */
export function infectedPalette(base: CharPalette): CharPalette {
  return {
    ...base,
    skin: 0x9aab93,
    skinShade: 0x6d7f68,
    coat: 0xdfe4dc,
    coatShade: 0xb6c0ac,
    coatLine: 0x8d9a85,
    hair: base.hairShade,
    hairShade: 0x0d1210,
    hairLight: base.hair,
    eye: 0x0c1a0c,
    eyeGlow: 0x74ff6f,
    rim: 0x8ee39a,
    accent: 0x62c96a,
  };
}

/** Colours for the fully revealed Parasite. Barely any of the host is left. */
export const PARASITE_PAL: CharPalette = {
  skin: 0x2f4a26,
  skinShade: 0x1b2c16,
  hair: 0x22381c,
  hairShade: 0x14200f,
  hairLight: 0x3f6b2c,
  coat: 0x35492c,
  coatShade: 0x1f2c19,
  coatLine: 0x4c6b39,
  shirt: 0x151f11,
  pants: 0x141d10,
  shoe: 0x0d140b,
  strap: 0x24361b,
  accent: 0x7dff6a,
  eye: 0x0a1408,
  eyeGlow: 0x8dff74,
  rim: 0x9dff8a,
  outline: 0x081008,
};

/** Vine tones, dark to bright, for layering tendrils with depth. */
export const VINES = [0x1b2c16, 0x2c4a22, 0x3f6b2c, 0x58913a] as const;

/** A corpse is desaturated but must stay recognisably human — see DECISIONS. */
export function corpsePalette(base: CharPalette): CharPalette {
  return {
    ...base,
    skin: 0xbdb2a6,
    skinShade: 0x968b80,
    coat: 0xcfd4d6,
    coatShade: 0xa7b0b4,
    coatLine: 0x899499,
    eye: 0x2a2a2a,
    eyeGlow: null,
    rim: 0x9ab0aa,
  };
}

// ── Environment ──────────────────────────────────────────────────────────────

export const ENV = {
  /** Jungle floor beyond the outpost. */
  soil: 0x06251b,
  soilDark: 0x041a13,
  canopy: [0x0a3527, 0x0d422f, 0x115239] as const,
  frond: [0x14624a, 0x1a7a5c, 0x22946e] as const,
  spore: 0x2ef2b0,
  bio: 0x6affd0,
  bioCore: 0xd6fff2,

  wall: 0x2b4c42,
  wallTop: 0x3d6a5c,
  wallLip: 0x50897a,
  wallDark: 0x16302a,
  wallShadow: 0x02100c,

  /** Boardwalk corridors between the rooms. */
  pathFloor: 0x1c3b2e,
  pathPlank: 0x24503c,
  pathPlankAlt: 0x1f4634,
  pathGrime: 0x142b21,
} as const;

export interface RoomTheme {
  floor: number;
  floorAlt: number;
  grout: number;
  scuff: number;
  accent: number;
  /** How the floor is patterned. */
  pattern: 'tile' | 'moss' | 'deck';
  label: string;
}

/** Per-area floor treatment. Keyed by AreaId in outpost.ts. */
export const THEMES: Record<string, RoomTheme> = {
  'lab-a': {
    floor: 0x1a3b45,
    floorAlt: 0x1f4552,
    grout: 0x112b33,
    scuff: 0x24505d,
    accent: 0x49d7f0,
    pattern: 'tile',
    label: '#9fe8f5',
  },
  'lab-b': {
    floor: 0x1a3b45,
    floorAlt: 0x1f4552,
    grout: 0x112b33,
    scuff: 0x24505d,
    accent: 0x49d7f0,
    pattern: 'tile',
    label: '#9fe8f5',
  },
  specimen: {
    floor: 0x2a2338,
    floorAlt: 0x322a43,
    grout: 0x1c1727,
    scuff: 0x3b3150,
    accent: 0xb478f0,
    pattern: 'tile',
    label: '#dcc0ff',
  },
  greenhouse: {
    floor: 0x1b3a26,
    floorAlt: 0x21462d,
    grout: 0x11291a,
    scuff: 0x2a5636,
    accent: 0x7ce06a,
    pattern: 'moss',
    label: '#bdf5a8',
  },
  meeting: {
    floor: 0x1e4238,
    floorAlt: 0x255046,
    grout: 0x143029,
    scuff: 0x2d6053,
    accent: 0x3affc0,
    pattern: 'deck',
    label: '#8ffce0',
  },
};
