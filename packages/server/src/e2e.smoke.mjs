/**
 * End-to-end smoke test against a RUNNING server (not an in-process harness).
 *
 * The vitest socket tests spin the server up themselves with shortened meeting
 * timings. This one talks to the real built server over a real socket with the
 * real production timings, which is the only way to catch things that only
 * break in the shipped artefact — wrong build output, env wiring, or a protocol
 * drift between what the server emits and what the web client listens for.
 *
 * Usage: node packages/server/src/e2e.smoke.mjs [url]
 */
import { io } from 'socket.io-client';

const URL = process.argv[2] ?? 'http://127.0.0.1:9101';
const CODE = 'SMOKE' + Math.floor(Math.random() * 100000);
const NAMES = ['Ada', 'Bo', 'Cy', 'Di'];

const log = (...a) => console.log(...a);
const fail = (m) => {
  console.error('FAIL:', m);
  process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait until `pred(state)` holds, or throw. */
function waitFor(client, pred, what, timeoutMs = 45_000) {
  return new Promise((resolve, reject) => {
    if (client.state && pred(client.state)) return resolve(client.state);
    const t = setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), timeoutMs);
    client.waiters.push((s) => {
      if (!pred(s)) return false;
      clearTimeout(t);
      resolve(s);
      return true;
    });
  });
}

function connect(name) {
  const socket = io(URL, { transports: ['websocket'], forceNew: true });
  const client = { name, socket, state: null, waiters: [], role: null, events: [], positions: new Map() };

  socket.on('state', (s) => {
    client.state = s;
    client.waiters = client.waiters.filter((w) => !w(s));
  });
  socket.on('you', (p) => (client.seat = p.seat));
  socket.on('simulatedRole', (p) => (client.role = p.isParasite));
  socket.on('meetingResult', (r) => client.events.push({ meetingResult: r }));
  socket.on('gameEnded', (e) => client.events.push({ gameEnded: e }));
  socket.on('positions', (p) => {
    client.lastPositions = p;
    // Mirror what the web client does in GameStage.mergePositions: full state
    // snapshots are only sent on structural change, so live movement arrives
    // exclusively on this channel.
    for (const e of p.p) client.positions.set(e.s, { x: e.x, y: e.y, dir: e.d, moving: e.m });
  });

  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve(client));
    socket.on('connect_error', (e) => reject(new Error(`${name}: ${e.message}`)));
  });
}

/**
 * Steer a client toward (tx,ty) by re-aiming every frame off the live position
 * channel. Recomputing the heading each frame matters: a fixed vector walks
 * into a wall and `resolveMove` slides along it, so the client must keep
 * correcting or it parks against the geometry forever.
 */
async function walkTo(c, tx, ty, withinPx = 22, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const p = c.positions.get(c.seat);
    if (!p) {
      await sleep(60);
      continue;
    }
    const dx = tx - p.x;
    const dy = ty - p.y;
    const d = Math.hypot(dx, dy);
    if (d <= withinPx) {
      c.socket.emit('input', { ax: 0, ay: 0, seq: Date.now() });
      await sleep(120);
      return true;
    }
    c.socket.emit('input', { ax: dx / d, ay: dy / d, seq: Date.now() });
    await sleep(80);
  }
  c.socket.emit('input', { ax: 0, ay: 0, seq: Date.now() });
  const p = c.positions.get(c.seat);
  throw new Error(`${c.name} could not reach ${tx},${ty} (stuck at ${p?.x?.toFixed(0)},${p?.y?.toFixed(0)})`);
}

const emit = (c, ev, payload) =>
  new Promise((resolve) => {
    if (payload === undefined) c.socket.emit(ev, resolve);
    else c.socket.emit(ev, payload, resolve);
  });

async function main() {
  log(`\n▸ connecting 4 clients to ${URL} (room ${CODE})`);
  const clients = [];
  for (const n of NAMES) clients.push(await connect(n));

  // ── join ───────────────────────────────────────────────────────────────────
  for (let i = 0; i < clients.length; i++) {
    const res = await emit(clients[i], 'join', {
      code: CODE,
      name: NAMES[i],
      skin: i % 4,
      address: null,
    });
    if (!res?.ok) fail(`${NAMES[i]} could not join: ${res?.error}`);
  }
  log('  ✓ 4 players joined the lobby');

  // A 5th join AFTER start must be rejected — the spec's hard invariant.
  const host = clients[0];
  const startRes = await emit(host, 'startGame');
  if (!startRes?.ok) fail(`startGame refused: ${startRes.error}`);
  await waitFor(host, (s) => s.phase === 'playing', 'phase=playing');
  log('  ✓ game started');

  const late = await connect('LateJoiner');
  const lateRes = await emit(late, 'join', { code: CODE, name: 'Late', skin: 1, address: null });
  if (lateRes?.ok) fail('SECURITY: a player joined mid-game — lobby-only invariant broken');
  log(`  ✓ mid-game join rejected server-side ("${lateRes.error}")`);
  late.socket.disconnect();

  // ── roles ──────────────────────────────────────────────────────────────────
  await sleep(400);
  const parasites = clients.filter((c) => c.role === true);
  if (parasites.length !== 1) fail(`expected exactly 1 parasite, got ${parasites.length}`);
  for (const c of clients) {
    if (typeof c.role !== 'boolean') fail(`${c.name} never received its own role`);
  }
  log(`  ✓ exactly one Parasite assigned, each client got only its own role`);

  // ── movement ───────────────────────────────────────────────────────────────
  // Read positions from the fast channel, exactly as the web client does.
  const mover = clients[1];
  await sleep(300);
  const before = { ...mover.positions.get(mover.seat) };
  if (before.x === undefined) fail('never received a positions broadcast before moving');
  mover.socket.emit('input', { ax: 1, ay: 0, seq: 1 });
  await sleep(700);
  mover.socket.emit('input', { ax: 0, ay: 0, seq: 2 });
  await sleep(250);
  const after = mover.positions.get(mover.seat);
  if (Math.hypot(after.x - before.x, after.y - before.y) < 5) {
    fail(`movement did not sync: ${before.x},${before.y} -> ${after.x},${after.y}`);
  }
  // Movement must also be visible to OTHER clients, not just the mover.
  const observer = clients[2];
  const seenByOther = observer.positions.get(mover.seat);
  if (!seenByOther || Math.hypot(seenByOther.x - after.x, seenByOther.y - after.y) > 40) {
    fail(`another client did not see the movement (saw ${seenByOther?.x},${seenByOther?.y})`);
  }
  log(`  ✓ movement synced (${before.x.toFixed(0)},${before.y.toFixed(0)} → ${after.x.toFixed(0)},${after.y.toFixed(0)}) and mirrored to other clients`);

  // ── tasks ──────────────────────────────────────────────────────────────────
  // 'upload-research-data' sits on the central platform, near the spawn ring.
  const UPLOAD = { x: 800, y: 600 };
  const crew = clients.find((c) => c.role === false);
  const t0 = crew.state.taskProgress.done;

  // Completing from across the map must be refused by the server.
  const farRes = await emit(crew, 'completeTask', { taskId: 'analyze-bio-samples' });
  if (farRes?.ok) fail('SECURITY: a task was claimed from out of range');
  log(`  ✓ out-of-range task claim rejected ("${farRes.error}")`);

  await walkTo(crew, UPLOAD.x, UPLOAD.y);
  const tr = await emit(crew, 'completeTask', { taskId: 'upload-research-data' });
  if (!tr?.ok) fail(`completeTask refused at the station: ${tr?.error}`);
  await waitFor(crew, (s) => s.taskProgress.done > t0, 'task progress to advance');
  log(`  ✓ task completed at station, progress ${t0} → ${crew.state.taskProgress.done}/${crew.state.taskProgress.total}`);

  // The Parasite's "fake tasks" are enforced CLIENT-side (GameClient short-
  // circuits and never emits), because the server is deliberately role-ignorant
  // and cannot tell who the Parasite is. This asserts the honest property: the
  // task target is sized as (players-1) * TASKS_PER_PLAYER, so a cheating
  // Parasite who submits anyway only ever *helps the crew win* — the exploit is
  // self-defeating, which is why the weaker client-side guard is acceptable.
  const expectedTotal = (clients.length - 1) * 5;
  if (crew.state.taskProgress.total !== expectedTotal) {
    fail(`task total should be ${expectedTotal} (players-1 x 5), got ${crew.state.taskProgress.total}`);
  }
  log(`  ✓ task target excludes one player (${crew.state.taskProgress.total} = (${clients.length}-1) x 5); Parasite cheating on tasks only helps the crew`);

  // ── purge → body → report ──────────────────────────────────────────────────
  const killer = parasites[0];
  const victim = clients.find((c) => c !== killer && c.role === false);
  await walkTo(killer, UPLOAD.x, UPLOAD.y);
  await walkTo(victim, UPLOAD.x + 30, UPLOAD.y);

  const pr = await emit(killer, 'purge', { targetSeat: victim.seat });
  if (!pr?.ok) fail(`purge refused: ${pr?.error}`);
  await waitFor(killer, (s) => s.players.find((p) => p.seat === victim.seat)?.alive === false, 'victim dead');
  await waitFor(killer, (s) => s.bodies.some((b) => b.seat === victim.seat), 'body to appear');
  log(`  ✓ Parasite purged seat ${victim.seat}; body left at the scene`);

  // A dead player must not be able to act.
  const deadVote = await emit(victim, 'callMeeting');
  if (deadVote?.ok) fail('SECURITY: a dead player called a meeting');
  log(`  ✓ dead player cannot act ("${deadVote.error}")`);

  const reporter = clients.find((c) => c !== killer && c !== victim && c.role === false) ?? clients.find((c) => c !== killer && c !== victim);
  await walkTo(reporter, UPLOAD.x + 10, UPLOAD.y + 10);
  const rr = await emit(reporter, 'reportBody', { victimSeat: victim.seat });
  if (!rr?.ok) fail(`reportBody refused: ${rr?.error}`);
  await waitFor(reporter, (s) => s.phase === 'meeting', 'meeting from body report');
  log('  ✓ body reported → meeting started');

  await waitFor(reporter, (s) => s.meeting?.stage === 'voting', 'voting stage', 60_000);
  const living = reporter.state.players.filter((p) => p.alive);
  for (const c of clients) {
    if (c === victim) continue;
    await emit(c, 'castVote', { target: 'skip' });
  }
  await waitFor(reporter, (s) => s.meeting?.stage === 'result' || s.phase !== 'meeting', 'skip resolution', 60_000);
  const skipResult = reporter.events.filter((e) => e.meetingResult).pop().meetingResult;
  if (skipResult.ejectedSeat !== null) fail('a unanimous skip still ejected someone');
  log('  ✓ unanimous skip ejected nobody');
  await waitFor(reporter, (s) => s.phase === 'playing', 'return to play', 60_000);
  log('  ✓ returned to play after the meeting');

  // ── meeting + vote ─────────────────────────────────────────────────────────
  const caller = clients.find((c) => c !== victim && c.state.players.find((p) => p.seat === c.seat)?.alive);
  const mr = await emit(caller, 'callMeeting');
  if (!mr?.ok) fail(`callMeeting refused: ${mr?.error}`);
  await waitFor(caller, (s) => s.phase === 'meeting', 'phase=meeting');
  log('  ✓ emergency meeting called → discussion stage');

  await waitFor(caller, (s) => s.meeting?.stage === 'voting', 'voting stage', 60_000);
  log('  ✓ discussion elapsed → voting stage');

  const target = clients.find((c) => c !== victim && c !== caller && c.role === false)?.seat
    ?? clients.find((c) => c !== victim && c !== caller).seat;
  for (const c of clients) {
    if (c === victim) continue;
    const vr = await emit(c, 'castVote', { target });
    if (!vr?.ok) fail(`${c.name} vote refused: ${vr?.error}`);
  }
  await waitFor(
    caller,
    (s) => s.meeting?.stage === 'result' || s.phase !== 'meeting',
    'vote resolution',
    60_000
  );
  const result = caller.events.filter((e) => e.meetingResult).pop().meetingResult;
  if (!result) fail('no meetingResult event was emitted');
  if (result.ejectedSeat !== target) {
    fail(`wrong player ejected: expected seat ${target}, got ${result.ejectedSeat}`);
  }
  log(`  ✓ majority vote ejected seat ${target} (tie=${result.tie})`);

  await waitFor(caller, (s) => s.players.find((p) => p.seat === target)?.alive === false, 'ejected player dead');
  log('  ✓ ejected player marked dead in authoritative state');

  for (const c of clients) c.socket.disconnect();
  log('\n✅ E2E SMOKE PASSED — full loop verified over the wire\n');
  process.exit(0);
}

main().catch((e) => fail(e.message));
