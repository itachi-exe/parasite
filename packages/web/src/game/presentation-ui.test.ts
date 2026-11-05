import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PublicPlayer, SkinId } from '@parasite/shared';
import CrewList from '../components/CrewList';
import MenuBackdrop from '../components/MenuBackdrop';
import Lobby from '../components/Lobby';
import EndOverlay from '../components/EndOverlay';
import MeetingOverlay from '../components/MeetingOverlay';
import type { RoomState } from '@parasite/shared';

(globalThis as unknown as { React: typeof React }).React = React;
const players: PublicPlayer[] = Array.from({ length: 10 }, (_, seat) => ({
  id: `p${seat}`, seat, skin: (seat % 4) as SkinId, name: `Scientist ${seat}`,
  address: null, x: null, y: null, dir: 1, moving: false, alive: true,
  bodyReported: false, connected: true, isBot: false, tasksDone: 0, emergencyMeetingsLeft: 1,
}));

test('game over uses the published host portrait and does not claim encryption in local mode', () => {
  const html = renderToStaticMarkup(createElement(EndOverlay, {
    end: { winner: 'parasite', reason: 'parasite-outnumber', revealedParasiteSeat: 7 },
    players,
  }));
  assert.ok(html.includes('/v2/crew/7-3-parasite.webp'));
  const crew = renderToStaticMarkup(createElement(EndOverlay, {
    end: { winner: 'crew', reason: 'crew-tasks', revealedParasiteSeat: null }, players,
  }));
  assert.ok(!crew.includes('encrypted on-chain'));
});

test('waiting crew uses the actual seat portraits and truthful local mode', () => {
  const state = { players, code: 'VIRELIA' } as RoomState;
  const html = renderToStaticMarkup(createElement(Lobby, {
    state, chat: [], onSendChat() {}, mySeat: 0, connected: true, joined: true,
    isHost: true, roleMode: 'simulated', contractAddress: null, walletAddress: null,
    onConnectWallet() {}, onDisconnectWallet() {}, onJoin() {}, onStart() {},
  }));
  assert.ok(html.includes('/v2/crew/7-3-human.webp'));
  assert.ok(!html.includes('/sprites/'));
});

test('menu uses the production PBR outpost instead of the retired canvas art', () => {
  const html = renderToStaticMarkup(createElement(MenuBackdrop));
  assert.ok(html.includes('/v2/outpost-poster.webp'));
  assert.ok(!html.includes('<canvas'));
});

test('roster portraits preserve each seat and reveal only the local Parasite', () => {
  const html = renderToStaticMarkup(createElement(CrewList, { players, mySeat: 0, isParasite: true }));
  assert.ok(html.includes('/v2/crew/0-0-parasite.webp'));
  for (let seat = 1; seat < 10; seat++) assert.ok(html.includes(`/v2/crew/${seat}-${seat % 4}-human.webp`));
  assert.ok(!html.includes('/sprites/'));
});
