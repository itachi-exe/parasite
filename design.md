# Parasite v2: cinematic outpost design

## Brief and precedence
Finish the existing game and every visible website surface, then create the first local launch video. LOADOUT_PLAN.md is binding. Preserve server authority, networking, rules, all ten seat identities and Inco Jump. Do not reuse the rejected chibi assets, old sprites, Phaser rendering, Fredoka display styling or cyan dashboard chrome. Nothing is published by this finish pass.

## Reference Notes
Primary art reference is the owner's approved procedural PBR crew and jungle outpost in packages/web/src/game/three/. It wins over all outside references. Existing shots/v2/three/ and shots/v2/site/ supply real product evidence, not an asset pack. Gemini visual review is currently quota-blocked; a native GPT image attachment review is being attempted. Text/source inspection is not visual approval.

Five external references researched through actual page extraction:
1. Dark.design Onmi, https://www.dark.design/site/onmi: source gallery copy leads with 'Real world adventures await' and a direct site link. Use a short world-first hook. Its gallery image is curated, not our capture; do not infer its palette or motion from extracted text.
2. Among Us, https://www.innersloth.com/games/among-us/: teamwork/betrayal hook, real screenshots, explicit crew and impostor objectives, meetings and votes. Borrow clarity of competing objectives, not its cartoon art. Our differentiator is the host-changing Jump.
3. Project Winter, https://www.projectwinter.co/: source includes a hero HTML5 video and compact purchase destinations. Borrow a media-first game presentation and a single obvious primary action, not store buttons we do not have.
4. Deceit 2, https://www.deceit.gg/: 'Who can you trust to escape?', role-specific objectives and the Reality/Inbetween/Judgement sequence. Borrow a readable trust narrative and distinct phase presentation, not its roles, platforms or numbers.
5. Lethal Company, https://store.steampowered.com/app/1966720/Lethal_Company/: terse abandoned-moon co-op premise, clear early-access scope. Borrow environmental stakes and honest prototype scope, not ratings, multiplayer promises or screenshots.
Additional dark.design Ink Games reference was fetched but returned a client-side application error, so it is excluded from design evidence. No external reference artwork, code or finished video is copied.

## Product Feel
Grounded cinematic stylized-realism, a research outpost being reclaimed by a jungle at night. Warm pools of lab light, deep teal atmosphere, brushed metal and glass, readable silhouettes. Premium indie game, not admin software, not a toon prototype. Interaction stays immediate; spectacle belongs to role reveal, Jump and verdict.

## Audience
Players of short social deduction rounds and Loadout judges. A player should join and play without a wallet in the local simulated mode. The mode's confidentiality limit must remain visible and truthful.

## Accent Color and Tokens
One interaction accent: warm lab amber (#e9bc82), warm off-white ink (#f5f5f3), near-black teal-neutral canvas (#091216), lifted surfaces (#111f23, #17272b). Hairline rgba borders. Teal is environmental lighting, not an accent sprayed across UI. Toxic green is reserved only for Parasite/infection states; danger is reserved for a dangerous action or outcome. Preserve ten crew suit colors as identity data. Use canonical --bg/--bg-1/--bg-2/--bg-3/--ink/--ink-2/--muted/--accent/--line aliases and map existing component tokens without breaking callers.

## Typography
Geist or Inter, genuinely self-hosted and verified, never a silent fallback and no runtime font network dependence. Geist Mono or a legitimate local mono for room codes, small status data and numbers. Display tracking -0.02em to -0.04em; uppercase only for short phase/status labels. Titles do not become multi-line unreadable banners on phones.

## Copy Voice
Short, direct, in-world. One primary Play action, Join outpost, Begin the expedition. Keep actual player names and room codes untouched. No emoji, em/en dashes or decorative Unicode icons. No developer commands, environment-variable names, paths, local endpoints or raw stack traces in player-facing states. Use 'Local simulation. Roles are not encrypted.' for the local build; never imply this footage proves live Inco. Preserve truthful wallet/network requirements only in the relevant Inco path.

## User Flow
Landing -> join/name/scientist choice -> waiting crew -> start -> real outpost movement/tasks -> role reveal/Jump -> report -> discussion -> ballot -> ejection -> round end. Gallery is a readable optional crew view with navigation back to the outpost. Preserve all actual handlers and accessibility behavior.

## Screens to Build (ordered audit inventory)
- [ ] Landing / intro
- [ ] Crew gallery
- [ ] Lobby / room join / name and scientist selection
- [ ] In-game HUD / controls / role badge / task list
- [ ] Task panels and all five minigames
- [ ] Meeting / voting / ejection reveal
- [ ] Chat / voice / crew list / alerts
- [ ] Role reveal and Jump UI
- [ ] End-of-round and win screens
- [ ] Loading / empty / error / dialog states
- [ ] Shared buttons / typography / SVG icons / favicon / OG image

## Asset Strategy
Use exactly the production buildCrew/buildFallen/outpost geometry and PBR lighting. Capture own-scene hero and crew portraits through one reusable renderer; ten portrait images must map to the actual seat identity, not the obsolete four-sprite array. Gallery must not create ten simultaneous WebGL contexts. Portraits, scene stills and metadata images are real rendered product assets with source recorded. Keep offscreen resources and previews cleaned up. No downloaded packs or concept-generated art in shipped screens.

## States and Breakpoints
For each inventory row: default, loading, empty, actionable error, success feedback when applicable; 375px, 768px, 1280px+, and reduced motion. Round task/meeting states come from the real server; a purely visual fixture must be labeled as such and is not gameplay evidence. Check overflow, touch targets >=44px, dialog close/focus trap, keyboard input/focus restoration, and visibility when the page is backgrounded.

## Accessibility
Focus-visible rings, semantic headings/buttons/dialogs, associated labels, icon-only aria-labels, readable text contrast >=4.5:1, safe areas, permissive viewport zoom, reduced-motion guards. Disabled role-independent controls must remain symmetric so the UI does not reveal hidden roles. Touch and keyboard input must stop while a modal is active.

## Consistency and Evidence
Same surface, button, radius and motion vocabulary across all inventory rows. Normal easing cubic-bezier(0.22,1,0.36,1), 0.12s micro, 0.20s standard and restrained 0.55s entrances. Match landing art to gameplay rather than making a separate promotional world. Screenshot every surface into shots/v2/site/finish/ and aggregate a JSON audit with exactly these eleven inventory rows; missing capture or unavailable pixels is not an artistic pass. Frontend graph and verifier must reach honest audit states, never mark pending gates done by intention.

## Runtime Boundaries
Only /opt/hermes/projects/parasite-v2 and its own task scratch/media. Do not touch /opt/ashe/jobs/parasite, the live site, 9100/9101, any credential, wallet, contract deployment, publishing, provider config or gateway. Preview uses 9200/9201. No next dev; production build capped to1024MB. One writer, preview and browser per project, >=1500MB before builds/captures; terminate owned previews and profiles afterwards. Parasite scheduled writer temporarily paused during this owner-requested finish pass, then restore it with the verified checkpoint.

## Current Gates
Baseline 175 tests and root typecheck passed in this finish pass. Cold production compile exceeded a180-second runner budget; .next/trace records a214-second make phase and no orphan remained. Build is not currently claimed ready. Unseeded600-second normal-clock solo verification is assigned separately, without randomness seeds, teleport fixtures or timer acceleration. Rendering/UI audit and actual video QA are still open.
