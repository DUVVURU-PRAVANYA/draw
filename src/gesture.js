// ── AERIX GESTURE ENGINE (GESTURA) ────────────────────────────────────────
//
// Gesture Classification:
//   DRAW   – Index finger extended alone
//   ERASE  – Open palm (all fingers extended)
//   PEACE  – Index + middle fingers up (cycles Spectrum palette)
//   IDLE   – Fist, ambiguous poses, or hand away
//
// Hysteresis & Filtering:
//   • Fast entry into DRAW (40ms) for snappy spatial pen latency
//   • Slow exit from DRAW (180ms) to prevent cuts from momentary dips
//   • Real-time confidence scoring for telemetry HUD

export class GestureEngine {
  constructor() {
    this._cache    = 'IDLE';
    this._raw      = 'IDLE';
    this._rawTime  = 0;

    this._debounceEnterDraw = 40;
    this._debounceExitDraw  = 180;
    this._debounceDefault   = 100;

    this._peaceTriggered = false;
    this.onPeaceGesture  = null;

    this.confidenceScore = 98; // percentage
  }

  // ── Public Analysis ────────────────────────────────────────────────────────
  analyze(landmarks) {
    if (!landmarks || landmarks.length === 0) {
      this._peaceTriggered = false;
      this.confidenceScore = 0;
      return this._debounced('IDLE');
    }

    const lm = landmarks[0];

    // Landmarks
    const wrist     = lm[0];
    const thumbTip  = lm[4];
    const indexTip  = lm[8],  indexPip = lm[6],  indexMcp = lm[5];
    const midTip    = lm[12], midPip   = lm[10];
    const ringTip   = lm[16], ringPip  = lm[14];
    const pinkyTip  = lm[20], pinkyPip = lm[18];

    // Finger extension checks (y decreases upwards in video coords)
    const indexUp = indexTip.y < indexPip.y && indexTip.y < indexMcp.y;
    const midUp   = midTip.y   < midPip.y;
    const ringUp  = ringTip.y  < ringPip.y;
    const pinkyUp = pinkyTip.y < pinkyPip.y;

    const pinchDist = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);

    let detected = 'IDLE';
    let baseConfidence = 92;

    // Classification Cascade: PEACE > ERASE > DRAW > IDLE
    if (indexUp && midUp && !ringUp && !pinkyUp && pinchDist > 0.06) {
      detected = 'PEACE';
      baseConfidence = 96;
      if (!this._peaceTriggered) {
        this._peaceTriggered = true;
        if (this.onPeaceGesture) this.onPeaceGesture();
      }
    } else if (indexUp && midUp && ringUp && pinkyUp) {
      detected = 'ERASE';
      baseConfidence = 97;
      this._peaceTriggered = false;
    } else if (indexUp && !midUp && !ringUp && !pinkyUp) {
      detected = 'DRAW';
      baseConfidence = 99;
      this._peaceTriggered = false;
    } else if (!indexUp && !midUp && !ringUp && !pinkyUp) {
      detected = 'IDLE';
      baseConfidence = 90;
      this._peaceTriggered = false;
    } else {
      detected = this._cache;
      baseConfidence = 78;
      if (detected === 'PEACE') detected = 'DRAW';
    }

    if (detected !== 'PEACE') this._peaceTriggered = false;

    this.confidenceScore = baseConfidence;
    return this._debounced(detected);
  }

  // ── Adaptive Debouncing ───────────────────────────────────────────────────
  _debounced(detected) {
    const now = performance.now();

    if (detected !== this._raw) {
      this._raw     = detected;
      this._rawTime = now;
    }

    let debounce = this._debounceDefault;
    if (detected === 'DRAW' && this._cache !== 'DRAW') {
      debounce = this._debounceEnterDraw;
    } else if (detected !== 'DRAW' && this._cache === 'DRAW') {
      debounce = this._debounceExitDraw;
    }

    if (this._raw !== this._cache && now - this._rawTime >= debounce) {
      this._cache = this._raw;
    }

    return this._cache;
  }
}
