import { createServer } from 'node:http';
import { Server } from 'socket.io';
import * as dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameServer } from './GameServer.js';
import { MIN_PLAYERS, MAX_PLAYERS } from '@parasite/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const PORT = Number(process.env.PORT ?? 9101);
// Bind to loopback by default. Do not expose this publicly without adding auth
// and rate limiting — there is no account system.
const HOST = process.env.HOST ?? '127.0.0.1';
const CONTRACT = process.env.NEXT_PUBLIC_PARASITE_GAME_ADDRESS?.trim() || null;

const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, roleMode: CONTRACT ? 'inco' : 'simulated' }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const io = new Server(http, {
    maxHttpBufferSize: 64 * 1024,
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      callback(null, !origin || ['https://theparasite.xyz', 'https://www.theparasite.xyz'].includes(origin));
    },
  cors: {
    origin: ['https://theparasite.xyz', 'https://www.theparasite.xyz'],
    methods: ['GET', 'POST'],
  },
});

const game = new GameServer(io, { contractAddress: CONTRACT, maxRooms: 4 });

http.listen(PORT, HOST, () => {
  const mode = CONTRACT ? 'INCO (on-chain encrypted roles)' : 'SIMULATED (no contract configured)';
  console.log(`
  ┌──────────────────────────────────────────────────────────┐
  │  PARASITE: game server                                    │
  └──────────────────────────────────────────────────────────┘
  listening   http://${HOST}:${PORT}
  players     ${MIN_PLAYERS} to ${MAX_PLAYERS}
  role mode   ${mode}
  ${CONTRACT ? `contract    ${CONTRACT}` : ''}
${
  CONTRACT
    ? ''
    : `
  NOTE: running with simulated roles. Roles are NOT encrypted in this mode.
  To enable real Inco confidentiality, deploy the contract and set
  NEXT_PUBLIC_PARASITE_GAME_ADDRESS in .env:
      npm run deploy:baseSepolia
`
}`);
});

const shutdown = () => {
  console.log('\nshutting down…');
  game.stop();
  io.close();
  http.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
