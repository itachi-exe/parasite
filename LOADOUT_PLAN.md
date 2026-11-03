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
