import assert from 'node:assert/strict';
import { newGame, play, undoFor } from '../js/rules.js';
import { chooseMove } from '../js/bot.js';
import { Host } from '../js/host.js';

// --- rules ---
let g = newGame({});
for (let i = 0; i < 4; i++) { play(g, i, 0); play(g, i, 1); }
assert.equal(g.winner, 0);
play(g, 4, 0);
assert.equal(g.winner, 1, 'black wins with five');
assert.equal(g.winLine.length, 5);

// exact: six does not win
g = newGame({ overline: 'exact' });
for (const x of [0, 1, 2, 4, 5]) { play(g, x, 0); play(g, x, 5 + (x % 2) * 3 + (x > 2 ? 1 : 0) ); }
assert.equal(g.winner, 0);
g.turn = 1; play(g, 3, 0);
assert.equal(g.winner, 0, 'six in a row ignored under exact');
g = newGame({ overline: 'allow' });
for (const x of [0, 1, 2, 4, 5]) { play(g, x, 0); play(g, x, 5 + (x % 2) * 3 + (x > 2 ? 1 : 0)); }
g.turn = 1; play(g, 3, 0);
assert.equal(g.winner, 1, 'six wins under allow');

// diagonal
g = newGame({});
for (let i = 0; i < 5; i++) { play(g, i, i); if (i < 4) play(g, i + 1, i); }
assert.equal(g.winner, 1);

// occupied / bounds
g = newGame({});
play(g, 3, 3);
assert.equal(play(g, 3, 3).ok, false);
assert.equal(play(g, -1, 0).ok, false);
assert.equal(play(g, 15, 0).ok, false);

// undo
g = newGame({});
play(g, 1, 1); play(g, 2, 2); play(g, 3, 3);
assert.ok(undoFor(g, 1));
assert.equal(g.moves.length, 2); assert.equal(g.turn, 1);
assert.equal(g.board[3 * 15 + 3], 0);

// --- bot: takes the win, blocks the loss ---
g = newGame({});
for (let i = 0; i < 4; i++) { play(g, i, 0); if (i < 3) play(g, i, 5); }
g.turn = 1;
assert.deepEqual(chooseMove(g, 'hard'), { x: 4, y: 0 }, 'bot completes five');
g = newGame({});
play(g, 7, 7); for (let i = 0; i < 4; i++) { play(g, i, 0); if (i < 3) play(g, 10 + i, 10); else break; }
// white (turn 2) must block black's open four-ish
g = newGame({});
const seq = [[0, 0], [5, 5], [1, 0], [6, 6], [2, 0], [9, 9], [3, 0]];
seq.forEach(([x, y]) => play(g, x, y));
const mv = chooseMove(g, 'normal');
assert.equal(mv.y, 0); assert.equal(mv.x, 4, 'bot blocks the four');

// bot vs bot finishes
g = newGame({ size: 9 });
for (let i = 0; i < 81 && !g.winner && !g.draw; i++) { const m = chooseMove(g, 'normal'); assert.ok(play(g, m.x, m.y).ok); }
assert.ok(g.winner || g.draw);

// --- host controller ---
const out = [];
const h = new Host({ code: 'TEST', sendTo: (id, m) => out.push([id, m]), onView: v => out.push(['local', v]), botDelay: 5 });
h.handle('local', { t: 'hello', token: 'H', name: 'Hosty' });
h.handle('c1', { t: 'hello', token: 'J', name: 'Joiner' });
h.handle('c2', { t: 'hello', token: 'S', name: 'Spec' });
let v = h.view('S'); assert.equal(v.you.seat, 0); assert.equal(v.seats[1].name, 'Hosty'); assert.equal(v.seats[2].name, 'Joiner');
h.handle('c1', { t: 'start' }); assert.equal(h.phase, 'lobby', 'non-host cannot start');
h.handle('local', { t: 'settings', settings: { size: 13 } });
h.handle('local', { t: 'start' }); assert.equal(h.phase, 'playing');
h.handle('c1', { t: 'move', x: 1, y: 1 }); assert.equal(h.game.moves.length, 0, 'not white turn');
h.handle('local', { t: 'move', x: 6, y: 6 }); h.handle('c1', { t: 'move', x: 5, y: 5 });
h.handle('local', { t: 'undoReq' }); assert.ok(h.undo);
h.handle('c1', { t: 'undoRes', ok: true });
assert.equal(h.game.moves.length, 1 - 1 + 1 - 1 + 1 - 0 - 1 + 0, 'undo took back black move and following white move');
h.handle('local', { t: 'resign' }); assert.equal(h.phase, 'over'); assert.equal(h.scores[2], 1);
h.handle('local', { t: 'again' }); assert.equal(h.seats[1].token, 'J', 'colours swapped');
assert.equal(h.scores[1], 1);
// reconnect keeps seat
h.disconnect('c1'); h.handle('c9', { t: 'hello', token: 'J', name: 'Joiner' });
assert.equal(h.view('J').you.seat, 1);
// snapshot round trip
const h2 = new Host({ code: 'TEST', sendTo() {}, onView() {} });
h2.restore(JSON.parse(JSON.stringify(h.snapshot())));
assert.equal(h2.phase, 'playing'); assert.equal(h2.game.moves.length, h.game.moves.length);

// vs bot
const hb = new Host({ code: 'BOT1', sendTo() {}, onView() {}, botDelay: 5 });
hb.handle('local', { t: 'hello', token: 'H', name: 'Me' });
hb.handle('local', { t: 'bot', seat: 2, level: 'hard' });
hb.handle('local', { t: 'start' });
hb.handle('local', { t: 'move', x: 7, y: 7 });
await new Promise(r => setTimeout(r, 50));
assert.equal(hb.game.moves.length, 2, 'bot replied');
hb.handle('local', { t: 'undoReq' });
assert.equal(hb.game.moves.length, 0, 'instant undo vs bot');

console.log('all engine tests passed');
