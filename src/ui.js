export class UIManager {
  constructor(drawingEngine, callbacks) {
    this.drawingEngine = drawingEngine;
    this.callbacks     = callbacks;
    this._lastGesture  = null;
    this._handDetected = false;

    // ── Element refs ──────────────────────────────────────────
    this.modal          = document.getElementById('onboarding-modal');
    this.startBtn       = document.getElementById('start-btn');
    this.loadingOverlay = document.getElementById('loading-overlay');
    this.loadingText    = document.getElementById('loading-text');
    this.gestureLabel   = document.getElementById('gesture-label');
    this.handStatus     = document.getElementById('hand-status');
    this.toastEl        = document.getElementById('toast');
    this.colorFlash     = document.getElementById('color-flash');
    this.countdownEl    = document.getElementById('countdown-badge');

    this.colorBtns   = document.querySelectorAll('.color-btn');
    this.sizeInput   = document.getElementById('brush-size');
    this.sizeVal     = document.getElementById('size-val');
    this.glowInput   = document.getElementById('glow-intensity');
    this.glowVal     = document.getElementById('glow-val');
    this.eraserInput = document.getElementById('eraser-size');
    this.eraserVal   = document.getElementById('eraser-val');
    this.undoBtn     = document.getElementById('undo-btn');
    this.clearBtn    = document.getElementById('clear-btn');
    this.downloadBtn = document.getElementById('download-btn');

    this.controlsPanel = document.getElementById('controls-panel');
    this.togglePanelBtn = document.getElementById('toggle-panel-btn');

    this._toastTimer      = null;
    this._colorFlashTimer = null;

    this._bindEvents();
  }

  // ── Event binding ─────────────────────────────────────────────
  _bindEvents() {
    this.startBtn?.addEventListener('click', () => {
      this.modal?.classList.remove('active');
      this.callbacks.onStart?.();
    });

    this.colorBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.colorBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.drawingEngine.setColor(btn.dataset.color);
        this.showToast('🎨 Color changed');
      });
    });

    this.sizeInput?.addEventListener('input', e => {
      this.sizeVal.textContent = e.target.value;
      this.drawingEngine.setSize(+e.target.value);
    });

    this.glowInput?.addEventListener('input', e => {
      this.glowVal.textContent = e.target.value;
      this.drawingEngine.setGlow(+e.target.value);
    });

    this.eraserInput?.addEventListener('input', e => {
      this.eraserVal.textContent = e.target.value;
      this.drawingEngine.setEraserSize(+e.target.value);
    });

    this.undoBtn?.addEventListener('click', () => {
      this.drawingEngine.undo();
      this.showToast('↩ Undone');
    });

    this.clearBtn?.addEventListener('click', () => {
      this.drawingEngine.clear(true);
      this.showToast('🗑️ Canvas Cleared');
    });

    this.downloadBtn?.addEventListener('click', () => {
      this.drawingEngine.download();
      this.showToast('⬇️ Saved as PNG');
    });

    this.togglePanelBtn?.addEventListener('click', () => {
      this.controlsPanel?.classList.toggle('collapsed');
      this.togglePanelBtn?.classList.toggle('collapsed');
    });
  }

  // ── Loading ──────────────────────────────────────────────────
  setLoadingText(msg) {
    if (this.loadingText) this.loadingText.textContent = msg;
  }

  hideLoading() {
    this.loadingOverlay?.classList.remove('active');
  }

  // ── Gesture badge + hand status ───────────────────────────────
  updateGestureLabel(gesture, handDetected) {
    if (gesture === this._lastGesture && handDetected === this._handDetected) return;
    this._lastGesture  = gesture;
    this._handDetected = handDetected;

    const labels = {
      DRAW:  'Drawing ✏️',
      ERASE: 'Erasing 🧽',
      PEACE: 'Color Change 🎨',
      IDLE:  'Idle 🤚'
    };

    if (this.gestureLabel) {
      this.gestureLabel.textContent = labels[gesture] ?? gesture;
      this.gestureLabel.className   = 'badge ' + gesture.toLowerCase();
    }

    if (this.handStatus) {
      if (handDetected && gesture === 'DRAW') {
        this.handStatus.textContent = 'Drawing ✏️';
        this.handStatus.className   = 'hand-status ready';
      } else if (handDetected && gesture === 'ERASE') {
        this.handStatus.textContent = 'Erasing 🧽';
        this.handStatus.className   = 'hand-status erasing';
      } else if (handDetected && gesture === 'PEACE') {
        this.handStatus.textContent = 'Color Change 🎨';
        this.handStatus.className   = 'hand-status peace';
      } else if (handDetected) {
        this.handStatus.textContent = 'Hand Detected ✅';
        this.handStatus.className   = 'hand-status detected';
      } else {
        this.handStatus.textContent = 'No Hand ❌';
        this.handStatus.className   = 'hand-status none';
      }
    }
  }

  // ── Toast ─────────────────────────────────────────────────────
  showToast(msg) {
    if (!this.toastEl) return;
    clearTimeout(this._toastTimer);
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('visible');
    this._toastTimer = setTimeout(() => this.toastEl.classList.remove('visible'), 2500);
  }

  // ── Countdown (hold-to-clear) ─────────────────────────────────
  showCountdown(msg) {
    if (!this.countdownEl) return;
    this.countdownEl.textContent = msg;
    this.countdownEl.classList.add('visible');
  }

  clearCountdown() {
    this.countdownEl?.classList.remove('visible');
  }

  // ── Color flash (peace gesture) ───────────────────────────────
  flashColorChange(color) {
    if (!this.colorFlash) return;
    clearTimeout(this._colorFlashTimer);
    this.colorFlash.style.background = color;
    this.colorFlash.style.opacity    = '0.16';
    this._colorFlashTimer = setTimeout(() => {
      this.colorFlash.style.opacity = '0';
    }, 320);
    this.showToast(`🎨 Color: ${color}`);
  }
}
