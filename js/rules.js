// Pure game rules for Five Stones (no DOM, no networking).
export const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
export const DEFAULTS = { size: 15, len: 5, overline: 'allow' };
export const SIZES = [9, 13, 15, 17, 19];
export const LENS = [4, 5, 6];

export function sanitize(s = {}) {
  const size = SIZES.includes(+s.size) ? +s.size : DEFAULTS.size;
  const len = LENS.includes(+s.len) ? +s.len : DEFAULTS.len;
  const overline = s.overline === 'exact' ? 'exact' : 'allow';
  return { size, len, overline };
}

export function boardFrom(moves, size) {
  const b = new Uint8Array(size * size);
  for (const m of moves) b[m.y * size + m.x] = m.c;
  return b;
}

export function newGame(settings) {
  const st = sanitize(settings);
  return { settings: st, moves: [], board: new Uint8Array(st.size * st.size), turn: 1, winner: 0, winLine: null, draw: false };
}

export function restoreGame(settings, moves) {
  const g = newGame(settings);
  g.moves = moves.map(m => ({ x: m.x, y: m.y, c: m.c }));
  g.board = boardFrom(g.moves, g.settings.size);
  const last = g.moves[g.moves.length - 1];
  g.turn = last ? 3 - last.c : 1;
  if (last) {
    const line = lineAt(g.board, g.settings, last.x, last.y, last.c);
    if (line) { g.winner = last.c; g.winLine = line; }
  }
  return g;
}

const inb = (n, x, y) => x >= 0 && y >= 0 && x < n && y < n;

// Returns array of [x,y] forming a winning line through (x,y), or null.
export function lineAt(board, { size, len, overline }, x, y, c) {
  for (const [dx, dy] of DIRS) {
    const cells = [[x, y]];
    for (let s = 1; ; s++) {
      const px = x + dx * s, py = y + dy * s;
      if (!inb(size, px, py) || board[py * size + px] !== c) break;
      cells.push([px, py]);
    }
    for (let s = 1; ; s++) {
      const px = x - dx * s, py = y - dy * s;
      if (!inb(size, px, py) || board[py * size + px] !== c) break;
      cells.unshift([px, py]);
    }
    const n = cells.length;
    if (n >= len && (overline === 'allow' || n === len)) return cells;
  }
  return null;
}

export function play(g, x, y) {
  if (g.winner || g.draw) return { ok: false, error: 'Game is over' };
  const n = g.settings.size;
  if (!Number.isInteger(x) || !Number.isInteger(y) || !inb(n, x, y)) return { ok: false, error: 'Off the board' };
  if (g.board[y * n + x]) return { ok: false, error: 'Occupied' };
  const c = g.turn;
  g.board[y * n + x] = c;
  g.moves.push({ x, y, c });
  const line = lineAt(g.board, g.settings, x, y, c);
  if (line) { g.winner = c; g.winLine = line; }
  else if (g.moves.length === n * n) g.draw = true;
  else g.turn = 3 - c;
  return { ok: true };
}

// Take back moves until colour c's most recent move is removed.
export function undoFor(g, c) {
  if (g.winner || g.draw) return false;
  if (!g.moves.some(m => m.c === c)) return false;
  const n = g.settings.size;
  while (g.moves.length) {
    const m = g.moves.pop();
    g.board[m.y * n + m.x] = 0;
    if (m.c === c) break;
  }
  g.turn = c;
  return true;
}
