import './style.css';
import { HandTrackingEngine } from './handTracking.js';
import { GestureEngine }      from './gesture.js';
import { DrawingEngine }      from './drawing.js';
import { UIManager }          from './ui.js';

// ═══════════════════════════════════════════════════════════════
// DOM REFS
// ═══════════════════════════════════════════════════════════════
const video  = document.getElementById('webcam');
const canvas = document.getElementById('output_canvas');

// ═══════════════════════════════════════════════════════════════
// ENGINES
// ═══════════════════════════════════════════════════════════════
let handEngine;
let gestureEngine;
let drawingEngine;
let uiManager;

// ═══════════════════════════════════════════════════════════════
// RUNTIME STATE
// ═══════════════════════════════════════════════════════════════
let isAppRunning    = false;
let isDrawingActive = false;
let isErasing       = false;

// ── Frame skipping ────────────────────────────────────────────
// rAF runs ~60fps; camera is 30fps. Only run ML on even frames.
let frameCount = 0;

// ── Position smoothing: 0.7 old + 0.3 new ────────────────────
// Light enough for near-zero lag, heavy enough to kill jitter.
const SMOOTH = 0.7;
let smoothX = null, smoothY = null;

// ── Smart erase state ─────────────────────────────────────────
const ERASE_HOLD_MS  = 5000;   // hold still → full clear
const ERASE_STILL_PX = 10;     // px movement threshold
const ERASE_CHECK_MS = 200;    // movement sample interval

let eraseStillStart   = null;
let eraseIsMoving     = false;
let _eraseCheckX      = null;
let _eraseCheckY      = null;
let _eraseCheckTime   = 0;
let _lastCountdownSec = -1;
let _eraseFirstCheck  = true;

// ── Color palette ─────────────────────────────────────────────
const PALETTE  = ['#00FFAA', '#FF3366', '#33CCFF', '#FFCC00', '#cc55ff', '#FFFFFF'];
let paletteIdx = 0;

// ── Skeleton connections ──────────────────────────────────────
const CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [0,9],[9,10],[10,11],[11,12],
  [0,13],[13,14],[14,15],[15,16],
  [0,17],[17,18],[18,19],[19,20],
  [5,9],[9,13],[13,17]
];

// ═══════════════════════════════════════════════════════════════
// SKELETON RENDERER
// ═══════════════════════════════════════════════════════════════
function drawSkeleton(landmarks) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;

  ctx.save();
  ctx.lineWidth   = 1.5;
  ctx.strokeStyle = 'rgba(0,255,200,0.3)';
  ctx.shadowBlur  = 4;
  ctx.shadowColor = '#00FFC8';

  for (const [a, b] of CONNECTIONS) {
    ctx.beginPath();
    // Direct mapping — CSS scaleX(-1) on canvas handles visual mirror
    ctx.moveTo(landmarks[a].x * w, landmarks[a].y * h);
    ctx.lineTo(landmarks[b].x * w, landmarks[b].y * h);
    ctx.stroke();
  }

  ctx.shadowBlur = 8;
  for (let i = 0; i < landmarks.length; i++) {
    // Landmark 8 = index fingertip → highlight in yellow
    ctx.fillStyle = (i === 8) ? '#FFCC00' : '#00FFC8';
    ctx.beginPath();
    ctx.arc(landmarks[i].x * w, landmarks[i].y * h, i === 8 ? 5 : 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════
// APP INIT
// ═══════════════════════════════════════════════════════════════
async function startApp() {
  isAppRunning = true;

  handEngine = new HandTrackingEngine(video);
  await handEngine.initialize(msg => uiManager?.setLoadingText(msg));
  uiManager?.hideLoading();

  // Match canvas resolution to camera output
  const resizeCanvas = () => {
    const w = video.videoWidth  || 640;
    const h = video.videoHeight || 480;
    drawingEngine.resize(w, h);
  };
  resizeCanvas();
  video.addEventListener('loadedmetadata', resizeCanvas);

  requestAnimationFrame(renderLoop);
}

// ═══════════════════════════════════════════════════════════════
// MAIN RENDER LOOP  (requestAnimationFrame)
// ═══════════════════════════════════════════════════════════════
function renderLoop(time) {
  if (!isAppRunning) return;

  // ── Frame skipping: ML only on even frames ─────────────────
  frameCount++;
  const results = (frameCount % 2 === 0)
    ? handEngine.detect(performance.now())  // run ML
    : handEngine.lastResults;               // use cached

  const hasHand = !!(results?.landmarks?.length);
  let gesture   = 'IDLE';
  let rawX = null, rawY = null;

  if (hasHand) {
    gesture = gestureEngine.analyze(results.landmarks);
    uiManager.updateGestureLabel(gesture, true);

    drawSkeleton(results.landmarks[0]);

    // ── Coordinate mapping ─────────────────────────────────
    // x = landmark.x * canvas.width  (direct — no pre-flip)
    // y = landmark.y * canvas.height
    // CSS scaleX(-1) on #output_canvas mirrors visually so
    // finger left→ appears left, finger right→ appears right.
    const tip = results.landmarks[0][8];
    const tx  = tip.x * canvas.width;
    const ty  = tip.y * canvas.height;

    // ── Exponential smoothing (single pass) ────────────────
    if (smoothX === null) { smoothX = tx; smoothY = ty; }
    else {
      smoothX = smoothX * SMOOTH + tx * (1 - SMOOTH);
      smoothY = smoothY * SMOOTH + ty * (1 - SMOOTH);
    }
    rawX = smoothX;
    rawY = smoothY;

    drawingEngine.addTrailPoint(rawX, rawY);

    // ── Gesture dispatch ───────────────────────────────────
    switch (gesture) {

      case 'DRAW': {
        _resetErase();
        uiManager.clearCountdown();
        if (!isDrawingActive) {
          drawingEngine.startLine(rawX, rawY);
          isDrawingActive = true;
        } else {
          drawingEngine.addPoint(rawX, rawY);
        }
        break;
      }

      case 'ERASE': {
        if (isDrawingActive) {
          drawingEngine.endLine();
          isDrawingActive = false;
        }
        isErasing = true;

        // Sample movement every ERASE_CHECK_MS to decide brush vs hold
        const now = performance.now();
        if (now - _eraseCheckTime > ERASE_CHECK_MS) {
          if (_eraseCheckX !== null && !_eraseFirstCheck) {
            const delta = Math.hypot(rawX - _eraseCheckX, rawY - _eraseCheckY);
            eraseIsMoving = delta > ERASE_STILL_PX;
          }
          _eraseCheckX     = rawX;
          _eraseCheckY     = rawY;
          _eraseCheckTime  = now;
          _eraseFirstCheck = false;
        }

        if (eraseIsMoving) {
          // Moving hand → brush erase
          drawingEngine.eraseAt(rawX, rawY);
          eraseStillStart   = null;
          _lastCountdownSec = -1;
          uiManager.clearCountdown();
        } else {
          // Still hand → countdown to full clear
          if (!eraseStillStart) eraseStillStart = now;
          const elapsed  = now - eraseStillStart;
          const secsLeft = Math.ceil((ERASE_HOLD_MS - elapsed) / 1000);
          if (elapsed >= ERASE_HOLD_MS) {
            drawingEngine.clear(true);
            uiManager.clearCountdown();
            uiManager.showToast('🗑️ Canvas Cleared!');
            eraseStillStart   = null;
            eraseIsMoving     = false;
            _lastCountdownSec = -1;
          } else if (secsLeft !== _lastCountdownSec) {
            _lastCountdownSec = secsLeft;
            uiManager.showCountdown(`🖐️ Hold to Clear… ${secsLeft}s`);
          }
        }
        break;
      }

      default: {
        // PEACE / IDLE — end any active stroke or erase
        _resetErase();
        uiManager.clearCountdown();
        if (isDrawingActive) {
          drawingEngine.endLine();
          isDrawingActive = false;
        }
        break;
      }
    }

  } else {
    // No hand detected — clean slate
    uiManager.updateGestureLabel('IDLE', false);
    uiManager.clearCountdown();
    _resetErase();
    if (isDrawingActive) {
      drawingEngine.endLine();
      isDrawingActive = false;
    }
    smoothX = null;
    smoothY = null;
  }

  // Palm-hold progress ring
  let holdProgress = 0;
  if (isErasing && !eraseIsMoving && eraseStillStart !== null) {
    holdProgress = Math.min(1, (performance.now() - eraseStillStart) / ERASE_HOLD_MS);
  }

  drawingEngine.render(rawX, rawY, gesture, hasHand, holdProgress);
  requestAnimationFrame(renderLoop);
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
function _resetErase() {
  if (isErasing) { drawingEngine.endErase(); isErasing = false; }
  eraseStillStart  = null;
  eraseIsMoving    = false;
  _eraseCheckX     = null;
  _eraseCheckY     = null;
  _eraseCheckTime  = 0;
  _eraseFirstCheck = true;
  _lastCountdownSec = -1;
}

// ═══════════════════════════════════════════════════════════════
// BOOTSTRAP
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  gestureEngine = new GestureEngine();
  drawingEngine = new DrawingEngine(canvas, 640, 480);

  // ✌️ Peace → cycle color
  gestureEngine.onPeaceGesture = () => {
    paletteIdx = (paletteIdx + 1) % PALETTE.length;
    const color = PALETTE[paletteIdx];
    drawingEngine.setColor(color);
    uiManager.flashColorChange(color);
    document.querySelectorAll('.color-btn').forEach((btn, i) =>
      btn.classList.toggle('active', i === paletteIdx)
    );
  };

  uiManager = new UIManager(drawingEngine, {
    onStart: () => startApp().catch(e => console.error('Start error:', e))
  });
});
