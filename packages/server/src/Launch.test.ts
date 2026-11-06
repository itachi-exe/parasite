import { afterEach, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import { GameServer } from './GameServer.js';

let game: GameServer;
let io: Server;
const clients: Socket[] = [];
afterEach(async () => {
  clients.forEach(c => c.disconnect()); clients.length = 0;
  game?.stop();
  if (io) await new Promise<void>(resolve => io.close(() => resolve()));
});
async function setup() {
  const http = createServer(); io = new Server(http);
  game = new GameServer(io, { contractAddress: null, maxRooms: 2 });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  return async () => {
    const s = connect(`http://127.0.0.1:${(http.address() as any).port}`, { transports: ['websocket'], reconnection: false });
    clients.push(s);
    await new Promise<void>((resolve, reject) => { s.once('connect', resolve); s.once('connect_error', reject); });
    return s;
  };
}
it('rejects a malformed room code without crashing or allocating a room', async () => {
  const client = await (await setup())();
  const result = await client.timeout(1000).emitWithAck('join', { code: 42, name: 'Test', skin: 0, address: null });
  expect(result.ok).toBe(false);
  expect(game.roomFor('42')).toBeUndefined();
});
it('prevents one socket from accumulating abandoned rooms', async () => {
  const client = await (await setup())();
  expect((await client.timeout(1000).emitWithAck('join', { code: 'FIRST', name: 'Test' })).ok).toBe(true);
  expect((await client.timeout(1000).emitWithAck('join', { code: 'SECOND', name: 'Test' })).ok).toBe(false);
  expect(game.roomFor('SECOND')).toBeUndefined();
});
it('caps room allocation but lets players join an existing outpost', async () => {
  const connect = await setup();
  const a = await connect(), b = await connect(), c = await connect();
  expect((await a.timeout(1000).emitWithAck('join', { code: 'A', name: 'A' })).ok).toBe(true);
  expect((await b.timeout(1000).emitWithAck('join', { code: 'B', name: 'B' })).ok).toBe(true);
  expect((await c.timeout(1000).emitWithAck('join', { code: 'C', name: 'C' })).ok).toBe(false);
  expect(game.roomFor('C')).toBeUndefined();
  expect((await c.timeout(1000).emitWithAck('join', { code: 'A', name: 'C' })).ok).toBe(true);
});
it('disconnects a socket that floods application events', async () => {
  const client = await (await setup())();
  const disconnected = new Promise(resolve => client.once('disconnect', resolve));
  for (let i = 0; i < 400; i++) client.emit('input', { ax: 0, ay: 0 });
  await Promise.race([disconnected, new Promise((_, reject) => setTimeout(() => reject(new Error('flood was not disconnected')), 1000))]);
  expect(client.connected).toBe(false);
});
it('disconnects malformed application packets instead of throwing in handlers', async () => {
  const client = await (await setup())();
  expect((await client.timeout(1000).emitWithAck('join', { code: 'VALID', name: 'Test' })).ok).toBe(true);
  const disconnected = new Promise(resolve => client.once('disconnect', resolve));
  client.emit('sendChat', { text: 42 });
  await Promise.race([disconnected, new Promise((_, reject) => setTimeout(() => reject(new Error('malformed packet was not rejected')), 1000))]);
  expect(client.connected).toBe(false);
});
