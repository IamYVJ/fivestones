// Canvas renderer for the board. Pure view: reports clicks via onPick(x, y).
export class BoardView {
  constructor(canvas, onPick) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.onPick = onPick; this.size = 15; this.moves = []; this.winLine = null;
    this.hover = null; this.canPlay = false; this.turn = 1; this.pulse = 0;
    canvas.tabIndex = 0;
    canvas.addEventListener('pointermove', e => { this.hover = this.cellAt(e); this.draw(); });
    canvas.addEventListener('pointerleave', () => { this.hover = null; this.draw(); });
    canvas.addEventListener('click', e => { const c = this.cellAt(e); if (c) this.onPick(c.x, c.y); });
    canvas.addEventListener('keydown', e => this.key(e));
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.kb = { x: 7, y: 7 };
  }
  set({ size, moves, winLine, canPlay, turn }) {
    this.size = size; this.moves = moves; this.winLine = winLine; this.canPlay = canPlay; this.turn = turn;
    this.occ = new Map(moves.map(m => [m.y * size + m.x, m.c]));
    this.resize();
  }
  resize() {
    const box = this.cv.parentElement;
    const w = Math.min(box.clientWidth || 360, Math.max(260, innerHeight - 260), 720);
    const dpr = window.devicePixelRatio || 1;
    this.css = w;
    this.cv.style.width = w + 'px'; this.cv.style.height = w + 'px';
    this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(w * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }
  geom() {
    const cell = this.css / (this.size - 1 + 2);
    return { cell, m: cell };
  }
  cellAt(e) {
    const r = this.cv.getBoundingClientRect();
    const { cell, m } = this.geom();
    const x = Math.round((e.clientX - r.left - m) / cell), y = Math.round((e.clientY - r.top - m) / cell);
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return null;
    return { x, y };
  }
  key(e) {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (d) {
      this.kb.x = Math.min(this.size - 1, Math.max(0, this.kb.x + d[0]));
      this.kb.y = Math.min(this.size - 1, Math.max(0, this.kb.y + d[1]));
      this.hover = { ...this.kb }; this.draw(); e.preventDefault();
    } else if (e.key === 'Enter' || e.key === ' ') { this.onPick(this.kb.x, this.kb.y); e.preventDefault(); }
  }
  stone(x, y, c, alpha = 1) {
    const { cell, m } = this.geom(), ctx = this.ctx, r = cell * 0.44;
    const cx = m + x * cell, cy = m + y * cell;
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.shadowColor = 'rgba(30,20,5,.35)'; ctx.shadowBlur = r * 0.45; ctx.shadowOffsetY = r * 0.18;
    const g = ctx.createRadialGradient(cx - r * .3, cy - r * .35, r * .05, cx, cy, r);
    if (c === 1) { g.addColorStop(0, '#3a3d46'); g.addColorStop(1, '#0c0d10'); }
    else { g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#e3e5eb'); }
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 1; ctx.strokeStyle = c === 1 ? 'rgba(0,0,0,.6)' : 'rgba(90,80,60,.35)'; ctx.stroke();
    ctx.restore();
  }
  draw() {
    const ctx = this.ctx, W = this.css, n = this.size;
    if (!W) return;
    const { cell, m } = this.geom();
    ctx.fillStyle = '#e4cfa3'; ctx.fillRect(0, 0, W, W);
    const at = v => m + v * cell, end = at(n - 1);

    // coordinates (letters across, numbers down)
    ctx.fillStyle = 'rgba(95,75,40,.65)';
    ctx.font = `600 ${Math.max(8, cell * 0.3)}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < n; i++) {
      ctx.fillText(String.fromCharCode(65 + i), at(i), m * 0.42);
      ctx.fillText(String(i + 1), m * 0.42, at(i));
    }

    // grid
    ctx.strokeStyle = 'rgba(95,75,40,.55)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const p = Math.round(at(i)) + 0.5;
      ctx.moveTo(p, at(0)); ctx.lineTo(p, end);
      ctx.moveTo(at(0), p); ctx.lineTo(end, p);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(95,75,40,.9)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(at(0), at(0), end - at(0), end - at(0));
    ctx.fillStyle = 'rgba(95,75,40,.8)';
    const pts = n >= 13 ? [3, (n - 1) / 2, n - 4] : [(n - 1) / 2];
    for (const a of pts) for (const b of pts) { ctx.beginPath(); ctx.arc(at(a), at(b), cell * 0.085, 0, 7); ctx.fill(); }

    // hover: faint cell highlight + ghost stone
    if (this.hover && this.canPlay && !this.occ.has(this.hover.y * n + this.hover.x)) {
      this.stone(this.hover.x, this.hover.y, this.turn, 0.4);
    }

    const won = !!this.winLine;
    const inWin = new Set(won ? this.winLine.map(([x, y]) => y * n + x) : []);
    for (const mv of this.moves) this.stone(mv.x, mv.y, mv.c, won && !inWin.has(mv.y * n + mv.x) ? 0.45 : 1);

    const last = this.moves[this.moves.length - 1];
    if (last && !won) {
      ctx.fillStyle = '#e8503a';
      ctx.beginPath(); ctx.arc(at(last.x), at(last.y), cell * 0.1, 0, 7); ctx.fill();
    }
    if (won) {
      ctx.strokeStyle = '#e8503a'; ctx.lineWidth = Math.max(2, cell * 0.08);
      for (const [x, y] of this.winLine) { ctx.beginPath(); ctx.arc(at(x), at(y), cell * 0.5, 0, 7); ctx.stroke(); }
    }
    if (document.activeElement === this.cv && this.hover) {
      ctx.strokeStyle = '#2f6fed'; ctx.lineWidth = 2;
      ctx.strokeRect(at(this.hover.x) - cell / 2, at(this.hover.y) - cell / 2, cell, cell);
    }
  }
}
