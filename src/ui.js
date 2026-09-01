// ── AERIX SPATIAL UI MANAGER ──────────────────────────────────────────────

export class UIManager {
  constructor(drawingEngine, callbacks = {}) {
    this.drawingEngine = drawingEngine;
    this.callbacks     = callbacks;

    this._activePanel = null;
    this._lastGesture = null;
    this._handDetected = false;

    this._initDomRefs();
    this._bindEvents();
    this._initSpatialCursor();
  }

  // ── DOM References ───────────────────────────────────────────────────────
  _initDomRefs() {
    // Portal & Loading
    this.portal         = document.getElementById('onboarding-portal');
    this.startBtn       = document.getElementById('start-btn');
    this.loadingOverlay = document.getElementById('loading-overlay');
    this.loadingText    = document.getElementById('loading-text');
    this.loadingBar     = document.getElementById('loading-bar');

    // Telemetry HUD
    this.hudVision      = document.getElementById('hud-vision-status');
    this.hudTracking    = document.getElementById('hud-tracking-status');
    this.hudFps         = document.getElementById('hud-fps-readout');
    this.hudConf        = document.getElementById('hud-confidence');
    this.hudActiveTool  = document.getElementById('hud-active-tool');
    this.gestureLabel   = document.getElementById('gesture-label');
    this.handIndicator  = document.getElementById('hand-indicator-pill');
    this.countdownEl    = document.getElementById('countdown-badge');

    // Spatial Cursor
    this.spatialCursor  = document.getElementById('spatial-cursor');
    this.cursorLabel    = document.getElementById('cursor-label');

    // Tool Rail & Radial Menu
    this.railBtns       = document.querySelectorAll('.rail-btn[data-tool]');
    this.radialMenu     = document.getElementById('radial-menu');
    this.radialTrigger  = document.getElementById('radial-trigger-btn');
    this.radialSlices   = document.querySelectorAll('.radial-slice');

    // Panels & Drawers
    this.panels = {
      spectrum:  document.getElementById('panel-spectrum'),
      brush:     document.getElementById('panel-brush'),
      inkai:     document.getElementById('panel-inkai'),
      aistudio:  document.getElementById('panel-aistudio')
    };
    this.panelCloseBtns = document.querySelectorAll('.panel-close-btn');

    // Spectrum Controls
    this.spectrumSwatches = document.querySelectorAll('.spectrum-swatch');
    this.customColorPicker= document.getElementById('custom-color-picker');

    // Brush Controls
    this.brushPreviewDot = document.getElementById('brush-preview-dot');
    this.sizeSlider      = document.getElementById('brush-size');
    this.sizeVal         = document.getElementById('size-val');
    this.glowSlider      = document.getElementById('glow-intensity');
    this.glowVal         = document.getElementById('glow-val');
    this.eraserSlider    = document.getElementById('eraser-size');
    this.eraserVal       = document.getElementById('eraser-val');

    // Quick Actions
    this.undoBtn         = document.getElementById('undo-btn');
    this.clearBtn        = document.getElementById('clear-btn');
    this.downloadBtn     = document.getElementById('download-btn');

    // ShapeSense HUD
    this.shapesenseHud   = document.getElementById('shapesense-hud');
    this.shapeNameEl     = document.getElementById('shapesense-shape-name');
    this.shapePerfectBtn = document.getElementById('shapesense-perfect-btn');
    this.shapeKeepBtn    = document.getElementById('shapesense-keep-btn');
    this._currentShape   = null;
    this._currentLine    = null;

    // Ink AI Elements
    this.inkTranscribedText = document.getElementById('ink-transcribed-text');
    this.inkCopyBtn         = document.getElementById('ink-copy-btn');
    this.inkClearBtn        = document.getElementById('ink-clear-btn');
    this.inkTranslateBtn    = document.getElementById('ink-translate-btn');
    this.inkSaveBtn         = document.getElementById('ink-save-btn');

    // AI Studio Buttons
    this.btnAiSmooth     = document.getElementById('btn-ai-smooth');
    this.btnAiCleanup    = document.getElementById('btn-ai-cleanup');
    this.btnAiHarmonize  = document.getElementById('btn-ai-harmonize');

    // Modals
    this.controlHubModal = document.getElementById('control-hub-modal');
    this.liveSpaceModal  = document.getElementById('live-space-modal');
    this.gestureGuideModal=document.getElementById('gesture-guide-modal');

    this.settingsBtn     = document.getElementById('settings-btn');
    this.liveSpaceBtn    = document.getElementById('live-space-btn');
    this.guideBtn        = document.getElementById('guide-btn');

    this.closeControlHub = document.getElementById('close-control-hub');
    this.closeLiveSpace  = document.getElementById('close-live-space');
    this.closeGestureGuide=document.getElementById('close-gesture-guide');

    // Multiplayer elements
    this.liveUserCount   = document.getElementById('live-user-count');
    this.modalUserCount  = document.getElementById('modal-user-count');
    this.liveRoomInput   = document.getElementById('live-room-input');
    this.btnSwitchRoom   = document.getElementById('btn-switch-room');
    this.btnCopyInvite   = document.getElementById('btn-copy-invite');

    // Feedback Overlays
    this.colorFlash      = document.getElementById('color-flash');
    this.dissolveOverlay = document.getElementById('dissolve-overlay');
    this.toastContainer  = document.getElementById('toast-container');

    // Settings inputs
    this.settingMirror   = document.getElementById('setting-mirror');
    this.settingSkeleton = document.getElementById('setting-skeleton');
    this.settingParticles= document.getElementById('setting-particles');
    this.settingSmooth   = document.getElementById('setting-smooth');
  }

  // ── Custom Spatial Cursor ────────────────────────────────────────────────
  _initSpatialCursor() {
    let mouseX = window.innerWidth / 2;
    let mouseY = window.innerHeight / 2;

    window.addEventListener('mousemove', (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
      if (this.spatialCursor) {
        this.spatialCursor.style.transform = `translate(${mouseX}px, ${mouseY}px)`;
      }
    });

    // Hover interactive elements
    const interactiveEls = document.querySelectorAll('button, input, select, a, .gesture-card, .spectrum-swatch');
    interactiveEls.forEach(el => {
      el.addEventListener('mouseenter', () => this.spatialCursor?.classList.add('hovering'));
      el.addEventListener('mouseleave', () => this.spatialCursor?.classList.remove('hovering'));
    });
  }

  // ── Event Bindings ───────────────────────────────────────────────────────
  _bindEvents() {
    // 1. Portal Launch
    this.startBtn?.addEventListener('click', () => {
      this.loadingOverlay?.classList.add('active');
      this.callbacks.onStart?.();
    });

    // 2. Tool Rail Selection
    this.railBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tool = btn.dataset.tool;
        this._selectTool(tool);
      });
    });

    // 3. Radial Menu
    this.radialTrigger?.addEventListener('click', () => {
      this.radialMenu?.classList.toggle('active');
    });

    this.radialSlices.forEach(slice => {
      slice.addEventListener('click', (e) => {
        const action = slice.dataset.action;
        this._handleRadialAction(action);
        this.radialMenu?.classList.remove('active');
      });
    });

    // Close radial on backdrop click
    this.radialMenu?.querySelector('.radial-backdrop')?.addEventListener('click', () => {
      this.radialMenu?.classList.remove('active');
    });

    // 4. Panel Close Buttons
    this.panelCloseBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this._closeAllPanels();
        this._setRailActive('create');
      });
    });

    // 5. Spectrum Swatches
    this.spectrumSwatches.forEach(swatch => {
      swatch.addEventListener('click', () => {
        this.spectrumSwatches.forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
        const color = swatch.dataset.color;
        const name  = swatch.dataset.name || color;
        this.drawingEngine.setColor(color);
        this._updateBrushPreview();
        this.flashColorChange(color);
        this.showToast(`SPECTRUM: ${name}`);
      });
    });

    this.customColorPicker?.addEventListener('input', (e) => {
      const color = e.target.value;
      this.drawingEngine.setColor(color);
      this._updateBrushPreview();
      this.flashColorChange(color);
      this.showToast(`CUSTOM HUE: ${color}`);
    });

    // 6. Brush Sliders
    this.sizeSlider?.addEventListener('input', (e) => {
      const val = +e.target.value;
      this.sizeVal.textContent = `${val < 10 ? '0' + val : val} px`;
      this.drawingEngine.setSize(val);
      this._updateBrushPreview();
    });

    this.glowSlider?.addEventListener('input', (e) => {
      const val = +e.target.value;
      this.glowVal.textContent = `${Math.round((val / 60) * 100)}%`;
      this.drawingEngine.setGlow(val);
      this._updateBrushPreview();
    });

    this.eraserSlider?.addEventListener('input', (e) => {
      const val = +e.target.value;
      this.eraserVal.textContent = `${val} px`;
      this.drawingEngine.setEraserSize(val);
    });

    // 7. Quick Actions
    this.undoBtn?.addEventListener('click', () => {
      this.drawingEngine.undo();
      this.showToast('↩ STROKE UNDONE');
    });

    this.clearBtn?.addEventListener('click', () => {
      this.drawingEngine.clear(true);
      this.flashDissolve();
      this.showToast('🗑️ CANVAS DISSOLVED');
    });

    this.downloadBtn?.addEventListener('click', () => {
      this.drawingEngine.download();
      this.showToast('⬇️ CAPTURED & SAVED PNG');
    });

    // 8. ShapeSense HUD
    this.shapePerfectBtn?.addEventListener('click', () => {
      if (this._currentShape && this._currentLine) {
        this.drawingEngine.perfectLastShape(this._currentShape, this._currentLine);
        this.showToast(`✨ SHAPESENSE: PERFECTED ${this._currentShape.name}`);
      }
      this.shapesenseHud?.classList.remove('active');
    });

    this.shapeKeepBtn?.addEventListener('click', () => {
      this.shapesenseHud?.classList.remove('active');
    });

    // Wire up DrawingEngine shape callback
    this.drawingEngine.onShapeDetected = (shapeObj, line) => {
      this._currentShape = shapeObj;
      this._currentLine  = line;
      if (this.shapeNameEl) this.shapeNameEl.textContent = shapeObj.name;
      this.shapesenseHud?.classList.add('active');
      setTimeout(() => this.shapesenseHud?.classList.remove('active'), 5000);
    };

    // 9. Ink AI Handwriting Actions
    this.inkCopyBtn?.addEventListener('click', () => {
      const text = this.inkTranscribedText?.textContent?.trim() || '';
      navigator.clipboard?.writeText(text);
      this.showToast('📋 COPIED TO CLIPBOARD');
    });

    this.inkClearBtn?.addEventListener('click', () => {
      if (this.inkTranscribedText) this.inkTranscribedText.textContent = '...';
      this.showToast('🔄 INK AI BUFFER CLEARED');
    });

    this.inkTranslateBtn?.addEventListener('click', () => {
      this.showToast('🌐 TRANSLATING SPATIAL CALLIGRAPHY...');
    });

    this.inkSaveBtn?.addEventListener('click', () => {
      this.showToast('💾 INSERTED INTO CANVAS');
    });

    // 10. AI Studio Actions
    this.btnAiSmooth?.addEventListener('click', () => {
      this.drawingEngine.aiSmoothAll();
      this.showToast('✨ AI CURVE SMOOTHING APPLIED');
    });

    this.btnAiCleanup?.addEventListener('click', () => {
      this.drawingEngine.aiCleanup();
      this.showToast('🧹 ARTIFACTS & STRAY DOTS CLEANED');
    });

    this.btnAiHarmonize?.addEventListener('click', () => {
      this.drawingEngine.aiHarmonizePalette();
      this.showToast('🌈 NEON PALETTE HARMONIZED');
    });

    // 11. Modal Dialog Triggers
    this.settingsBtn?.addEventListener('click', () => this.controlHubModal?.classList.add('active'));
    this.closeControlHub?.addEventListener('click', () => this.controlHubModal?.classList.remove('active'));

    this.liveSpaceBtn?.addEventListener('click', () => this.liveSpaceModal?.classList.add('active'));
    this.closeLiveSpace?.addEventListener('click', () => this.liveSpaceModal?.classList.remove('active'));

    this.guideBtn?.addEventListener('click', () => this.gestureGuideModal?.classList.add('active'));
    this.closeGestureGuide?.addEventListener('click', () => this.gestureGuideModal?.classList.remove('active'));

    // 12. Settings inputs
    this.settingParticles?.addEventListener('change', (e) => {
      this.drawingEngine.setParticleIntensity(e.target.value);
      this.showToast(`PARTICLES: ${e.target.value.toUpperCase()}`);
    });

    this.settingSmooth?.addEventListener('change', (e) => {
      if (this.callbacks.onSmoothChange) {
        this.callbacks.onSmoothChange(+e.target.value);
      }
      this.showToast(`SMOOTH FILTER: ${e.target.value}`);
    });

    // 13. Live Space Copy Invite
    this.btnCopyInvite?.addEventListener('click', () => {
      const room = this.liveRoomInput?.value || 'default';
      const link = `${window.location.origin}?room=${room}`;
      navigator.clipboard?.writeText(link);
      this.showToast('🔗 INVITE LINK COPIED');
    });

    this.btnSwitchRoom?.addEventListener('click', () => {
      const room = this.liveRoomInput?.value?.trim() || 'default';
      this.callbacks.onSwitchRoom?.(room);
      this.liveSpaceModal?.classList.remove('active');
      this.showToast(`SWITCHED TO ROOM: ${room.toUpperCase()}`);
    });
  }

  // ── Tool Selection & Drawer Management ───────────────────────────────────
  _selectTool(tool) {
    this._setRailActive(tool);

    if (tool === 'create') {
      this._closeAllPanels();
      if (this.hudActiveTool) this.hudActiveTool.textContent = 'PEN GLOW';
      this.showToast('✏️ CREATE / PEN ACTIVE');
      return;
    }

    if (tool === 'shapesense') {
      this._closeAllPanels();
      this.showToast('📐 SHAPESENSE ACTIVE — DRAW SHAPES');
      if (this.hudActiveTool) this.hudActiveTool.textContent = 'SHAPESENSE';
      return;
    }

    // Slide panels
    this._closeAllPanels();
    const panel = this.panels[tool];
    if (panel) {
      panel.classList.add('active');
      this._activePanel = panel;
      if (this.hudActiveTool) this.hudActiveTool.textContent = tool.toUpperCase();
    }
  }

  _setRailActive(tool) {
    this.railBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });
  }

  _closeAllPanels() {
    Object.values(this.panels).forEach(p => p?.classList.remove('active'));
    this._activePanel = null;
  }

  _handleRadialAction(action) {
    switch (action) {
      case 'draw':       this._selectTool('create'); break;
      case 'erase':      this.showToast('🖐️ OPEN PALM TO ERASE'); break;
      case 'spectrum':   this._selectTool('spectrum'); break;
      case 'shapesense': this._selectTool('shapesense'); break;
      case 'inkai':      this._selectTool('inkai'); break;
      case 'aistudio':   this._selectTool('aistudio'); break;
      case 'download':   this.drawingEngine.download(); this.showToast('💾 CAPTURED & SAVED'); break;
      case 'clear':      this.drawingEngine.clear(true); this.flashDissolve(); this.showToast('🗑️ CANVAS DISSOLVED'); break;
    }
  }

  _updateBrushPreview() {
    if (!this.brushPreviewDot) return;
    const color = this.drawingEngine.currentColor;
    const size  = this.drawingEngine.currentSize;
    const glow  = this.drawingEngine.currentGlow;

    this.brushPreviewDot.style.width  = `${Math.max(6, size * 1.8)}px`;
    this.brushPreviewDot.style.height = `${Math.max(6, size * 1.8)}px`;
    this.brushPreviewDot.style.backgroundColor = color;
    this.brushPreviewDot.style.boxShadow = `0 0 ${glow}px ${color}`;
  }

  // ── Public Loading & Portal Methods ──────────────────────────────────────
  setLoadingProgress(msg, percent) {
    if (this.loadingText) this.loadingText.textContent = msg;
    if (this.loadingBar && percent !== undefined) this.loadingBar.style.width = `${percent}%`;
  }

  hidePortal() {
    this.loadingOverlay?.classList.remove('active');
    this.portal?.classList.remove('active');
  }

  // ── Telemetry & Gesture HUD ──────────────────────────────────────────────
  updateTelemetry({ fps, confidence, handDetected, gesture }) {
    if (this.hudFps) this.hudFps.textContent = `${fps} FPS`;
    if (this.hudConf) this.hudConf.textContent = `${confidence}% CONF`;

    if (this.handIndicator) {
      if (handDetected) {
        this.handIndicator.textContent = 'TRACKING';
        this.handIndicator.style.color = 'var(--accent-emerald)';
        this.handIndicator.style.borderColor = 'rgba(0, 255, 170, 0.4)';
      } else {
        this.handIndicator.textContent = 'NO HAND';
        this.handIndicator.style.color = 'var(--text-muted)';
        this.handIndicator.style.borderColor = 'var(--border-subtle)';
      }
    }

    if (gesture !== this._lastGesture) {
      this._lastGesture = gesture;
      const labels = {
        DRAW:  'DRAW ✏️',
        ERASE: 'DISSOLVE 🧽',
        PEACE: 'SPECTRUM ✌️',
        IDLE:  'IDLE 🤚'
      };

      if (this.gestureLabel) {
        this.gestureLabel.textContent = labels[gesture] || gesture;
        this.gestureLabel.className   = `gesture-badge ${gesture.toLowerCase()}`;
      }

      // Sync Spatial Cursor state
      if (this.spatialCursor) {
        this.spatialCursor.classList.toggle('drawing', gesture === 'DRAW');
        this.spatialCursor.classList.toggle('erasing', gesture === 'ERASE');
      }
    }
  }

  updateLiveUsers(count) {
    if (this.liveUserCount) this.liveUserCount.textContent = count;
    if (this.modalUserCount) this.modalUserCount.textContent = count;
  }

  // ── Visual Feedback (Flashes, Countdown, Toasts) ─────────────────────────
  showToast(msg) {
    if (!this.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = 'aerix-toast';
    toast.textContent = msg;
    this.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      setTimeout(() => toast.remove(), 300);
    }, 2400);
  }

  flashColorChange(color) {
    if (!this.colorFlash) return;
    this.colorFlash.style.background = color;
    this.colorFlash.style.opacity    = '0.14';
    setTimeout(() => {
      this.colorFlash.style.opacity = '0';
    }, 300);
  }

  flashDissolve() {
    if (!this.dissolveOverlay) return;
    this.dissolveOverlay.style.opacity = '0.7';
    setTimeout(() => {
      this.dissolveOverlay.style.opacity = '0';
    }, 350);
  }

  showCountdown(msg) {
    if (!this.countdownEl) return;
    this.countdownEl.textContent = msg;
    this.countdownEl.classList.add('visible');
  }

  clearCountdown() {
    this.countdownEl?.classList.remove('visible');
  }
}
