import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

export class HandTrackingEngine {
  constructor(videoElement) {
    this.video          = videoElement;
    this.handLandmarker = null;
    this.lastVideoTime  = -1;
    this.lastResults    = null;   // cached — returned on identical video frames
    this._missedFrames  = 0;      // consecutive frames with no detection
    this._maxMissed     = 4;      // after N misses, clear cache (real absence)
  }

  /**
   * Initialize hand landmarker and camera.
   * @param {function} onProgress - callback(message) for loading steps
   */
  async initialize(onProgress) {
    onProgress?.('Downloading AI model…');
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm'
    );

    onProgress?.('Building hand landmarker…');
    this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
        delegate: 'GPU'
      },
      runningMode:                  'VIDEO',
      numHands:                     1,          // track only 1 hand → faster
      minHandDetectionConfidence:   0.55,       // slightly lower → fewer misses
      minHandPresenceConfidence:    0.55,
      minTrackingConfidence:        0.45        // more lenient tracking
    });

    onProgress?.('Starting camera (640×480)…');
    await this._initCamera();
    onProgress?.('Ready!');
  }

  async _initCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width:     { ideal: 640 },
        height:    { ideal: 480 },
        frameRate: { ideal: 30, max: 30 }
      },
      audio: false
    });

    this.video.srcObject = stream;

    return new Promise((resolve) => {
      this.video.onloadedmetadata = () => {
        this.video.play();
        resolve(this.video);
      };
    });
  }

  /**
   * Run detection. Returns the latest valid result (fresh or cached).
   *
   * Caching strategy:
   *   - If video frame hasn't changed → return last result (no ML cost).
   *   - If ML returns empty landmarks for _maxMissed consecutive frames
   *     → treat as genuine absence, clear cache so drawing stops cleanly.
   *   - Otherwise keep the last good result to bridge brief occlusions.
   */
  detect(nowInMs) {
    if (!this.handLandmarker || !this.video) return this.lastResults;

    // Only run ML when there's a new video frame
    if (this.video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = this.video.currentTime;

      try {
        const fresh = this.handLandmarker.detectForVideo(this.video, nowInMs);

        if (fresh?.landmarks?.length) {
          // Good detection — reset miss counter, update cache
          this._missedFrames = 0;
          this.lastResults   = fresh;
        } else {
          // Empty result — increment miss counter
          this._missedFrames++;
          if (this._missedFrames >= this._maxMissed) {
            // Genuine absence after N consecutive misses
            this.lastResults = fresh;  // will have empty landmarks
          }
          // else: keep last good result (bridge brief occlusion)
        }
      } catch (e) {
        // Silently ignore detection errors (timing jitter, etc.)
      }
    }

    return this.lastResults;
  }
}
