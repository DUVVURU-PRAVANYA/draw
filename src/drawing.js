// ── AERIX SPATIAL DRAWING ENGINE ──────────────────────────────────────────
//
// Architecture:
//   bufferCanvas  – all committed strokes (persistent)
//   overlayCanvas – active in-progress stroke (cleared & incrementally drawn per frame)
//   main canvas   – composite of buffer + overlay + particles + remote cursors + UI HUD
//
// Enhanced Capabilities:
//   • Speed-responsive particle emitter
//   • Dual-pass Bézier curve interpolation
//   • Capsule-fill destination-out eraser
//   • ShapeSense geometric detection & replacement
//   • Neural canvas enhancement suite (AI Smooth, Smart Cleanup, Neon Harmonizer)

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

    // ── Engine State ─────────────────────────────────────────────────────
    this.currentColor      = '#00FFAA';
    this.currentSize       = 8;
    this.currentGlow       = 22;
    this.currentEraserSize = 40;

    this.lines        = [];       // all committed line descriptors
    this.currentLine  = null;     // live line being drawn
    this.historyStack = [];       // for undo

    // ── Point smoothing buffer ────────────────────────────────────────────
    this._smoothBuf    = [];
    this._smoothWindow = 4;

    // ── Velocity tracking for dynamic particles ──────────────────────────
    this._lastPointTime = 0;
    this._lastRawX      = null;
    this._lastRawY      = null;
    this._currentSpeed  = 0;

    // ── Trail effect ─────────────────────────────────────────────────────
    this.trailPoints = [];
    this.trailMaxAge = 350;       // ms

    // ── Particles ────────────────────────────────────────────────────────
    this.particles          = [];
    this._particleTick      = 0;
    this.particleIntensity  = 'medium'; // high, medium, low, off

    // ── Erase state ──────────────────────────────────────────────────────
    this._lastEraseX = null;
    this._lastEraseY = null;

    // ── Multiplayer: remote cursors ───────────────────────────────────────
    this._remoteCursors = {};     // id → {x, y, color, label, drawing}

    // ── ShapeSense callback ───────────────────────────────────────────────
    this.onShapeDetected = null;

    this.resize(width, height);
  }

  // ── Canvas Sizing ────────────────────────────────────────────────────────
  resize(w, h) {
    const tmp = document.createElement('canvas');
    tmp.width  = this.bufferCanvas.width  || w;
    tmp.height = this.bufferCanvas.height || h;
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
  setColor(c)               { this.currentColor      = c; }
  setSize(s)                { this.currentSize       = s; }
  setGlow(g)                { this.currentGlow       = g; }
  setEraserSize(r)          { this.currentEraserSize = r; }
  setParticleIntensity(lvl) { this.particleIntensity = lvl; }

  // ── Point smoothing ───────────────────────────────────────────────────────
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

    this._lastRawX = x;
    this._lastRawY = y;
    this._lastPointTime = performance.now();

    if (this.particleIntensity !== 'off') {
      this._spawnParticles(x, y, this.currentColor, 8);
    }
  }

  addPoint(x, y) {
    if (!this.currentLine) return;
    const pts  = this.currentLine.points;
    const last = pts[pts.length - 1];

    const dist = Math.hypot(x - last.x, y - last.y);
    if (dist < 1.5) return;

    // Calculate instantaneous drawing velocity
    const now = performance.now();
    const dt  = Math.max(1, now - this._lastPointTime);
    this._currentSpeed = dist / dt; // px per ms
    this._lastPointTime = now;
    this._lastRawX = x;
    this._lastRawY = y;

    pts.push({ x, y });

    // Incrementally draw latest segment
    this._drawLastSegment(this.overlayCtx, this.currentLine);

    // Speed-responsive particles
    if (this.particleIntensity !== 'off') {
      this._particleTick++;
      const interval = (this.particleIntensity === 'high') ? 4 : (this.particleIntensity === 'low') ? 12 : 7;
      if (this._particleTick % interval === 0) {
        const particleCount = Math.min(8, Math.max(2, Math.round(this._currentSpeed * 3)));
        this._spawnParticles(x, y, this.currentColor, particleCount);
      }
    }
  }

  endLine() {
    if (!this.currentLine) return;
    const line = this.currentLine;
    
    // Commit stroke to persistent buffer
    this._drawStroke(this.bufferCtx, line);
    this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
    this.currentLine = null;
    this.clearSmoothBuffer();

    // ShapeSense Recognition Analysis
    if (line.points.length >= 8 && this.onShapeDetected) {
      const detectedShape = this._analyzeShape(line.points);
      if (detectedShape) {
        this.onShapeDetected(detectedShape, line);
      }
    }
  }

  // ── Smart Eraser (Capsule Fill) ───────────────────────────────────────────
  eraseAt(x, y, radius) {
    radius = radius ?? this.currentEraserSize;

    if (this.currentLine) {
      this._drawStroke(this.bufferCtx, this.currentLine);
      this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
      this.currentLine = null;
    }

    this.bufferCtx.save();
    this.bufferCtx.globalCompositeOperation = 'destination-out';

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

    this.bufferCtx.beginPath();
    this.bufferCtx.arc(x, y, radius, 0, Math.PI * 2);
    this.bufferCtx.fillStyle = 'rgba(0,0,0,1)';
    this.bufferCtx.fill();

    this.bufferCtx.restore();

    this._lastEraseX = x;
    this._lastEraseY = y;
  }

  endErase() {
    this._lastEraseX = null;
    this._lastEraseY = null;
  }

  // ── Clear / Dissolve ──────────────────────────────────────────────────────
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

  // ── Export / Capture PNG ─────────────────────────────────────────────────
  download() {
    const exp   = document.createElement('canvas');
    exp.width   = this.canvas.width;
    exp.height  = this.canvas.height;
    const c     = exp.getContext('2d');
    
    // Premium obsidian space background with subtle gradient
    const grad = c.createRadialGradient(exp.width/2, exp.height/2, 50, exp.width/2, exp.height/2, exp.width);
    grad.addColorStop(0, '#0E111C');
    grad.addColorStop(1, '#07080B');
    c.fillStyle = grad;
    c.fillRect(0, 0, exp.width, exp.height);

    c.drawImage(this.bufferCanvas, 0, 0);

    // Watermark
    c.save();
    c.font = 'bold 12px Space Grotesk, sans-serif';
    c.fillStyle = 'rgba(255, 255, 255, 0.35)';
    c.fillText('AERIX  •  CREATE BEYOND TOUCH', 24, exp.height - 24);
    c.restore();

    const a    = document.createElement('a');
    a.download = `AERIX-${Date.now()}.png`;
    a.href     = exp.toDataURL('image/png');
    a.click();
  }

  // ── ShapeSense Geometric Detection ────────────────────────────────────────
  _analyzeShape(pts) {
    if (pts.length < 8) return null;
    const n = pts.length;
    const start = pts[0];
    const end = pts[n - 1];

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let totalLength = 0;
    for (let i = 0; i < n; i++) {
      minX = Math.min(minX, pts[i].x);
      maxX = Math.max(maxX, pts[i].x);
      minY = Math.min(minY, pts[i].y);
      maxY = Math.max(maxY, pts[i].y);
      if (i > 0) {
        totalLength += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      }
    }

    const bboxW = Math.max(1, maxX - minX);
    const bboxH = Math.max(1, maxY - minY);
    const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    const radius = (bboxW + bboxH) / 4;
    const endpointDist = Math.hypot(start.x - end.x, start.y - end.y);
    const isClosed = endpointDist < (radius * 0.7);

    // 1. Line Check: direct start-to-end vs total length
    const directDist = Math.hypot(start.x - end.x, start.y - end.y);
    if (!isClosed && directDist > 40 && (directDist / totalLength) > 0.88) {
      return {
        type: 'LINE',
        name: 'LINE',
        params: { start, end }
      };
    }

    // 2. Circle Check: variance of distance from center
    if (isClosed && bboxW > 30 && bboxH > 30) {
      const aspectRatio = bboxW / bboxH;
      if (aspectRatio > 0.75 && aspectRatio < 1.35) {
        let radialVariance = 0;
        for (const p of pts) {
          const d = Math.hypot(p.x - center.x, p.y - center.y);
          radialVariance += Math.abs(d - radius);
        }
        const avgRadialError = radialVariance / n;
        if (avgRadialError < radius * 0.28) {
          return {
            type: 'CIRCLE',
            name: 'CIRCLE',
            params: { center, radius }
          };
        }
      }

      // 3. Rectangle / Square Check
      return {
        type: 'RECTANGLE',
        name: (Math.abs(bboxW - bboxH) < 25) ? 'SQUARE' : 'RECTANGLE',
        params: { x: minX, y: minY, w: bboxW, h: bboxH }
      };
    }

    return null;
  }

  perfectLastShape(shapeObj, originalLine) {
    if (!shapeObj || !originalLine) return;
    this._saveSnapshot();

    // Replace original line points with parameterized perfect geometry
    const pts = [];
    const color = originalLine.color;
    const size = originalLine.size;
    const glow = originalLine.glow;

    if (shapeObj.type === 'CIRCLE') {
      const { center, radius } = shapeObj.params;
      const steps = 60;
      for (let i = 0; i <= steps; i++) {
        const theta = (i / steps) * Math.PI * 2;
        pts.push({
          x: center.x + Math.cos(theta) * radius,
          y: center.y + Math.sin(theta) * radius
        });
      }
    } else if (shapeObj.type === 'RECTANGLE') {
      const { x, y, w, h } = shapeObj.params;
      pts.push({ x, y });
      pts.push({ x: x + w, y });
      pts.push({ x: x + w, y: y + h });
      pts.push({ x, y: y + h });
      pts.push({ x, y });
    } else if (shapeObj.type === 'LINE') {
      pts.push(shapeObj.params.start);
      pts.push(shapeObj.params.end);
    }

    // Redraw buffer with new line
    const idx = this.lines.indexOf(originalLine);
    if (idx !== -1) {
      this.lines[idx] = { color, size, glow, points: pts };
    }
    this._redrawAllCommitted();
  }

  // ── AERIX AI Studio Enhancements ──────────────────────────────────────────
  aiSmoothAll() {
    this._saveSnapshot();
    for (const line of this.lines) {
      if (line.points.length > 3) {
        const smoothed = [line.points[0]];
        for (let i = 1; i < line.points.length - 1; i++) {
          smoothed.push({
            x: (line.points[i - 1].x + line.points[i].x * 2 + line.points[i + 1].x) / 4,
            y: (line.points[i - 1].y + line.points[i].y * 2 + line.points[i + 1].y) / 4
          });
        }
        smoothed.push(line.points[line.points.length - 1]);
        line.points = smoothed;
      }
    }
    this._redrawAllCommitted();
  }

  aiCleanup() {
    this._saveSnapshot();
    this.lines = this.lines.filter(l => l.points.length > 2);
    this._redrawAllCommitted();
  }

  aiHarmonizePalette() {
    this._saveSnapshot();
    const neonPalette = ['#00FFAA', '#38BDF8', '#8B5CF6', '#06B6D4', '#FF3366', '#FFCC00'];
    this.lines.forEach((l, idx) => {
      l.color = neonPalette[idx % neonPalette.length];
    });
    this._redrawAllCommitted();
  }

  _redrawAllCommitted() {
    this.bufferCtx.clearRect(0, 0, this.bufferCanvas.width, this.bufferCanvas.height);
    for (const line of this.lines) {
      this._drawStroke(this.bufferCtx, line);
    }
  }

  // ── Multiplayer Synchronization ──────────────────────────────────────────
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

  // ── Main Composite Render Loop ────────────────────────────────────────────
  render(cursorX, cursorY, gesture, hasHand, palmHoldProgress = 0) {
    const ctx = this.ctx;
    const w   = this.canvas.width;
    const h   = this.canvas.height;

    // 1. Clear display canvas
    ctx.clearRect(0, 0, w, h);

    // 2. Committed strokes (buffer)
    ctx.drawImage(this.bufferCanvas, 0, 0);

    // 3. Active in-progress stroke from overlay
    if (this.currentLine && this.currentLine.points.length > 1) {
      ctx.drawImage(this.overlayCanvas, 0, 0);
    }

    // 4. Remote multiplayer cursors
    this._renderRemoteCursors(ctx);

    // 5. Light trails
    this._renderTrail(ctx);

    // 6. Particles
    this._updateParticles();
    this._renderParticles(ctx);

    // 7. Dissolve / Clear flash
    if (this._clearFlash) {
      ctx.save();
      ctx.globalAlpha = this._clearFlash.alpha;
      ctx.fillStyle   = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
      this._clearFlash.alpha -= 0.05;
      if (this._clearFlash.alpha <= 0) this._clearFlash = null;
    }

    // 8. Palm-hold progress ring
    if (palmHoldProgress > 0 && cursorX !== null) {
      this._renderHoldRing(ctx, cursorX, cursorY, palmHoldProgress);
    }

    // 9. Spatial Cursor
    if (cursorX !== null && cursorY !== null) {
      this._renderCursor(ctx, cursorX, cursorY, gesture, hasHand);
    }
  }

  // ── Private Render Subroutines ───────────────────────────────────────────
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
      ctx.lineWidth   = frac * 5;
      ctx.strokeStyle = curr.color;
      ctx.shadowBlur  = 12 * frac;
      ctx.shadowColor = curr.color;
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(curr.x, curr.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  _spawnParticles(x, y, color, count = 6) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.8 + Math.random() * 2.8;
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
      p.vx *= 0.92; p.vy *= 0.92;
      p.alpha -= 0.025;
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
    ctx.restore();
  }

  _renderRemoteCursors(ctx) {
    ctx.save();
    for (const [id, c] of Object.entries(this._remoteCursors)) {
      const color = c.color || '#FF3366';
      ctx.globalAlpha  = 0.85;
      ctx.fillStyle    = color;
      ctx.shadowBlur   = 14;
      ctx.shadowColor  = color;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 7, 0, Math.PI * 2);
      ctx.fill();

      ctx.font         = 'bold 10px Space Grotesk, sans-serif';
      ctx.fillStyle    = '#fff';
      ctx.fillText(`👤 ${id.slice(-4)}`, c.x + 12, c.y - 8);
    }
    ctx.restore();
  }

  _renderHoldRing(ctx, x, y, progress) {
    ctx.save();
    ctx.lineWidth   = 4;
    ctx.strokeStyle = '#FF3366';
    ctx.shadowBlur  = 20;
    ctx.shadowColor = '#FF3366';
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(x, y, 54, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.stroke();

    ctx.globalAlpha = progress * 0.15;
    ctx.fillStyle   = '#FF3366';
    ctx.beginPath();
    ctx.arc(x, y, 54, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _renderCursor(ctx, x, y, gesture, hasHand) {
    ctx.save();

    if (gesture === 'DRAW') {
      ctx.fillStyle   = this.currentColor;
      ctx.shadowBlur  = this.currentGlow + 14;
      ctx.shadowColor = this.currentColor;
      ctx.beginPath();
      ctx.arc(x, y, this.currentSize / 2 + 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = this.currentColor;
      ctx.lineWidth   = 1.5;
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.arc(x, y, this.currentSize + 10, 0, Math.PI * 2);
      ctx.stroke();

    } else if (gesture === 'ERASE') {
      const r = this.currentEraserSize;
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = '#FF3366';
      ctx.lineWidth   = 2;
      ctx.shadowBlur  = 16;
      ctx.shadowColor = '#FF3366';
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.globalAlpha = 0.4;
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
      ctx.fillStyle   = hasHand ? 'rgba(56, 189, 248, 0.7)' : 'rgba(89, 97, 117, 0.5)';
      ctx.shadowBlur  = hasHand ? 10 : 0;
      ctx.shadowColor = '#38BDF8';
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  _flashClear() {
    this._clearFlash = { alpha: 0.7 };
  }

  _saveSnapshot() {
    try {
      const imageData = this.bufferCtx.getImageData(
        0, 0, this.bufferCanvas.width, this.bufferCanvas.height
      );
      this.historyStack.push({ lines: JSON.stringify(this.lines), imageData });
      if (this.historyStack.length > 25) this.historyStack.shift();
    } catch (e) {
      // Safe fallback on cross-origin image taint
    }
  }
}
