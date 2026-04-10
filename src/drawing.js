// ── DrawingEngine ─────────────────────────────────────────────────────────
//
// Architecture:
//   bufferCanvas  – all committed strokes (persistent)
//   overlayCanvas – current in-progress stroke (cleared each frame)
//   main canvas   – composite of buffer + overlay + particles + UI chrome
//
// Key improvements:
//   • Point-buffer smoothing with configurable window size
//   • Incremental overlay rendering — no full redraws per frame
//   • Smart eraser with line-fill capsules to prevent gaps on fast movement
//   • Remote cursor labels for multiplayer
//   • Particle system only spawns every N points (perf)

export class DrawingEngine {
  constructor(canvasElement, width, height) {
    this.canvas = canvasElement;
    this.ctx    = canvasElement.getContext('2d', { alpha: true });

    // ── Offscreen: committed strokes ─────────────────────────────────────
    this.bufferCanvas = document.createElement('canvas');
    this.bufferCtx    = this.bufferCanvas.getContext('2d', { alpha: true });

    // ── Offscreen: active in-progress stroke ────────────────────────────
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCtx    = this.overlayCanvas.getContext('2d', { alpha: true });

    // ── State ────────────────────────────────────────────────────────────
    this.currentColor      = '#00FFAA';
    this.currentSize       = 8;
    this.currentGlow       = 18;
    this.currentEraserSize = 40;

    this.lines        = [];       // all committed line descriptors
    this.currentLine  = null;     // live line being drawn
    this.historyStack = [];       // for undo

    // ── Point smoothing buffer ────────────────────────────────────────────
    // Keeps last N raw positions; outputs rolling average
    this._smoothBuf    = [];
    this._smoothWindow = 4;       // low = responsive, high = smoother

    // ── Trail effect ─────────────────────────────────────────────────────
    this.trailPoints = [];
    this.trailMaxAge = 300;       // ms

    // ── Particles ────────────────────────────────────────────────────────
    this.particles       = [];
    this._particleTick   = 0;     // only spawn every N draw calls

    // ── Erase state ──────────────────────────────────────────────────────
    this._lastEraseX = null;
    this._lastEraseY = null;

    // ── Multiplayer: remote cursors ───────────────────────────────────────
    this._remoteCursors = {};     // id → {x, y, color, label}

    this.resize(width, height);
  }

  // ── Resize ───────────────────────────────────────────────────────────────
  resize(w, h) {
    const tmp       = document.createElement('canvas');
    tmp.width        = this.bufferCanvas.width  || w;
    tmp.height       = this.bufferCanvas.height || h;
    tmp.getContext('2d').drawImage(this.bufferCanvas, 0, 0);

    this.canvas.width         = w;
    this.canvas.height        = h;
    this.bufferCanvas.width   = w;
    this.bufferCanvas.height  = h;
    this.overlayCanvas.width  = w;
    this.overlayCanvas.height = h;

    this.bufferCtx.drawImage(tmp, 0, 0, w, h);
  }

  // ── Setters ───────────────────────────────────────────────────────────────
  setColor(c)       { this.currentColor      = c; }
  setSize(s)        { this.currentSize       = s; }
  setGlow(g)        { this.currentGlow       = g; }
  setEraserSize(r)  { this.currentEraserSize = r; }

  // ── Point smoothing ───────────────────────────────────────────────────────
  /**
   * Push raw position into smooth buffer and return moving-average position.
   * This is separate from the SMOOTH factor in main.js — provides additional
   * micro-jitter removal.
   */
  smooth(rawX, rawY) {
    this._smoothBuf.push({ x: rawX, y: rawY });
    if (this._smoothBuf.length > this._smoothWindow) {
      this._smoothBuf.shift();
    }
    const avg = this._smoothBuf.reduce(
      (a, p) => ({ x: a.x + p.x, y: a.y + p.y }),
      { x: 0, y: 0 }
    );
    return {
      x: avg.x / this._smoothBuf.length,
      y: avg.y / this._smoothBuf.length
    };
  }

  clearSmoothBuffer() {
    this._smoothBuf = [];
  }

  // ── Drawing strokes ───────────────────────────────────────────────────────
  startLine(x, y) {
    this._saveSnapshot();
    this.clearSmoothBuffer();
    this.currentLine = {
      color:  this.currentColor,
      size:   this.currentSize,
      glow:   this.currentGlow,
      points: [{ x, y }]
    };
    this.lines.push(this.currentLine);
    this._spawnParticles(x, y, this.currentColor, 8);
  }

  addPoint(x, y) {
    if (!this.currentLine) return;
    const pts  = this.currentLine.points;
    const last = pts[pts.length - 1];

    // Minimum distance threshold — avoids duplicate points stacking
    if (Math.hypot(x - last.x, y - last.y) < 1.5) return;

    pts.push({ x, y });

    // Incrementally draw segments onto overlay — avoids O(n) full redraws
    this._drawLastSegment(this.overlayCtx, this.currentLine);

    // Spawn particles periodically while drawing (not every point)
    this._particleTick++;
    if (this._particleTick % 8 === 0) {
      this._spawnParticles(x, y, this.currentColor, 3);
    }
  }

  endLine() {
    if (!this.currentLine) return;
    // Commit the completed stroke to the persistent buffer
    this._drawStroke(this.bufferCtx, this.currentLine);
    // Clear overlay — buffer now owns this stroke
    this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
    this.currentLine = null;
    this.clearSmoothBuffer();
  }

  // ── Eraser (brush, NOT full clear) ───────────────────────────────────────
  eraseAt(x, y, radius) {
    radius = radius ?? this.currentEraserSize;

    // Commit any active stroke before erasing
    if (this.currentLine) {
      this._drawStroke(this.bufferCtx, this.currentLine);
      this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
      this.currentLine = null;
    }

    this.bufferCtx.save();
    this.bufferCtx.globalCompositeOperation = 'destination-out';

    // Fill a capsule between last and current erase position
    // to prevent gaps when the hand moves quickly
    if (this._lastEraseX !== null) {
      const dx   = x - this._lastEraseX;
      const dy   = y - this._lastEraseY;
      const dist = Math.hypot(dx, dy);
      if (dist > 0) {
        this.bufferCtx.lineWidth   = radius * 2;
        this.bufferCtx.lineCap     = 'round';
        this.bufferCtx.strokeStyle = 'rgba(0,0,0,1)';
        this.bufferCtx.beginPath();
        this.bufferCtx.moveTo(this._lastEraseX, this._lastEraseY);
        this.bufferCtx.lineTo(x, y);
        this.bufferCtx.stroke();
      }
    }

    // Always punch a circle at current position
    this.bufferCtx.beginPath();
    this.bufferCtx.arc(x, y, radius, 0, Math.PI * 2);
    this.bufferCtx.fillStyle = 'rgba(0,0,0,1)';
    this.bufferCtx.fill();

    this.bufferCtx.restore();

    this._lastEraseX = x;
    this._lastEraseY = y;
  }

  /** Reset eraser continuity — call when ERASE gesture ends */
  endErase() {
    this._lastEraseX = null;
    this._lastEraseY = null;
  }

  // ── Clear ─────────────────────────────────────────────────────────────────
  clear(animate = false) {
    this._saveSnapshot();
    this.lines       = [];
    this.currentLine = null;
    this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
    this.bufferCtx.clearRect(0, 0, this.bufferCanvas.width, this.bufferCanvas.height);
    this.endErase();
    this.clearSmoothBuffer();
    if (animate) this._flashClear();
  }

  // ── Undo ─────────────────────────────────────────────────────────────────
  undo() {
    if (!this.historyStack.length) return;
    const { lines, imageData } = this.historyStack.pop();
    this.lines       = JSON.parse(lines);
    this.currentLine = null;
    this.bufferCtx.clearRect(0, 0, this.bufferCanvas.width, this.bufferCanvas.height);
    this.bufferCtx.putImageData(imageData, 0, 0);
    this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
  }

  // ── Download ─────────────────────────────────────────────────────────────
  download() {
    const exp   = document.createElement('canvas');
    exp.width   = this.canvas.width;
    exp.height  = this.canvas.height;
    const c     = exp.getContext('2d');
    c.fillStyle = '#0d0d1a';
    c.fillRect(0, 0, exp.width, exp.height);
    c.drawImage(this.bufferCanvas, 0, 0);
    const a    = document.createElement('a');
    a.download = 'air-draw.png';
    a.href     = exp.toDataURL('image/png');
    a.click();
  }

  // ── Multiplayer ───────────────────────────────────────────────────────────
  receiveRemoteStroke({ points, color, size, glow }) {
    if (!points || points.length < 2) return;
    this._drawStroke(this.bufferCtx, { points, color, size, glow });
  }

  receiveRemoteDraw({ id, x, y, isDrawing, color, size = 6, glow = 14 }) {
    const cursor = this._remoteCursors[id];

    if (isDrawing && cursor?.drawing) {
      this._drawStroke(this.bufferCtx, {
        points: [cursor.drawing, { x, y }],
        color, size, glow
      });
    }

    this._remoteCursors[id] = {
      x, y, color,
      drawing: isDrawing ? { x, y } : null
    };
  }

  removeRemoteCursor(id) {
    delete this._remoteCursors[id];
  }

  receiveRemoteClear() { this.clear(false); }

  // ── Trail ─────────────────────────────────────────────────────────────────
  addTrailPoint(x, y) {
    this.trailPoints.push({ x, y, t: performance.now(), color: this.currentColor });
    const cutoff = performance.now() - this.trailMaxAge;
    while (this.trailPoints.length && this.trailPoints[0].t < cutoff) {
      this.trailPoints.shift();
    }
  }

  // ── Main render (every rAF frame) ─────────────────────────────────────────
  render(cursorX, cursorY, gesture, hasHand, palmHoldProgress = 0) {
    const ctx = this.ctx;
    const w   = this.canvas.width;
    const h   = this.canvas.height;

    // 1. Clear display canvas
    ctx.clearRect(0, 0, w, h);

    // 2. Committed strokes (stable buffer)
    ctx.drawImage(this.bufferCanvas, 0, 0);

    // 3. Active in-progress stroke from overlay
    if (this.currentLine && this.currentLine.points.length > 1) {
      ctx.drawImage(this.overlayCanvas, 0, 0);
    }

    // 4. Remote cursors
    this._renderRemoteCursors(ctx);

    // 5. Trail effect
    this._renderTrail(ctx);

    // 6. Particles
    this._updateParticles();
    this._renderParticles(ctx);

    // 7. Clear flash
    if (this._clearFlash) {
      ctx.save();
      ctx.globalAlpha = this._clearFlash.alpha;
      ctx.fillStyle   = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
      this._clearFlash.alpha -= 0.06;
      if (this._clearFlash.alpha <= 0) this._clearFlash = null;
    }

    // 8. Palm-hold ring (progressive arc)
    if (palmHoldProgress > 0 && cursorX !== null) {
      this._renderHoldRing(ctx, cursorX, cursorY, palmHoldProgress);
    }

    // 9. Cursor dot
    if (cursorX !== null && cursorY !== null) {
      this._renderCursor(ctx, cursorX, cursorY, gesture, hasHand);
    }
  }

  // noop – backward compat
  clearOverlay() {}

  // ── Private: stroke rendering ─────────────────────────────────────────────
  _drawStroke(ctx, line) {
    const pts = line.points;
    if (pts.length < 2) return;

    ctx.save();
    ctx.strokeStyle = line.color;
    ctx.lineWidth   = line.size;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.shadowBlur  = line.glow;
    ctx.shadowColor = line.color;
    ctx.globalCompositeOperation = 'source-over';

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.stroke();
    ctx.restore();
  }

  _drawLastSegment(ctx, line) {
    const pts = line.points;
    const n   = pts.length;
    if (n < 2) return;

    ctx.save();
    ctx.strokeStyle = line.color;
    ctx.lineWidth   = line.size;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.shadowBlur  = line.glow;
    ctx.shadowColor = line.color;
    ctx.globalCompositeOperation = 'source-over';

    ctx.beginPath();
    if (n === 2) {
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[1].x, pts[1].y);
    } else {
      const i   = n - 2;
      const mx0 = (pts[i - 1].x + pts[i].x) / 2;
      const my0 = (pts[i - 1].y + pts[i].y) / 2;
      const mx1 = (pts[i].x + pts[n - 1].x) / 2;
      const my1 = (pts[i].y + pts[n - 1].y) / 2;
      ctx.moveTo(mx0, my0);
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx1, my1);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ── Private: visual effects ───────────────────────────────────────────────
  _renderTrail(ctx) {
    if (this.trailPoints.length < 2) return;
    const now = performance.now();
    ctx.save();
    ctx.lineCap  = 'round';
    ctx.lineJoin = 'round';
    for (let i = 1; i < this.trailPoints.length; i++) {
      const prev = this.trailPoints[i - 1];
      const curr = this.trailPoints[i];
      const frac = 1 - (now - curr.t) / this.trailMaxAge;
      if (frac <= 0) continue;
      ctx.globalAlpha = frac * 0.45;
      ctx.lineWidth   = frac * 6;
      ctx.strokeStyle = curr.color;
      ctx.shadowBlur  = 14 * frac;
      ctx.shadowColor = curr.color;
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(curr.x, curr.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur  = 0;
    ctx.restore();
  }

  _spawnParticles(x, y, color, count = 6) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.8 + Math.random() * 2.5;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        alpha: 1,
        color,
        radius: 1.5 + Math.random() * 2.5
      });
    }
  }

  _updateParticles() {
    for (const p of this.particles) {
      p.x += p.vx; p.y += p.vy;
      p.vx *= 0.91; p.vy *= 0.91;
      p.alpha -= 0.028;
    }
    this.particles = this.particles.filter(p => p.alpha > 0);
  }

  _renderParticles(ctx) {
    ctx.save();
    for (const p of this.particles) {
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle   = p.color;
      ctx.shadowBlur  = 8;
      ctx.shadowColor = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur  = 0;
    ctx.restore();
  }

  _renderRemoteCursors(ctx) {
    ctx.save();
    for (const [id, c] of Object.entries(this._remoteCursors)) {
      const color = c.color || '#FF3366';

      // Cursor dot
      ctx.globalAlpha  = 0.85;
      ctx.fillStyle    = color;
      ctx.shadowBlur   = 12;
      ctx.shadowColor  = color;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 7, 0, Math.PI * 2);
      ctx.fill();

      // Short ID label
      ctx.globalAlpha  = 0.75;
      ctx.shadowBlur   = 0;
      ctx.font         = 'bold 10px Outfit, sans-serif';
      ctx.fillStyle    = '#fff';
      ctx.fillText(`👤 ${id.slice(-4)}`, c.x + 10, c.y - 8);
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur  = 0;
    ctx.restore();
  }

  _renderHoldRing(ctx, x, y, progress) {
    ctx.save();
    ctx.lineWidth   = 5;
    ctx.strokeStyle = '#FF3366';
    ctx.shadowBlur  = 22;
    ctx.shadowColor = '#FF3366';
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(x, y, 58, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.stroke();

    // Inner fill (progress indicator)
    ctx.globalAlpha = progress * 0.12;
    ctx.fillStyle   = '#FF3366';
    ctx.beginPath();
    ctx.arc(x, y, 58, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  _renderCursor(ctx, x, y, gesture, hasHand) {
    ctx.save();

    if (gesture === 'DRAW') {
      // Filled dot with glow
      ctx.fillStyle   = this.currentColor;
      ctx.shadowBlur  = this.currentGlow + 16;
      ctx.shadowColor = this.currentColor;
      ctx.beginPath();
      ctx.arc(x, y, this.currentSize / 2 + 3, 0, Math.PI * 2);
      ctx.fill();
      // Outer pulse ring
      ctx.strokeStyle = this.currentColor;
      ctx.lineWidth   = 1.5;
      ctx.globalAlpha = 0.35;
      ctx.shadowBlur  = 6;
      ctx.beginPath();
      ctx.arc(x, y, this.currentSize + 12, 0, Math.PI * 2);
      ctx.stroke();

    } else if (gesture === 'ERASE') {
      const r = this.currentEraserSize;
      // Eraser dashed outline
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = '#FF3366';
      ctx.lineWidth   = 2.5;
      ctx.shadowBlur  = 18;
      ctx.shadowColor = '#FF3366';
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      // Crosshair
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.45;
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(x - r, y); ctx.lineTo(x + r, y);
      ctx.moveTo(x, y - r); ctx.lineTo(x, y + r);
      ctx.stroke();

    } else if (gesture === 'PEACE') {
      ctx.fillStyle   = '#FFCC00';
      ctx.shadowBlur  = 18;
      ctx.shadowColor = '#FFCC00';
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fill();

    } else {
      ctx.fillStyle   = hasHand ? 'rgba(170,170,255,0.7)' : 'rgba(80,80,120,0.6)';
      ctx.shadowBlur  = hasHand ? 10 : 0;
      ctx.shadowColor = '#aaaaff';
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  _flashClear() {
    this._clearFlash = { alpha: 0.65 };
  }

  _saveSnapshot() {
    try {
      const imageData = this.bufferCtx.getImageData(
        0, 0, this.bufferCanvas.width, this.bufferCanvas.height
      );
      this.historyStack.push({ lines: JSON.stringify(this.lines), imageData });
      if (this.historyStack.length > 20) this.historyStack.shift();
    } catch (e) {
      // Silently skip on cross-origin taint errors
    }
  }
}
