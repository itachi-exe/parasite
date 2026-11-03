# Parasite v2: Loadout AI Game Competition rebuild

Deadline: entries close 2026-11-06 15:00 UTC. itachi posts the clip Thursday 2026-11-05 19:00 Berlin.
So everything below must be DONE by Thursday 2026-11-05 16:00 Berlin. Rules: ../hackathon-sprint/loadout-ai-game/RULES.md
Judging: gameplay potential 40, originality 25, execution 20, development plan 15.

## Owner's call (binding)
itachi, 2026-11-02: "rebuild parasite assets and stuff from scratch because the game is trash rn".
The current look is rejected. Do NOT reuse assets/characters.jpg, the old sprites, the old tiles or the old
UI styling as a base. Keep the game logic, the server, the contracts and the Inco Jump mechanic: those are the
originality score. Rebuild everything the player SEES.

itachi, 2026-11-02 21:45: "three js is a better stack for this build". The renderer moves from Phaser to
three.js (r180, already proven headless here). Shape, decided:
- One three.js scene, orthographic camera at a fixed top-down 3/4 angle (the 2.5D look), toon materials
  with a 3-band ramp, inverted-hull ink outline, warm key light upper left, teal rim lower right.
- Crew are low-poly procedural models built in code. Starting point and reference:
  shots/v2/three/crew-red.html (seat 0, red, headlamp). Seat colours, accessories and forms stay exactly as
  in art2/crew.ts (SUITS, ACCESSORIES, infected/parasite/fallen); port them, do not redesign them.
- Walk = procedural leg/arm swing and body bob, idle = breathing. Facing = model rotation, so 4 directions
  come free.
- Keep ALL game logic, networking, server, contracts and the Jump. Replace only what draws. Phaser is
  removed once the three.js scene renders the same game state. Do not run two renderers in the clip.
- Light radius / fog of war, spores and fireflies are real lights and particles now: use them, they are the
  reason for the switch.
- Deadline does not move. If the port is not playable by Wed 2026-11-04 22:00 Berlin, stop polishing and
  put the remaining time into bots and the clip.

itachi, 2026-11-03 05:15: "make sure the intro page or first page and all component on parasite original
website are updated or upgraded to this new design". Scope is the WHOLE site, not just the game scene:
landing/intro page (/), gallery, lobby and room join, name and seat pick, in-game HUD, task panels, meeting
and voting screens, chat, the Jump UI, end-of-round and win screens, loading and error states, buttons,
modals, fonts, favicon and OG image. Every surface must match the new stylized-realism art direction (same
palette, lighting mood, type, custom SVG icons, no emoji, no old Phaser-era styling). Load
itachi-design-system before touching UI. Order: game playable first (Wed 22:00 gate), then the landing page
(it is the first thing judges see), then the in-game UI, then the rest. Done when a full click-through from /
to the win screen shows no old-design surface; screenshot each one into shots/v2/site/.

## Repo rules
- Work in /opt/hermes/projects/parasite-v2 on branch loadout-v2. Small commits per step.
- Never push (push URL is disabled on purpose). Never touch /opt/ashe/jobs/parasite or the live theparasite.xyz.
- Dev on ports 9200 (web) / 9201 (server) so the live game on 9100/9101 is untouched.
- No emoji anywhere in UI. No em/en dashes in player-facing text.

## Memory rules (binding, the box has 8 GB shared with live services)
The 2026-11-02 16:30 session was OOM-killed by `next dev` (2.1 GB). So:
- Never run `next dev`. Use `NODE_OPTIONS=--max-old-space-size=1024 npx next build` then `next start -p 9200`.
- One dev server and one headless browser at a time. Kill both (and anything on 9200/9201) before the session ends.
- Check `free -m` before a build or a capture; if "available" is under 1500, wait or do non-build work.

## Art direction (binding)
itachi, 2026-11-03 04:00: "upgrade the graphics and let it look more realistic". This overrides the toon
look below wherever they conflict. Target: grounded, cinematic stylized-realism (think a premium indie
3D game), NOT photoreal and NOT toon. Concretely:
- Materials: replace MeshToonMaterial everywhere with MeshStandardMaterial / MeshPhysicalMaterial (PBR).
  Real roughness/metalness per surface: brushed metal panels, rubberised suits, glass visors with
  clearcoat, wet soil, waxy leaves. Procedural canvas textures for normal/roughness detail (panel seams,
  grate holes, scuffs, dirt at wall bases, leaf veins). No downloaded asset packs.
- Drop the 3-band ramp and the inverted-hull ink outline. Silhouettes now read through rim light,
  contrast and ambient occlusion instead.
- Lighting: renderer.toneMapping ACESFilmic, physically correct light intensities, PCFSoft shadows from
  the key light and from the main room lights, warm lab spots that actually pool on floors, teal jungle
  rim. A PMREM environment (RoomEnvironment or a generated night sky) so metal and glass reflect.
- Post: EffectComposer with RenderPass, GTAOPass (or SAOPass), UnrealBloomPass (only lamps, consoles,
  fireflies and Parasite green bloom), volumetric-feel exponential fog, subtle vignette, OutputPass, SMAA.
- Jungle: denser and messier (varied scale/tilt/hue, vines over walls and rails, moss and puddles on
  paths), so the outpost looks overgrown, not placed.
- Crew: smoother higher-poly suits with seams, pockets, hoses and boot treads; keep the 10 seat colours,
  accessories and forms. Toxic green still ONLY on the Parasite and infection.
- Budget: must stay smooth in a normal laptop browser. Instance repeated geometry, cap shadow casters,
  keep post at half resolution if needed. Readability in a 15 s clip beats realism if they ever conflict.
- Cutoff still stands: playable by Wed 2026-11-04 22:00 Berlin, or stop polishing.

Theme stays: jungle research outpost on planet Virelia, a crew of scientists, one hidden Parasite.
Target feel: a polished modern indie game, not a jam prototype. Think cohesive top-down 2.5D with soft
lighting, readable silhouettes, one strong palette (deep teal jungle night, warm lab lights, toxic green
reserved ONLY for the Parasite and infection), animated idle/walk cycles, ambient particles (spores,
fireflies, flickering lights), and a vignette/fog-of-war light radius around the player.
- Characters: three.js procedural PBR models (stylized-realism, see top of this section) (see Owner's call), with 4-direction walk cycles and 8+ distinct crew skins via color + accessory. Optional: grok-image-gen
  for concept references only; ship only assets you can keep consistent.
- Map: one hand-designed outpost (lab, greenhouse, reactor, comms, medbay, docking pad) with walls,
  props, doors, lighting. Readable at a glance in a 15 s clip.
- UI: lobby, role reveal, meeting/vote screen, ejection and win screens rebuilt in the itachi design
  system. Role reveal and the Jump get a cinematic moment: they are the clip's money shots.
- Audio is optional; motion and light are not.
Load itachi-design-system and design-inspo-fidelity before any UI work. Inspo = this section plus the
in-universe theme; a generic dark dashboard look is a failed session.

## Order of work
1. three.js port, in this order: (a) packages/web/src/game/three/: crew model module ported from
   shots/v2/three/crew-red.html for all 10 seats + infected/parasite/fallen, with a turnaround screenshot;
   fix its known flaws first (headlamp too small and on top instead of brow, outline glitches at shoulder
   and heel in side view, dark limbs vanish on dark background). (b) outpost map as 3D blocks (floors,
   walls, doors, props, room lights). (c) a ThreeScene that renders the live game state MainScene renders
   today (players, positions, facing, bodies, tasks), input and camera follow, then remove Phaser.
   Screenshots via puppeteer with --use-angle=swiftshader --enable-unsafe-swiftshader (WebGL works that
   way headless; see shots/v2/three/shoot.mjs). Judge honestly, iterate.
2. UI screens rebuild.
3. AI crewmate bots on the server (wander, do tasks, vote with simple suspicion, one bot can be the Parasite and Jump) so ONE human can play a full round. Needed for the clip.
4. Clip: headless capture at 1280x720, 30 to 45 s: walk through the outpost, a body report, the meeting vote, the Jump, an ejection reveal. Save ../hackathon-sprint/loadout-ai-game/clip.mp4 (+ a 15 s cut).
5. devplan.md (roadmap: mainnet Inco, matchmaking, mobile, maps, ranked) and draft_post.md for X (short, no hashtags spam, tag @loadoutprotocol) in ../hackathon-sprint/loadout-ai-game/.

## Progress log
Append one line per session: date, what changed, commit hash, screenshot path, what is next.
- 2026-11-02 (eve): v2 crew art from scratch in packages/web/src/game/art2/crew.ts (Canvas 2D, ink outline, warm key + teal rim, 10 suits x 10 accessories, 4 chest trims, walk 4f + idle 2f in 3 facings, infected/parasite forms with toxic green only there, fallen pose). Contact sheet via scripts/art-preview (esbuild + puppeteer, no dev server). Commit 94da667. Shot: shots/v2/crew-sheet.png (vision score 6.5/10 before palette spread fix). Next: wire crew.ts into phaserPen.ts texture bake (CELL_H 76 to 80, origin), MenuBackdrop and gallery, then rebuild the map in art2.
- 2026-11-02 21:45: owner switched the renderer to three.js. Prototype shots/v2/three/crew-red.html (+ -sheet.png, -hero.png), vision 6.5/10. Not committed into the game yet. Next: step 1a.
- 2026-11-02 (late): step 1a done. packages/web/src/game/three/crew3d.ts (buildCrew rig with 4 facings, walk + idle, all 10 seats/accessories, infected/parasite with tendrils + soft aura, buildFallen sprawled on an irregular non-green stain). Fixes vs prototype: welded smooth-normal ink hull (no shoulder/heel splits), concentric visor frame, helmet-hugging straps, lighter limbs on dark suits. three@0.180 added to web deps. Preview: packages/web/scripts/three-preview/shoot.sh (esbuild + puppeteer, no dev server). Commit 39a4bdf. Shots: shots/v2/three/crew3d-turnaround.png, crew3d-game.png (vision 8/10 game cam; corpse supine read still ~6). Next: step 1b, outpost map as 3D blocks.
- 2026-11-03 (night): step 1b first pass. packages/web/src/game/three/outpost3d.ts (buildOutpost + addNightLights): raised deck rooms, walls/door gaps/rails sampled from shared AREAS + isWalkable (no hand data), consoles at TASK_STATIONS, per-room props (benches, racks + dish, planters + grow lamps, tanks + generator), flickering room lights with painted pools, 230 instanced jungle trees/ferns with ink hull, fireflies + spores, 4096 key-light shadow. Architecture drops the crew rim (it painted ortho faces cyan). Preview: scripts/three-preview/shoot-outpost.sh. Commit 86819b9. Shots: shots/v2/three/outpost-{overview,meeting,specimen,greenhouse}.png. Vision honest 5-6/10: layout and doors read, lighting still flat (warm pools faint, shadows soft, jungle too clean, a pale quad under one crew rig from crew3d). Next: step 1b polish (stronger warm pools/bloom-free emissive, overgrowth on walls and paths, crate shading, find the crew quad), then step 1c wire outpost + crew into the Phaser scene.
- 2026-11-03 04:00: owner asked for more realistic graphics. Art direction switched from toon to PBR stylized-realism (see top of Art direction). Next run: realism pass on crew3d.ts + outpost3d.ts (materials, lights, shadows, post, overgrowth, crew rectangle bug), fresh screenshots with the same 4 outpost angles + crew game view, before step 1c.
- 2026-11-03 (morning): realism pass done. crew3d.ts + outpost3d.ts moved from toon/ink hull to stylized PBR (clearcoat suits and visors, metal fittings, teal Fresnel rim, world-space seams and grime on walls, bump-mapped deck); new src/game/three/post.ts (ACES, PMREM room env, exp fog, GTAO, HDR-selective bloom, vignette, SMAA); jungle 520 jittered spots + waxy fronds, vines on walls/rails, edge moss, puddles. Crew rectangle bug root-caused: shared geo() cache key "lampglow" (and "dish") between crew and outpost, now keyed on factory source. Commit fa4e9bd. Shots: shots/v2/three/outpost-{overview,meeting,specimen,greenhouse}.png, crew3d-turnaround.png, crew3d-game.png. Vision honest 7/10 meeting, 6/10 turnaround: holo table base still hot (~3% clipped), floor a bit muddy, crates flat, visors read as black paint more than glass. Next: short polish (holo spill, crate wood material, visor env reflection), then step 1c wire outpost + crew + post.ts into the Phaser scene.
- 2026-11-03 04:55 (r3birth): reminder for step 1c. Do NOT mount the three.js outpost inside the Phaser scene. Build a standalone ThreeScene that renders the live game state, then delete Phaser (see step 1 text). One renderer only.
- 2026-11-03 (r3birth, step 1c): standalone ThreeScene (packages/web/src/game/three/ThreeScene.ts) now renders the live game: players merged with 20Hz positions, local prediction with shared resolveMove, 4-way facing with turn deadzone, ghost self-view, human-only corpses, task-station reach rings (hidden for the Parasite), camera follow, WASD/arrows + touch stick, DOM name plates (own plate peach). GameStage mounts it via dynamic import; bridge type moved to src/game/bridge.ts. Phaser deleted (MainScene, phaserPen, mapArt, dependency). Preview: packages/web/scripts/three-preview/shoot-game.sh. tsc + next build clean. Shots: shots/v2/three/game-{meeting,specimen,ghost}.png. Vision honest 6-8/10: plates and rings read; centre holo console still blooms to white and swallows whoever stands on it (ghost unreadable there). Next: tame the holo console bloom, then a live 2-tab round smoke test via next start, then step 2 UI screens.
- 2026-11-03 (r3birth review of game-* shots): fix before clip: crew clip into specimen stasis pods (Okafor, Juno in game-specimen.png); corpse at right edge of meeting room hidden behind crate and wall (game-ghost.png), keep bodies readable; centre holo bloom still washes out whoever stands on it.
- 2026-11-03 (itachi approved, owner's call): CAMERA AND VISION. Keep the top-down camera (no third person this submission). Add (1) a facing-direction vision cone: walls block line of sight (raycast/shadow-cast against shared AREAS + isWalkable walls), everything outside the cone and behind walls sinks into dark fog; other players, bodies and name plates outside sight are hidden; ghosts see everything. (2) Camera a bit closer and lower tilt so it feels present, not map view; keep the whole meeting cluster readable for the clip. Do it AFTER the round is playable and BEFORE bots/clip, budget a few hours, skip if the Wed 2026-11-04 22:00 cutoff is at risk. Visual work goes to the Opus specialist (task-model-routing). devplan.md: list full over-the-shoulder third-person mode (CODM style) as the v3 headline roadmap item.
- 2026-11-03 (r3birth, step 3 partial): bots already existed (crew wander, tasks, vote). Added in GameRoom.ts: crew bots walk to a body within 420 px and report it (public reportBody); a bot holding the Parasite (simulated mode, polled 1/s via readRoleForSeat) purges a lone target (no witness within 220 px, 15% per tick in range, public purge rules). Bots never Jump yet (needs role re-delivery emit). 59 server tests pass + new report test, tsc clean. No visual work this run (box had 2 GB free, Opus worker deferred). Next: vision cone + camera (Opus one-shot), fix crew clipping in specimen, corpse visibility, holo bloom; then bot Jump; then clip.
- 2026-11-03 (r3birth cron 13:30): Opus one-shot hit its 480s budget mid-run on vision cone + camera. Left tsc-clean WIP (vision.ts LOS, post.ts fog, ThreeScene hiding), commit 301709e, no verified screenshot yet. Next: re-run Opus worker to finish and screenshot (cone, camera, pod clipping, corpse, holo bloom), then bot Jump, clip.
- 2026-11-03 (r3birth cron 16:30): Opus one-shot (session 20261103_163139_8d7fa4) finished vision cone + closer/lower camera, commit 5227dcf, tsc clean. Vision 7/10 (cone and meeting cluster read, corpse visible). Shots: shots/v2/three/vision-{meeting-right,meeting-up,specimen-up,ghost,debug-mask-up}.png. Open: fog slightly too dark (lift ~10%), pale wall slab at cone edge too bright, door-gap occlusion unproven, dark suits (Bastian) melt into fog. Next: short Opus polish on those + pod clipping, corpse edge, holo bloom; then bot Jump; then clip.
- 2026-11-03 17:00 r3birth review of the 4 unreviewed vision shots (fix list for the next Opus polish, in priority order):
  1. Emissives ignore fog: wall lamps, pillar orange lights, cyan LED dots and the crate's cyan top glow at full strength inside fogged areas. Fog must dim emissives and lamps outside line of sight. Gate lamps blow out to pure white squares (ghost view).
  2. Cone shape reads weakly (specimen-up scored 4/10): no clear apex or edge, so it looks like a light pool. Give it a soft defined rim, and add a minimum ambient level so fogged floor keeps faint shape instead of crushing to black.
  3. Occlusion: light leaks past the back-wall corner pillars (meeting-up), and hard-edged black blobs at bottom centre of specimen-up look stamped and cover the corpse. Check vision.ts polygon against walls and door gaps.
  4. Bright dithered slabs on the cone edge diagonals (meeting-up), as noted.
  5. Dark suits and the corpse melt into fog: add a rim light or outline to bodies and players inside the cone. Bastian's white suit is near-clipped in the ghost view.
  6. Okafor clips into the left specimen pod base. Okafor's antenna is barely visible.
- 2026-11-03 19:50 (r3birth cron, Opus one-shot session 20261103_193135_95060c): vision fog polish, commit 0d91bda, tsc clean. Per-pixel cone with rim and apex, fog lift ~10%, emissives compressed in fog, amber gate lamps (no white squares). Shots: shots/v2/three/vision2-{meeting-up,specimen-up,ghost}.png. My vision check specimen-up 6/10: cone edge clear on walls but soft on floor, stasis tube/amber strip/crate glow still bright in fog. Open: corridor grate rim flicker, cone 82deg too wide for a wedge (VISION.half is a gameplay call for itachi), review items 4-6 (pillar leaks, rim light on dark suits/corpse, Okafor pod clip). Next: one more Opus polish on those, then bot Jump, then clip.
- 2026-11-03 r3birth, cone width (default unless itachi overrides in Bot Chat): narrow the cone from 82 to 70 degrees AND add a small proximity circle (about 1.5 m radius, all directions) so a player standing right behind you is still seen. Wedge reads clearly, nobody gets killed by an invisible player at point blank. It must go through the shared rules (server visibility too), not just the renderer. Also still open from the first review: lamps, the stasis tube, the amber strip and the crate glow must dim inside fog.
