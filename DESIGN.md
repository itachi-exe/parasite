# Parasite — visual design system

Derived from a study of 18 real screenshots of a shipped social-deduction game
(kept in `assets/reference/`), supplied by the owner as a quality bar. **Those
images are reference only.** Nothing here reproduces their art, wordmark,
icons, characters, maps or literal UI artwork — what is extracted below is
*layout grammar and interaction convention*, which is genre vocabulary, not
anyone's intellectual property. Our world, characters, palette and typography
stay our own.

Read this before touching anything visual.

---

## 1. The one structural idea: the frame is a ring, the middle is the game

Every gameplay screen in the reference puts UI **only in the corners and along
the edges**, and leaves the entire centre of the screen to the world. Nothing
floats in the middle except the characters and, briefly, a full-screen modal.

Our current HUD does the opposite: two fat vertical rails (240px + 250px) eat
roughly 40% of a 1280px-wide screen permanently, so the actual game is a slot
in the middle. That is the single biggest structural difference and the reason
ours reads as a dashboard with a game embedded in it rather than as a game.

**Target layout:**

```
┌────────────────────────────────────────────────────────────┐
│ [role badge]                    (i) (gear)   ( ◯ minimap ) │
│ [ TASKS  ▾ ]                                    ROOM NAME  │
│                                                            │
│                                                     ◯ P    │
│                    G A M E   W O R L D              ◯ M    │
│                     (full bleed)                    ◯ i    │
│                                                            │
│ ( ◯ )  ( ◯ )                                  ( ◯ )  ( ◯ ) │
│  USE    REPORT                                JUMP   PURGE │
└────────────────────────────────────────────────────────────┘
```

Panels overlay the canvas rather than displacing it. On mobile the same
arrangement holds — the reference's mobile shots use the identical ring.

## 2. Circles are the signature shape

In the reference: the minimap is a circle. Every ability button is a circle.
Player portraits are circles. Only *text* containers are rectangles (the duties
panel, the meeting cards, banners).

We are currently 100% rectangles. Adopting the circle/rect split is the
cheapest single change that moves us toward the reference's feel:

- **Circular:** minimap, ability buttons, player/role portraits, the mode dot.
- **Rounded rect (10–14px):** task list, meeting cards, banners, sheets, tooltips.

## 3. Ability buttons

Circular, 60–72px, dark translucent fill, 2px light ring, icon centred, and a
small **keybind tab** hanging off the bottom edge naming the key ("E", "Space",
"Tab"). The tab is what makes the control teach itself — no separate tutorial
line needed. Disabled = desaturated + dimmed ring, never hidden.

Ours are currently uppercase text pills in a bottom bar with a separate
`WASD / arrows to move` hint. Fold that hint into the buttons themselves.

## 4. Minimap

Top-right, circular, ~110–130px, thick ring border, room name in caps
*underneath* it. Player dots plotted inside. Ours is a rectangle floating over
the stage in the lower right — move it, round it, label it.

## 5. Character screen size

Characters occupy roughly **5–8% of screen height** in the reference — small,
with the environment dominating. Name tags float above the head in small caps
with a dark plate behind them.

Ours are proportionally similar; keep it. What we lack is the *name plate* —
plain text on a busy floor is the first thing to become unreadable.

## 6. Colour

- **Chrome** is near-neutral and dark, so the *world* carries the colour. Our
  neutral-slate chrome (`--bg-panel` etc.) is already correct — do not tint it
  back toward a single hue.
- **Each area gets one dominant hue.** The reference's maps are strongly
  differentiated: teal lab, olive chapel, brick red, violet fairground, black
  cave. Our five room themes already do this; push them *further apart*, not
  closer together.
- **Accents mean things and never drift:** gold/amber = primary action, red =
  danger/death/report, green = progress/success, cyan = interactive/highlight.
  Our `--parasite` green must stay reserved for role/infection.

## 7. Type

Uppercase almost everywhere. Heavy condensed display for headers ("DISCUSSION",
"DUTIES"), regular weight for body. Every piece of type over the world has
either a dark plate behind it or a hard shadow under it — never bare text on
the canvas.

## 8. Dramatic moments get the full screen

The reference's body-found banner is a full-width coloured streak with huge
outlined type and a character's face at one end. The kill moment is a red
splatter burst behind the two characters. These are short, loud, and
unmissable.

We currently surface both as a small toast. A hackathon judge will not notice a
toast. **These moments deserve a full-screen treatment** — it is the cheapest
way to make the game feel produced rather than prototyped.

## 9. Meetings and voting

Full-screen panel, thick rounded border in an accent colour, grid of player
cards (portrait + name + vote state), a **timer as a progress bar** across the
top rather than a number, and a `SKIP` control pinned bottom-left. Dead players
render greyed with an X over the portrait and a `FOUND` tag — the state is
readable at a glance without reading any text.

---

## Priority order for the rebuild

Highest judge-visible impact first:

1. **HUD restructure** — kill the two rails, go to the corner ring, circular
   minimap + ability buttons with keybind tabs. *(biggest single win)*
2. **Meeting / voting screen** — bordered panel, card grid, timer bar, skip.
3. **Body-found / ejection moments** — full-screen banner instead of a toast.
4. **Name plates** on characters.
5. **Push the five room palettes further apart.**

## Hard constraints

- No image generation exists in this pipeline. All art is procedural, drawn
  through the `Pen` interface (`src/game/art/`). Extend the primitives rather
  than reaching for asset files.
- Do not reproduce the reference's characters, logo, icons or literal UI art.
- Do not touch game rules (`packages/shared/src/constants.ts` logic) or the
  server in a visual pass.
- Verify visually with `packages/web/scripts/visual-check.mjs`, not by reading
  the diff. Two separate rendering bugs this project has shipped were invisible
  in code review and obvious in a screenshot.
