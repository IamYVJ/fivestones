// Host-authoritative room logic. No DOM, no networking: transport is injected.
import { sanitize, newGame, restoreGame, play, undoFor } from './rules.js';
import { chooseMove } from './bot.js';

const MAX_MEMBERS = 12;
const clean = (s, n = 16) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);

export class Host {
  constructor({ code, sendTo, onView, save, botDelay = 600 }) {
    this.code = code;
    this.sendTo = sendTo;
    this.onView = onView;
    this.save = save || (() => {});
    this.botDelay = botDelay;
    this.members = new Map();       // token -> {name, connId, online}
    this.conns = new Map();         // connId -> token
    this.seats = [null, null, null]; // 1 black, 2 white: {token} | {bot}
    this.settings = sanitize();
    this.phase = 'lobby';           // lobby | playing | over
    this.game = null;
    this.scores = [0, 0, 0];
    this.undo = null;
    this.botTimer = null;
    this.hostToken = null;
  }

  // ---- persistence ----
  snapshot() {
    return {
      code: this.code, hostToken: this.hostToken, settings: this.settings, phase: this.phase,
      seats: this.seats, scores: this.scores,
      members: [...this.members].map(([t, m]) => [t, m.name]),
      moves: this.game ? this.game.moves : [],
    };
  }
  restore(s) {
    this.hostToken = s.hostToken;
    this.settings = sanitize(s.settings);
    this.phase = s.phase;
    this.seats = s.seats;
    this.scores = s.scores;
    for (const [t, name] of s.members) this.members.set(t, { name, connId: null, online: false });
    if (this.phase !== 'lobby') this.game = restoreGame(this.settings, s.moves);
    if (this.game && (this.game.winner || this.game.draw)) this.phase = 'over';
  }

  // ---- connection lifecycle ----
  hello(connId, { token, name }) {
    token = clean(token, 64);
    if (!token) return;
    let m = this.members.get(token);
    if (!m) {
      if (this.members.size >= MAX_MEMBERS) return this.sendTo(connId, { t: 'err', text: 'Room is full' });
      m = { name: '', connId: null, online: false };
      this.members.set(token, m);
      if (!this.hostToken) this.hostToken = token;
    }
    if (m.connId && m.connId !== connId) this.conns.delete(m.connId);
    m.connId = connId; m.online = true;
    m.name = clean(name) || m.name || 'Player';
    this.conns.set(connId, token);
    if (this.phase === 'lobby' && !this.seatOf(token)) {
      const free = this.seats[1] ? (this.seats[2] ? 0 : 2) : 1;
      if (free) this.seats[free] = { token };
    }
    this.changed();
  }
  disconnect(connId) {
    const token = this.conns.get(connId);
    if (!token) return;
    this.conns.delete(connId);
    const m = this.members.get(token);
    if (m && m.connId === connId) { m.online = false; m.connId = null; }
    this.changed();
  }

  seatOf(token) {
    for (const s of [1, 2]) if (this.seats[s] && this.seats[s].token === token) return s;
    return 0;
  }
  isHost(token) { return token === this.hostToken; }

  // ---- intents ----
  handle(connId, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') return this.hello(connId, msg);
    const token = this.conns.get(connId);
    if (!token) return;
    const seat = this.seatOf(token);
    const host = this.isHost(token);
    const err = text => this.sendTo(connId, { t: 'err', text });

    switch (msg.t) {
      case 'name': {
        const m = this.members.get(token); m.name = clean(msg.name) || m.name; break;
      }
      case 'sit': {
        if (this.phase !== 'lobby') return err('Game already started');
        const want = msg.seat | 0;
        if (want === 0) { if (seat) this.seats[seat] = null; }
        else if ([1, 2].includes(want)) {
          if (this.seats[want]) return err('Seat taken');
          if (seat) this.seats[seat] = null;
          this.seats[want] = { token };
        }
        break;
      }
      case 'bot': {
        if (!host || this.phase !== 'lobby') return;
        const s = msg.seat | 0;
        if (![1, 2].includes(s)) return;
        if (msg.level === null) { if (this.seats[s] && this.seats[s].bot) this.seats[s] = null; }
        else if (!this.seats[s]) this.seats[s] = { bot: ['easy', 'normal', 'hard'].includes(msg.level) ? msg.level : 'normal' };
        break;
      }
      case 'settings':
        if (!host || this.phase !== 'lobby') return;
        this.settings = sanitize({ ...this.settings, ...msg.settings });
        break;
      case 'start':
        if (!host || this.phase !== 'lobby') return;
        if (!this.seats[1] || !this.seats[2]) return err('Both seats must be filled');
        this.begin();
        break;
      case 'again': // host: new game, colours swapped
        if (!host || this.phase !== 'over') return;
        this.seats = [null, this.seats[2], this.seats[1]];
        this.scores = [0, this.scores[2], this.scores[1]];
        this.begin();
        break;
      case 'lobby':
        if (!host || this.phase === 'lobby') return;
        this.clearBot(); this.phase = 'lobby'; this.game = null; this.undo = null;
        break;
      case 'move': {
        if (this.phase !== 'playing' || !seat || seat !== this.game.turn) return;
        const r = play(this.game, msg.x, msg.y);
        if (!r.ok) return err(r.error);
        this.undo = null;
        this.afterMove();
        break;
      }
      case 'resign':
        if (this.phase !== 'playing' || !seat) return;
        this.finish(3 - seat);
        break;
      case 'undoReq': {
        if (this.phase !== 'playing' || !seat || this.undo) return;
        if (!this.game.moves.some(m => m.c === seat)) return err('Nothing to undo');
        const other = this.seats[3 - seat];
        if (other && other.bot) { this.clearBot(); undoFor(this.game, seat); this.afterMove(); }
        else this.undo = { by: seat };
        break;
      }
      case 'undoRes': {
        if (!this.undo || seat !== 3 - this.undo.by) return;
        const by = this.undo.by; this.undo = null;
        if (msg.ok) { undoFor(this.game, by); this.afterMove(); }
        break;
      }
      case 'ping': return;
      default: return;
    }
    this.changed();
  }

  // ---- game flow ----
  begin() {
    this.clearBot();
    this.game = newGame(this.settings);
    this.phase = 'playing';
    this.undo = null;
    this.afterMove();
    this.changed();
  }
  afterMove() {
    const g = this.game;
    if (g.winner) return this.finish(g.winner);
    if (g.draw) { this.phase = 'over'; return; }
    this.scheduleBot();
  }
  finish(winner) {
    this.clearBot();
    this.phase = 'over';
    this.game.winner = winner;
    this.scores[winner]++;
    this.undo = null;
    this.changed();
  }
  clearBot() { if (this.botTimer) { clearTimeout(this.botTimer); this.botTimer = null; } }
  scheduleBot() {
    this.clearBot();
    const g = this.game;
    const s = this.seats[g.turn];
    if (this.phase !== 'playing' || !s || !s.bot) return;
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      if (this.phase !== 'playing' || this.game !== g) return;
      const mv = chooseMove(g, s.bot);
      if (mv) { play(g, mv.x, mv.y); this.afterMove(); this.changed(); }
    }, this.botDelay);
  }

  // ---- views ----
  seatInfo(s) {
    const x = this.seats[s];
    if (!x) return null;
    if (x.bot) return { name: 'Computer (' + x.bot + ')', bot: x.bot, online: true };
    const m = this.members.get(x.token);
    return { name: m ? m.name : '?', bot: null, online: !!(m && m.online), host: this.isHost(x.token) };
  }
  view(token) {
    const g = this.game;
    return {
      t: 'state', code: this.code, phase: this.phase, settings: this.settings,
      moves: g ? g.moves : [], turn: g ? g.turn : 1, winner: g ? g.winner : 0,
      winLine: g ? g.winLine : null, draw: g ? g.draw : false,
      seats: [null, this.seatInfo(1), this.seatInfo(2)],
      spectators: [...this.members].filter(([t, m]) => m.online && !this.seatOf(t)).map(([, m]) => m.name),
      scores: this.scores, undo: this.undo,
      you: { seat: this.seatOf(token), host: this.isHost(token) },
    };
  }
  changed() {
    for (const [token, m] of this.members) {
      if (!m.online || !m.connId) continue;
      if (m.connId === 'local') this.onView(this.view(token));
      else this.sendTo(m.connId, this.view(token));
    }
    this.save(this.snapshot());
  }
}
