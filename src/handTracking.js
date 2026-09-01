import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

export class HandTrackingEngine {
  constructor(videoElement) {
    this.video          = videoElement;
    this.handLandmarker = null;
    this.lastVideoTime  = -1;
    this.lastResults    = null;
    this._missedFrames  = 0;
    this._maxMissed     = 4;
  }

  /**
   * Initialize hand landmarker and camera feed.
   * @param {function} onProgress - callback(message, percent)
   */
  async initialize(onProgress) {
    onProgress?.('INITIALIZING VISION ENGINE...', 20);
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm'
    );

    onProgress?.('LOADING HAND LANDMARK MODEL...', 55);
    this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
        delegate: 'GPU'
      },
      runningMode:                'VIDEO',
      numHands:                   1,
      minHandDetectionConfidence: 0.55,
      minHandPresenceConfidence:  0.55,
      minTrackingConfidence:      0.45
    });

    onProgress?.('CALIBRATING SPATIAL INPUT (640×480)...', 85);
    await this._initCamera();
    onProgress?.('SYSTEM READY', 100);
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
   * Run detection with frame caching and brief occlusion bridge.
   */
  detect(nowInMs) {
    if (!this.handLandmarker || !this.video) return this.lastResults;

    if (this.video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = this.video.currentTime;

      try {
        const fresh = this.handLandmarker.detectForVideo(this.video, nowInMs);

        if (fresh?.landmarks?.length) {
          this._missedFrames = 0;
          this.lastResults   = fresh;
        } else {
          this._missedFrames++;
          if (this._missedFrames >= this._maxMissed) {
            this.lastResults = fresh;
          }
        }
      } catch (e) {
        // Silently handle transient timing jitter
      }
    }

    return this.lastResults;
  }
}
