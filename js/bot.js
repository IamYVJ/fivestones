// Heuristic computer player. level: 'easy' | 'normal' | 'hard'
import { DIRS } from './rules.js';

function patternScore(n, open, len) {
  const rem = len - n;
  if (rem <= 0) return 1000000;
  if (open === 0) return 0;
  if (rem === 1) return open === 2 ? 20000 : 3000;
  if (rem === 2) return open === 2 ? 2500 : 200;
  if (rem === 3) return open === 2 ? 250 : 20;
  return n * 2;
}

function scoreCell(board, size, len, x, y, c) {
  let total = 0;
  for (const [dx, dy] of DIRS) {
    let n = 1, open = 0;
    for (const sgn of [1, -1]) {
      let px = x + dx * sgn, py = y + dy * sgn;
      while (px >= 0 && py >= 0 && px < size && py < size && board[py * size + px] === c) {
        n++; px += dx * sgn; py += dy * sgn;
      }
      if (px >= 0 && py >= 0 && px < size && py < size && board[py * size + px] === 0) open++;
    }
    total += patternScore(n, open, len);
  }
  return total;
}

export function chooseMove(g, level = 'normal') {
  const { size, len } = g.settings;
  const b = g.board, me = g.turn, foe = 3 - me;
  if (!g.moves.length) { const m = size >> 1; return { x: m, y: m }; }
  const near = new Uint8Array(size * size);
  const reach = level === 'easy' ? 1 : 2;
  for (const m of g.moves) {
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
      const px = m.x + dx, py = m.y + dy;
      if (px >= 0 && py >= 0 && px < size && py < size) near[py * size + px] = 1;
    }
  }
  const defW = level === 'easy' ? 0.5 : level === 'normal' ? 0.95 : 1.05;
  const noise = level === 'easy' ? 0.6 : level === 'normal' ? 0.08 : 0.02;
  const mid = (size - 1) / 2;
  let best = null, bestS = -Infinity;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    if (b[i] || !near[i]) continue;
    let s = scoreCell(b, size, len, x, y, me) + defW * scoreCell(b, size, len, x, y, foe);
    s += 3 - (Math.abs(x - mid) + Math.abs(y - mid)) * 0.1; // mild centre preference
    s *= 1 + (Math.random() - 0.5) * noise;
    if (s > bestS) { bestS = s; best = { x, y }; }
  }
  return best;
}
