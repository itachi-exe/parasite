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
 *
 * ── The lighting model these values encode ──────────────────────────────────
 *
 * Every colour here belongs to one of two light sources, and that split is the
 * point. The outpost's interiors are lit by warm work-lamps; the jungle outside
 * is in canopy shade lit by cool bioluminescence. Interiors therefore run warm
 * and *lighter*, the jungle runs cool and darker, and a room reads as a lit
 * volume rather than as a differently-tinted rectangle.
 *
 * The first pass of this palette had every surface in one hue family at one
 * value, which is why the map read as flat: soil, boardwalk and the meeting
 * platform were all within a few percent luminance of each other, so nothing
 * separated except hue, and hue alone does not survive being looked at quickly.
 */

import { darken, mix } from './pen';

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
  /**
   * This player's seat colour, carried on the shirt, collar, pack and coat hem.
   * See {@link CREW} for why identity lives on the garment and not on the face.
   */
  crew: number;
  /** The shadow side of {@link crew}. Derived, never hand-typed. */
  crewShade: number;
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

/**
 * The ten crew colours, one per seat.
 *
 * `SkinId` only goes up to 3 but a lobby seats up to ten, so four scientists have
 * to carry ten identities. Hair and accessory alone cannot do it — at 40px on a
 * dark floor two black-haired scientists in identical white coats are the same
 * person, which is fatal in a game whose entire loop is "who did I just see go
 * into that room".
 *
 * So identity moves onto the garment: shirt, collar, backpack panel and coat hem
 * all take the seat's colour, and every one of those is visible from at least
 * one facing (see the notes on `torsoBack` in chibi.ts — the back view has no
 * shirt at all, which is why the backpack has to carry it).
 *
 * Two constraints on the hues:
 *
 *  - **No greens.** Green is spoken for: #7cff4f is the Parasite, #74ff6f is
 *    infected eyeshine, #3affc0 means "interactive" everywhere in the HUD. A
 *    green crewmate would read as a role reveal.
 *  - **Mid-saturation, not neon.** These sit next to a white coat on a dark
 *    floor. Fully saturated hues at this size vibrate against the coat and stop
 *    reading as cloth.
 */
export const CREW = [
  { id: 'crimson', color: 0xe04a5f },
  { id: 'tangerine', color: 0xef8b3f },
  { id: 'amber', color: 0xf0c94a },
  { id: 'azure', color: 0x3f9ae8 },
  { id: 'violet', color: 0xa274ee },
  { id: 'magenta', color: 0xe563b0 },
  { id: 'bone', color: 0xdfe6e8 },
  { id: 'rust', color: 0xb05c3a },
  { id: 'slate', color: 0x7d93a6 },
  { id: 'indigo', color: 0x5b6ee0 },
] as const;

/** Seat → crew colour, wrapping if a lobby ever grows past ten. */
export function crewColor(seat: number): number {
  return CREW[((seat % CREW.length) + CREW.length) % CREW.length]!.color;
}

/** Seat → crew colour name, for the HUD and for screen readers. */
export function crewName(seat: number): string {
  return CREW[((seat % CREW.length) + CREW.length) % CREW.length]!.id;
}


const COAT = 0xf1f4f6;
const COAT_SHADE = 0xcfd8de;
const COAT_LINE = 0xa8b5bd;
const SHIRT = 0x24272c;
const PANTS = 0x1b1e23;
const SHOE = 0x0e1014;
const STRAP = 0x2a2d33;
/**
 * The keyline. Not black: a pure-black outline on a dark floor makes the
 * silhouette *merge* with the background instead of separating from it, which is
 * the trap the first pass fell into. This is a very dark desaturated teal — dark
 * enough to read as a line against the white coat, light enough to stay visible
 * against the near-black soil.
 */
const OUTLINE = 0x0d2320;
/**
 * Cool bounce from the canopy. Raised from the original #7fd9c4: the back views
 * of the two black-haired scientists were a featureless disc, and this rim is
 * the only thing that can separate near-black hair from a near-black floor.
 */
const RIM = 0x9feeda;


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
      crew: CREW[0].color,
      crewShade: darken(CREW[0].color, 0.42),
      eye: 0x241c18,
      eyeGlow: null,
      rim: RIM,
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
      crew: CREW[1].color,
      crewShade: darken(CREW[1].color, 0.42),
      eye: 0x1f1a18,
      eyeGlow: null,
      rim: RIM,
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
      crew: CREW[2].color,
      crewShade: darken(CREW[2].color, 0.42),
      eye: 0x241a14,
      eyeGlow: null,
      rim: RIM,
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
      crew: CREW[3].color,
      crewShade: darken(CREW[3].color, 0.42),
      eye: 0x1e1512,
      eyeGlow: null,
      rim: RIM,
      outline: OUTLINE,
    },
  },
];

/**
 * Re-skin a palette for the seat its player is actually sitting in.
 *
 * The `crew` colour on a {@link SKINS} entry is only a sensible default for
 * previews and for the lobby's skin picker, where nobody has a seat yet. In a
 * live game the seat is what has to be unique, not the skin.
 */
export function seatPalette(base: CharPalette, seat: number): CharPalette {
  const c = crewColor(seat);
  return { ...base, crew: c, crewShade: darken(c, 0.42) };
}


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
    // The crew colour survives infection: it is the player's identity, not their
    // role, and dropping it here would make "who is that" harder for the one
    // player who can see this form — the infected player themselves.
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
  crew: 0x2c4a1e,
  crewShade: 0x18280f,
  eye: 0x0a1408,
  eyeGlow: 0x8dff74,
  rim: 0x9dff8a,
  outline: 0x0a1409,
};

/** Vine tones, dark to bright, for layering tendrils with depth. */
export const VINES = [0x1b2c16, 0x2c4a22, 0x3f6b2c, 0x58913a] as const;

/**
 * A corpse is desaturated but must stay recognisably human — see DECISIONS.
 *
 * The crew colour is deliberately kept, only drained: a body on the floor has to
 * be identifiable as *whose* body, which is the entire basis of an accusation.
 * What it must never encode is the victim's role.
 */
export function corpsePalette(base: CharPalette): CharPalette {
  return {
    ...base,
    skin: 0xbdb2a6,
    skinShade: 0x968b80,
    coat: 0xcfd4d6,
    coatShade: 0xa7b0b4,
    coatLine: 0x899499,
    crew: mix(base.crew, 0x8a8f92, 0.45),
    crewShade: darken(mix(base.crew, 0x8a8f92, 0.45), 0.4),
    eye: 0x2a2a2a,
    eyeGlow: null,
    rim: 0x9ab0aa,
  };
}

// ── Environment ──────────────────────────────────────────────────────────────

export const ENV = {
  /**
   * Jungle floor beyond the outpost.
   *
   * Cooler and darker than the outpost's interiors on purpose: the jungle is
   * canopy shade and the rooms are lit, so the jungle recedes and the walkable
   * outpost advances. Value does that work, not hue — the first pass separated
   * these two by hue alone at nearly identical luminance, and the result was a
   * map where you could not tell at a glance where you were allowed to walk.
   */
  soil: 0x05201c,
  soilDark: 0x03150f,
  /** Three depth bands, dark to light. Widened so foliage layers separate. */
  canopy: [0x07291f, 0x0b3b2c, 0x0f4d38] as const,
  frond: [0x156b4e, 0x1e8a63, 0x2aa87c] as const,
  /** The brightest tips, for foreground plants only. */
  frondLit: 0x3ec894,
  spore: 0x2ef2b0,
  bio: 0x6affd0,
  bioCore: 0xd6fff2,

  /**
   * Warm work-lamp light. Everything lit inside the outpost is tinted toward
   * this rather than toward white, which is what keeps the interiors from
   * turning grey as they brighten.
   */
  lamp: 0xffd9a0,
  /** Cool canopy bounce, for shadow sides. Shadows here are teal, not black. */
  bounce: 0x0d3a42,

  wall: 0x2f5348,
  wallTop: 0x497f6d,
  wallLip: 0x74b9a1,
  wallDark: 0x112823,
  wallShadow: 0x010c09,

  /**
   * Boardwalk corridors between the rooms. Lifted well clear of the soil: a
   * corridor is walkable and the jungle is not, so the two must never be within
   * a few percent of each other.
   */
  pathFloor: 0x24443a,
  pathPlank: 0x3a6a50,
  pathPlankAlt: 0x305c46,
  pathGrime: 0x18332a,
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

/**
 * Per-area floor treatment. Keyed by AreaId in outpost.ts.
 *
 * Two deliberate choices here.
 *
 * **Floors are mid-value, not light.** The obvious move toward GGD's clarity is
 * its near-white floors, and it is the wrong move for this game: our scientists
 * wear white lab coats. On a light floor the coat — the largest shape on the
 * character — would lose all contrast, and a readable floor would have cost us a
 * readable cast. So the floors are lifted to a clear mid value that separates
 * from the dark jungle *and* stays well below the coats, and the silhouettes are
 * held by the keyline and the contact shadow instead.
 *
 * **lab-a and lab-b are no longer identical.** They were byte-for-byte the same
 * theme, which threw away a free navigation cue in a game where "which lab was
 * that" decides votes. They are still a matched pair — both cool, both tiled —
 * but a is cyan-teal and b is a bluer steel, so a glance at the floor tells you
 * which one you are standing in. Their prop layouts were already mirrored.
 */
export const THEMES: Record<string, RoomTheme> = {
  'lab-a': {
    floor: 0x214954,
    floorAlt: 0x27545f,
    grout: 0x143038,
    scuff: 0x2e6270,
    accent: 0x49d7f0,
    pattern: 'tile',
    label: '#9fe8f5',
  },
  'lab-b': {
    floor: 0x223f56,
    floorAlt: 0x284961,
    grout: 0x152838,
    scuff: 0x30536e,
    accent: 0x6aa8f5,
    pattern: 'tile',
    label: '#a8cdff',
  },
  specimen: {
    floor: 0x322a44,
    floorAlt: 0x3a3150,
    grout: 0x1f1a2c,
    scuff: 0x483c60,
    accent: 0xb478f0,
    pattern: 'tile',
    label: '#dcc0ff',
  },
  greenhouse: {
    floor: 0x24492f,
    floorAlt: 0x2b5537,
    grout: 0x162f1e,
    scuff: 0x366a42,
    accent: 0x9be55f,
    pattern: 'moss',
    label: '#c8f5a8',
  },
  meeting: {
    floor: 0x27564a,
    floorAlt: 0x2e6355,
    grout: 0x18382f,
    scuff: 0x3a7466,
    accent: 0x3affc0,
    pattern: 'deck',
    label: '#8ffce0',
  },
};

