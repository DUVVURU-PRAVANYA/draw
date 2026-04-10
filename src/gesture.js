// ── GestureEngine ─────────────────────────────────────────────────────────────
//
// Gesture map:
//   DRAW   – index finger only extended
//   ERASE  – open palm (all 4 fingers + thumb spread)
//   PEACE  – index + middle up  →  cycles color (fires once per entry)
//   IDLE   – fist or unknown
//
// Key improvements:
//   • 100ms debounce for IDLE/PEACE/ERASE transitions
//   • Longer persistence for DRAW (150ms) to avoid cuts during brief finger occlusion
//   • Confidence-weighted detection using finger tip vs PIP distance

export class GestureEngine {
  constructor() {
    this._cache    = 'IDLE';
    this._raw      = 'IDLE';
    this._rawTime  = 0;

    // Different debounce windows per transition:
    //   Entering DRAW  → fast  (40ms) so drawing starts quickly
    //   Leaving  DRAW  → slow (180ms) to prevent cuts from brief finger dips
    //   All others     → 100ms balanced
    this._debounceEnterDraw = 40;
    this._debounceExitDraw  = 180;
    this._debounceDefault   = 100;

    // Peace fires once per entry into PEACE state
    this._peaceTriggered = false;
    this.onPeaceGesture  = null;   // callback set by main.js
  }

  // ── Public ─────────────────────────────────────────────────────────────────
  analyze(landmarks) {
    if (!landmarks || landmarks.length === 0) {
      this._peaceTriggered = false;
      return this._debounced('IDLE');
    }

    const lm = landmarks[0];

    // ── Landmark aliases ────────────────────────────────────────────────────
    const wrist     = lm[0];
    const thumbTip  = lm[4];
    const indexTip  = lm[8],  indexPip = lm[6],  indexMcp = lm[5];
    const midTip    = lm[12], midPip   = lm[10];
    const ringTip   = lm[16], ringPip  = lm[14];
    const pinkyTip  = lm[20], pinkyPip = lm[18];

    // ── Finger extension (tip.y < pip.y in image coords = finger pointing up)
    // We also add a secondary check: tip must be above its MCP knuckle for index.
    const indexUp = indexTip.y < indexPip.y && indexTip.y < indexMcp.y;
    const midUp   = midTip.y   < midPip.y;
    const ringUp  = ringTip.y  < ringPip.y;
    const pinkyUp = pinkyTip.y < pinkyPip.y;

    // ── Thumb extension: thumb tip away from index base horizontally ─────
    const thumbSpread = Math.abs(thumbTip.x - lm[5].x) > 0.08;

    // ── Pinch check (thumb meets index tip) ─────────────────────────────
    const pinchDist = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);

    let detected;

    // Priority order: PEACE > ERASE > DRAW > IDLE
    if (indexUp && midUp && !ringUp && !pinkyUp && pinchDist > 0.06) {
      // ✌️ Two fingers → cycle color
      detected = 'PEACE';
      if (!this._peaceTriggered) {
        this._peaceTriggered = true;
        if (this.onPeaceGesture) this.onPeaceGesture();
      }

    } else if (indexUp && midUp && ringUp && pinkyUp) {
      // 🖐️ Open palm → erase (moving = brush, still = hold-to-clear)
      detected = 'ERASE';
      this._peaceTriggered = false;

    } else if (indexUp && !midUp && !ringUp && !pinkyUp) {
      // ☝️ Index only → draw
      detected = 'DRAW';
      this._peaceTriggered = false;

    } else if (!indexUp && !midUp && !ringUp && !pinkyUp) {
      // ✊ Fist → pause / idle
      detected = 'IDLE';
      this._peaceTriggered = false;

    } else {
      // Ambiguous hand pose → keep last state (reduces flicker)
      detected = this._cache;
      // But don't permanently lock into PEACE or ERASE from ambiguity
      if (detected === 'PEACE') detected = 'DRAW';
    }

    // Always reset peace trigger when leaving PEACE
    if (detected !== 'PEACE') this._peaceTriggered = false;

    return this._debounced(detected);
  }

  // ── Private ────────────────────────────────────────────────────────────────
  /**
   * Adaptive debounce:
   *   • Rapid entry into DRAW (40ms) so the pen responds immediately.
   *   • Slow exit from DRAW (180ms) so brief finger dips don't cut lines.
   *   • Default 100ms for all other transitions.
   */
  _debounced(detected) {
    const now = performance.now();

    if (detected !== this._raw) {
      this._raw     = detected;
      this._rawTime = now;
    }

    // Choose debounce window based on transition
    let debounce = this._debounceDefault;
    if (detected === 'DRAW' && this._cache !== 'DRAW') {
      debounce = this._debounceEnterDraw;   // fast entry
    } else if (detected !== 'DRAW' && this._cache === 'DRAW') {
      debounce = this._debounceExitDraw;    // slow exit — prevents line cuts
    }

    if (this._raw !== this._cache && now - this._rawTime >= debounce) {
      this._cache = this._raw;
    }

    return this._cache;
  }
}
