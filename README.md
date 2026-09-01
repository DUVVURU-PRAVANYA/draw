# AERIX — AI-Powered Touchless Creative Workspace

> **CREATE BEYOND TOUCH.**  
> Spatial computing operating system controlled by real-time computer vision hand tracking.

---

## 🌟 Visual Identity & Key Features

* **Spatial Vision Engine**: GPU-accelerated MediaPipe HandLandmarker with 60 FPS zero-lag coordinate smoothing.
* **Touchless Gestures (Gestura)**:
  * ☝️ **Create / Pen**: Raise index finger only to paint glowing spatial strokes.
  * ✌️ **Spectrum Cycle**: Two fingers (index + middle) cycles through curated neon palettes.
  * 🖐️ **Smart Erase & Dissolve**: Move open palm to erase localized areas; hold open palm still for 5s to dissolve the canvas.
  * ✊ **Standby / Pause**: Fist freezes tracking to reposition your hand without painting.
* **ShapeSense AI**: Geometric stroke recognizer (Circle, Square, Triangle, Line) with one-click perfection assist.
* **Ink AI**: Air handwriting stroke trajectory sampler and OCR transcription tool.
* **AERIX AI Studio**: Neural smoothing, artifact cleanup, and neon palette harmonizer.
* **Live Space (Multiplayer)**: Room-based real-time canvas collaboration and spatial presence cursors via Socket.IO.
* **Radial Command Matrix**: Futuristic circular HUD for lightning-fast tool switching.

---

## 🚀 Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Backend Multiplayer Server
```bash
node server.js
```
*Health Check:* `http://localhost:3001/health`

### 3. Start the Vite Frontend Server
```bash
npm run dev
```

---

## ⌨️ Keyboard Shortcuts
* `Ctrl + Z` / `Cmd + Z`: Undo last stroke
* `S`: Capture & export canvas as high-resolution PNG
* `C` / `Delete`: Dissolve canvas
