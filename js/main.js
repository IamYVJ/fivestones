import { Host } from './host.js';
import { HostNet, ClientNet, genCode, normCode } from './net.js';
import { BoardView } from './board.js';
import { SIZES, LENS } from './rules.js';

const $ = id => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
const token = store.get('fs.token') || (store.set('fs.token', uid()), store.get('fs.token'));

let mode = null;          // 'host' | 'client'
let host = null, hostNet = null, clientNet = null;
let view = null, roomCode = null, retryUntil = 0, leaving = false;

// ---------- helpers ----------
function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('active', s.id === id);
}
let toastT;
function toast(text) {
  const t = $('toast'); t.textContent = text; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
}
function banner(text) { const b = $('banner'); b.hidden = !text; b.textContent = text || ''; }
const myName = () => ($('name').value.trim() || 'Player').slice(0, 16);

function send(msg) {
  if (mode === 'host') host.handle('local', msg);
  else if (clientNet) clientNet.send(msg);
}

// ---------- home ----------
$('name').value = store.get('fs.name') || '';
$('name').addEventListener('input', () => store.set('fs.name', $('name').value));
const params = new URLSearchParams(location.search);
if (params.get('room')) $('code').value = normCode(params.get('room'));
$('code').addEventListener('input', e => { e.target.value = normCode(e.target.value); });

function snapOf() { try { return JSON.parse(store.get('fs.host') || 'null'); } catch { return null; } }
$('btn-resume').hidden = !snapOf();

async function startHost(snap) {
  leaving = false;
  host = null; hostNet = new HostNet();
  const tries = snap ? 1 : 6;
  let code = snap ? snap.code : null, ok = false;
  for (let i = 0; i < tries && !ok; i++) {
    code = snap ? snap.code : genCode();
    try {
      await hostNet.open(code, {
        onMessage: (id, m) => host && host.handle(id, m),
        onDisconnect: id => host && host.disconnect(id),
      });
      ok = true;
    } catch (e) {
      hostNet.close(); hostNet = new HostNet();
      if (e && e.type === 'unavailable-id') continue;
      toast(e && e.message === 'timeout' ? 'Could not reach the signalling server' : 'Could not start a room');
      return;
    }
  }
  if (!ok) { toast(snap ? 'That room is still open elsewhere. Try again shortly.' : 'Could not start a room'); return; }
  mode = 'host'; roomCode = code;
  host = new Host({
    code, sendTo: (id, m) => hostNet.send(id, m), onView: render,
    save: s => store.set('fs.host', JSON.stringify(s)),
  });
  if (snap) host.restore(snap);
  host.hello('local', { token, name: myName() });
}

$('btn-host').onclick = () => { store.set('fs.name', myName()); startHost(null); };
$('btn-resume').onclick = () => { const s = snapOf(); if (s) startHost(s); };

async function joinRoom(code, quiet) {
  leaving = false;
  clientNet = new ClientNet();
  try {
    await clientNet.join(code, {
      onMessage: m => {
        if (m.t === 'state') { retryUntil = 0; banner(''); render(m); }
        else if (m.t === 'err') toast(m.text);
      },
      onClose: () => { if (!leaving) reconnect(code); },
    });
  } catch (e) {
    clientNet.close(); clientNet = null;
    if (quiet) return false;
    toast(e && e.type === 'peer-unavailable' ? 'Room not found' : 'Could not connect');
    return false;
  }
  mode = 'client'; roomCode = code;
  clientNet.send({ t: 'hello', token, name: myName() });
  return true;
}
$('btn-join').onclick = () => {
  const code = normCode($('code').value);
  if (code.length !== 4) return toast('Enter the 4-character code');
  store.set('fs.name', myName());
  joinRoom(code);
};
async function reconnect(code) {
  if (!retryUntil) retryUntil = Date.now() + 30000;
  banner('Connection lost. Reconnecting...');
  while (!leaving && Date.now() < retryUntil) {
    if (await joinRoom(code, true)) return;
    await new Promise(r => setTimeout(r, 2000));
  }
  if (!leaving) { toast('Disconnected from the room'); leave(); }
}

function leave(keepRoom) {
  leaving = true; retryUntil = 0; banner('');
  if (hostNet) hostNet.close();
  if (clientNet) clientNet.close();
  if (host) host.clearBot();
  if (mode === 'host' && !keepRoom) store.del('fs.host');
  host = hostNet = clientNet = view = mode = null;
  $('btn-resume').hidden = !snapOf();
  show('home');
}
for (const id of ['btn-leave-lobby', 'btn-leave-game']) $(id).onclick = () => {
  if (mode === 'host' && !confirm('Close the room for everyone?')) return;
  leave();
};

// ---------- render ----------
function render(v) {
  view = v;
  const playing = v.phase !== 'lobby';
  show(playing ? 'game' : 'lobby');
  if (playing) renderGame(v); else renderLobby(v);
}

// lobby
const setSize = $('set-size'), setLen = $('set-len'), setOver = $('set-overline');
for (const s of SIZES) setSize.add(new Option(`${s} x ${s}`, s));
for (const l of LENS) setLen.add(new Option(l === 5 ? 'Five' : l === 4 ? 'Four' : 'Six', l));
for (const el of [setSize, setLen, setOver])
  el.onchange = () => send({ t: 'settings', settings: { size: +setSize.value, len: +setLen.value, overline: setOver.value } });

function seatCard(n, v) {
  const el = $('seat' + n), info = v.seats[n];
  el.replaceChildren();
  const h = document.createElement('h3');
  const st = document.createElement('span'); st.className = 'stone ' + (n === 1 ? 'b' : 'w');
  h.append(st, n === 1 ? 'Black (first)' : 'White');
  const who = document.createElement('div');
  who.className = 'who' + (info ? '' : ' empty');
  who.textContent = info ? info.name + (info.host ? ' (host)' : '') + (info.online ? '' : ' - offline') : 'Empty';
  const btns = document.createElement('div'); btns.className = 'btns';
  const mk = (label, fn, cls = 'ghost small') => { const b = document.createElement('button'); b.className = cls; b.textContent = label; b.onclick = fn; btns.append(b); };
  if (!info) {
    mk('Sit here', () => send({ t: 'sit', seat: n }), 'primary small');
    if (v.you.host) {
      const sel = document.createElement('select');
      for (const l of ['easy', 'normal', 'hard']) sel.add(new Option(l[0].toUpperCase() + l.slice(1), l));
      sel.value = 'normal'; btns.append(sel);
      mk('Add computer', () => send({ t: 'bot', seat: n, level: sel.value }));
    }
  } else if (v.you.seat === n) mk('Stand up', () => send({ t: 'sit', seat: 0 }));
  else if (info.bot && v.you.host) mk('Remove', () => send({ t: 'bot', seat: n, level: null }));
  el.append(h, who, btns);
}
function renderLobby(v) {
  $('room-code').textContent = v.code;
  seatCard(1, v); seatCard(2, v);
  $('spectators').textContent = v.spectators.length ? 'Watching: ' + v.spectators.join(', ') : '';
  setSize.value = v.settings.size; setLen.value = v.settings.len; setOver.value = v.settings.overline;
  $('settings').disabled = !v.you.host;
  const ready = v.seats[1] && v.seats[2];
  $('btn-start').hidden = !v.you.host;
  $('btn-start').disabled = !ready;
  $('lobby-hint').textContent = v.you.host
    ? (ready ? '' : 'Fill both seats: invite a friend or add a computer.')
    : 'Waiting for the host to start...';
}
$('btn-start').onclick = () => send({ t: 'start' });
$('btn-copy').onclick = async () => {
  const url = location.origin + location.pathname + '?room=' + roomCode;
  try { await navigator.clipboard.writeText(url); toast('Invite link copied'); }
  catch { toast('Code: ' + roomCode); }
};

// game
const board = new BoardView($('board'), (x, y) => {
  if (view && view.phase === 'playing' && view.you.seat === view.turn) send({ t: 'move', x, y });
});
function chip(n, v) {
  const el = $('chip' + n), info = v.seats[n];
  el.querySelector('.pname').textContent = info ? info.name : '-';
  el.querySelector('.score').textContent = v.scores[n];
  el.classList.toggle('turn', v.phase === 'playing' && v.turn === n);
  el.classList.toggle('offline', !!info && !info.online);
  const sub = el.querySelector('.psub');
  if (v.phase === 'over') sub.textContent = v.winner === n ? 'Winner' : '';
  else if (info && !info.online) sub.textContent = 'Offline';
  else if (v.turn === n) sub.textContent = v.you.seat === n ? 'Your turn' : (info && info.bot ? 'Thinking...' : 'Playing...');
  else sub.textContent = v.you.seat === n ? 'You' : '';
}
function renderGame(v) {
  chip(1, v); chip(2, v);
  const mine = v.you.seat, myTurn = v.phase === 'playing' && mine === v.turn;
  board.set({ size: v.settings.size, moves: v.moves, winLine: v.winLine, canPlay: myTurn, turn: v.turn });
  const st = $('status'); st.className = 'status';
  const nm = n => (v.seats[n] ? v.seats[n].name : '?');
  if (v.phase === 'over') {
    st.classList.add('win');
    st.textContent = v.draw ? 'Draw: the board is full' : (mine === v.winner ? 'You win!' : nm(v.winner) + ' wins');
  } else if (myTurn) st.textContent = 'Your turn';
  else st.textContent = mine ? 'Waiting for ' + nm(v.turn) + '...' : nm(v.turn) + ' to move';

  const playing = v.phase === 'playing', over = v.phase === 'over';
  const canUndo = playing && mine && !v.undo && v.moves.some(m => m.c === mine);
  $('btn-undo').hidden = !mine || !playing;
  $('btn-undo').disabled = !canUndo;
  $('btn-undo').textContent = v.undo && v.undo.by === mine ? 'Undo requested...' : 'Undo';
  $('btn-resign').hidden = !mine || !playing;
  $('btn-again').hidden = !(over && v.you.host);
  $('btn-tolobby').hidden = !(v.you.host && v.phase !== 'lobby');
  $('undo-ask').hidden = !(v.undo && mine && v.undo.by !== mine);
}
$('btn-undo').onclick = () => send({ t: 'undoReq' });
$('btn-undo-yes').onclick = () => send({ t: 'undoRes', ok: true });
$('btn-undo-no').onclick = () => send({ t: 'undoRes', ok: false });
$('btn-resign').onclick = () => { if (confirm('Resign this game?')) send({ t: 'resign' }); };
$('btn-again').onclick = () => send({ t: 'again' });
$('btn-tolobby').onclick = () => send({ t: 'lobby' });

addEventListener('beforeunload', () => { if (host) host.save(host.snapshot()); });
if ('serviceWorker' in navigator && location.protocol.startsWith('http'))
  navigator.serviceWorker.register('sw.js').catch(() => {});
