// ── AERIX SPATIAL OS MAIN CONTROLLER ──────────────────────────────────────
import './style.css';
import { HandTrackingEngine } from './handTracking.js';
import { GestureEngine }      from './gesture.js';
import { DrawingEngine }      from './drawing.js';
import { UIManager }          from './ui.js';
import { io }                 from 'socket.io-client';

// ── DOM References ─────────────────────────────────────────────────────────
const video  = document.getElementById('webcam');
const canvas = document.getElementById('output_canvas');

// ── Engines ────────────────────────────────────────────────────────────────
let handEngine;
let gestureEngine;
let drawingEngine;
let uiManager;
let socket = null;

// ── Runtime State ──────────────────────────────────────────────────────────
let isAppRunning    = false;
let isDrawingActive = false;
let isErasing       = false;
let currentRoom     = 'default';

// ── Frame skipping & Telemetry ─────────────────────────────────────────────
let frameCount    = 0;
let lastFpsTime   = performance.now();
let fpsFrames     = 0;
let currentFps    = 60;

// ── Position smoothing: 0.7 old + 0.3 new ─────────────────────────────────
let smoothFactor = 0.7;
let smoothX = null, smoothY = null;

// ── Smart Erase Controller ─────────────────────────────────────────────────
const ERASE_HOLD_MS  = 5000;
const ERASE_STILL_PX = 10;
const ERASE_CHECK_MS = 200;

let eraseStillStart   = null;
let eraseIsMoving     = false;
let _eraseCheckX      = null;
let _eraseCheckY      = null;
let _eraseCheckTime   = 0;
let _lastCountdownSec = -1;
let _eraseFirstCheck  = true;

// ── Spectrum Palette ───────────────────────────────────────────────────────
const SPECTRUM_PALETTE = ['#00FFAA', '#38BDF8', '#8B5CF6', '#06B6D4', '#FF3366', '#FFCC00', '#FFFFFF'];
let spectrumIdx = 0;

// ── Skeleton Connections ───────────────────────────────────────────────────
const CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [0,9],[9,10],[10,11],[11,12],
  [0,13],[13,14],[14,15],[15,16],
  [0,17],[17,18],[18,19],[19,20],
  [5,9],[9,13],[13,17]
];

// ── Skeleton Renderer ──────────────────────────────────────────────────────
function drawHolographicSkeleton(landmarks) {
  const showSkeleton = document.getElementById('setting-skeleton')?.checked ?? true;
  if (!showSkeleton) return;

  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;

  ctx.save();
  ctx.lineWidth   = 1.5;
  ctx.strokeStyle = 'rgba(6, 182, 212, 0.35)';
  ctx.shadowBlur  = 6;
  ctx.shadowColor = '#06B6D4';

  for (const [a, b] of CONNECTIONS) {
    ctx.beginPath();
    ctx.moveTo(landmarks[a].x * w, landmarks[a].y * h);
    ctx.lineTo(landmarks[b].x * w, landmarks[b].y * h);
    ctx.stroke();
  }

  for (let i = 0; i < landmarks.length; i++) {
    // Fingertip 8 = Index tip -> highlight with glowing emerald halo
    if (i === 8) {
      ctx.fillStyle   = '#00FFAA';
      ctx.shadowBlur  = 12;
      ctx.shadowColor = '#00FFAA';
      ctx.beginPath();
      ctx.arc(landmarks[i].x * w, landmarks[i].y * h, 5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle   = 'rgba(139, 92, 246, 0.8)';
      ctx.shadowBlur  = 4;
      ctx.shadowColor = '#8B5CF6';
      ctx.beginPath();
      ctx.arc(landmarks[i].x * w, landmarks[i].y * h, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// ── App Initialization ─────────────────────────────────────────────────────
async function startAerix() {
  try {
    isAppRunning = true;
    handEngine = new HandTrackingEngine(video);

    await handEngine.initialize((msg, pct) => {
      uiManager.setLoadingProgress(msg, pct);
    });

    uiManager.hidePortal();
    uiManager.showToast('🚀 AERIX SPATIAL WORKSPACE READY');

    // Match resolution to camera stream
    const resizeCanvas = () => {
      const w = video.videoWidth  || 640;
      const h = video.videoHeight || 480;
      drawingEngine.resize(w, h);
    };
    resizeCanvas();
    video.addEventListener('loadedmetadata', resizeCanvas);

    // Initialize Multiplayer Socket
    initMultiplayer();

    requestAnimationFrame(renderLoop);
  } catch (err) {
    console.error('AERIX Launch Error:', err);
    uiManager.showToast('⚠️ Camera permission denied or device busy');
  }
}

// ── Multiplayer Client ─────────────────────────────────────────────────────
function initMultiplayer() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    currentRoom = urlParams.get('room') || 'default';
    if (uiManager.liveRoomInput) uiManager.liveRoomInput.value = currentRoom;

    // Connect to server (port 3001 in dev or origin)
    const serverUrl = window.location.port === '5173' ? 'http://localhost:3001' : window.location.origin;
    socket = io(serverUrl, { transports: ['websocket', 'polling'] });

    socket.on('connect', () => {
      socket.emit('joinRoom', { room: currentRoom });
      uiManager.showToast(`🛰️ CONNECTED TO LIVE SPACE: ${currentRoom.toUpperCase()}`);
    });

    socket.on('roomUpdate', ({ count }) => {
      uiManager.updateLiveUsers(count);
    });

    socket.on('remoteDraw', (data) => {
      drawingEngine.receiveRemoteDraw(data);
    });

    socket.on('remoteStroke', (data) => {
      drawingEngine.receiveRemoteStroke(data);
    });

    socket.on('remoteClear', () => {
      drawingEngine.receiveRemoteClear();
      uiManager.flashDissolve();
    });

    socket.on('remoteCursorLeave', ({ id }) => {
      drawingEngine.removeRemoteCursor(id);
    });
  } catch (e) {
    console.warn('Multiplayer unavailable (offline mode):', e);
  }
}

function switchRoom(newRoom) {
  if (!socket || !newRoom) return;
  currentRoom = newRoom;
  socket.emit('joinRoom', { room: currentRoom });
}

// ── Main Render Loop (60 FPS) ──────────────────────────────────────────────
function renderLoop(time) {
  if (!isAppRunning) return;

  // FPS calculation
  fpsFrames++;
  if (time - lastFpsTime >= 1000) {
    currentFps = Math.round((fpsFrames * 1000) / (time - lastFpsTime));
    fpsFrames   = 0;
    lastFpsTime = time;
  }

  // Frame skipping: ML inference on even frames (~30Hz)
  frameCount++;
  const results = (frameCount % 2 === 0)
    ? handEngine.detect(performance.now())
    : handEngine.lastResults;

  const hasHand = !!(results?.landmarks?.length);
  let gesture   = 'IDLE';
  let rawX = null, rawY = null;

  if (hasHand) {
    gesture = gestureEngine.analyze(results.landmarks);

    // Draw holographic bone joints
    drawHolographicSkeleton(results.landmarks[0]);

    // Fingertip 8 coordinates
    const tip = results.landmarks[0][8];
    const tx  = tip.x * canvas.width;
    const ty  = tip.y * canvas.height;

    // Exponential moving average smoothing
    if (smoothX === null) {
      smoothX = tx; smoothY = ty;
    } else {
      smoothX = smoothX * smoothFactor + tx * (1 - smoothFactor);
      smoothY = smoothY * smoothFactor + ty * (1 - smoothFactor);
    }
    rawX = smoothX;
    rawY = smoothY;

    drawingEngine.addTrailPoint(rawX, rawY);

    // Broadcast cursor telemetry
    if (socket && document.getElementById('setting-multiplayer-cursor')?.checked) {
      if (frameCount % 3 === 0) {
        socket.emit('cursor', {
          room: currentRoom,
          x: rawX,
          y: rawY,
          color: drawingEngine.currentColor
        });
      }
    }

    // ── Gesture State Machine ──────────────────────────────────────────────
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

        // Multiplayer live draw point
        if (socket) {
          socket.emit('draw', {
            room: currentRoom,
            x: rawX,
            y: rawY,
            isDrawing: true,
            color: drawingEngine.currentColor,
            size: drawingEngine.currentSize,
            glow: drawingEngine.currentGlow
          });
        }
        break;
      }

      case 'ERASE': {
        if (isDrawingActive) {
          const committedLine = drawingEngine.currentLine;
          drawingEngine.endLine();
          isDrawingActive = false;
          if (socket && committedLine) {
            socket.emit('stroke', { room: currentRoom, ...committedLine });
          }
        }
        isErasing = true;

        // Sample movement to distinguish brush erase vs. 5s hold-to-clear
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
          drawingEngine.eraseAt(rawX, rawY);
          eraseStillStart   = null;
          _lastCountdownSec = -1;
          uiManager.clearCountdown();
          if (socket) socket.emit('erase', { room: currentRoom, x: rawX, y: rawY });
        } else {
          if (!eraseStillStart) eraseStillStart = now;
          const elapsed  = now - eraseStillStart;
          const secsLeft = Math.ceil((ERASE_HOLD_MS - elapsed) / 1000);

          if (elapsed >= ERASE_HOLD_MS) {
            drawingEngine.clear(true);
            uiManager.clearCountdown();
            uiManager.flashDissolve();
            uiManager.showToast('🗑️ CANVAS DISSOLVED');
            if (socket) socket.emit('clear', { room: currentRoom });
            eraseStillStart   = null;
            eraseIsMoving     = false;
            _lastCountdownSec = -1;
          } else if (secsLeft !== _lastCountdownSec) {
            _lastCountdownSec = secsLeft;
            uiManager.showCountdown(`🖐️ DISSOLVING CANVAS… ${secsLeft}s`);
          }
        }
        break;
      }

      default: {
        // PEACE / IDLE
        _resetErase();
        uiManager.clearCountdown();
        if (isDrawingActive) {
          const committedLine = drawingEngine.currentLine;
          drawingEngine.endLine();
          isDrawingActive = false;
          if (socket && committedLine) {
            socket.emit('stroke', { room: currentRoom, ...committedLine });
          }
        }
        break;
      }
    }
  } else {
    // Hand away
    uiManager.clearCountdown();
    _resetErase();
    if (isDrawingActive) {
      const committedLine = drawingEngine.currentLine;
      drawingEngine.endLine();
      isDrawingActive = false;
      if (socket && committedLine) {
        socket.emit('stroke', { room: currentRoom, ...committedLine });
      }
    }
    smoothX = null;
    smoothY = null;
  }

  // Hold-to-dissolve radial progress calculation
  let holdProgress = 0;
  if (isErasing && !eraseIsMoving && eraseStillStart !== null) {
    holdProgress = Math.min(1, (performance.now() - eraseStillStart) / ERASE_HOLD_MS);
  }

  // Update telemetry HUD
  uiManager.updateTelemetry({
    fps: currentFps,
    confidence: gestureEngine.confidenceScore,
    handDetected: hasHand,
    gesture
  });

  drawingEngine.render(rawX, rawY, gesture, hasHand, holdProgress);
  requestAnimationFrame(renderLoop);
}

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

// ── Keyboard Shortcuts ─────────────────────────────────────────────────────
function initKeyboardShortcuts() {
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      drawingEngine.undo();
      uiManager.showToast('↩ STROKE UNDONE');
    } else if (e.key.toLowerCase() === 's') {
      e.preventDefault();
      drawingEngine.download();
      uiManager.showToast('⬇️ CAPTURED & SAVED');
    } else if (e.key.toLowerCase() === 'c' || e.key === 'Delete') {
      e.preventDefault();
      drawingEngine.clear(true);
      uiManager.flashDissolve();
      uiManager.showToast('🗑️ CANVAS DISSOLVED');
    }
  });
}

// ── Bootstrap ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  gestureEngine = new GestureEngine();
  drawingEngine = new DrawingEngine(canvas, 640, 480);

  // ✌️ Peace Gesture -> Cycle Spectrum Palette
  gestureEngine.onPeaceGesture = () => {
    spectrumIdx = (spectrumIdx + 1) % SPECTRUM_PALETTE.length;
    const color = SPECTRUM_PALETTE[spectrumIdx];
    drawingEngine.setColor(color);
    uiManager.flashColorChange(color);
    document.querySelectorAll('.spectrum-swatch').forEach((swatch, idx) => {
      swatch.classList.toggle('active', idx === spectrumIdx);
    });
    uiManager.showToast(`SPECTRUM CYCLED: ${color}`);
  };

  uiManager = new UIManager(drawingEngine, {
    onStart: () => startAerix(),
    onSwitchRoom: (newRoom) => switchRoom(newRoom),
    onSmoothChange: (val) => { smoothFactor = val; }
  });

  initKeyboardShortcuts();
});
