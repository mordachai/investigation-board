import { MODULE_ID, SOCKET_NAME, VIDEO_FORMATS } from "../config.js";
import { socket, activeVideoBroadcasts } from "../utils/socket-handler.js";

const ApplicationV2 = foundry.applications.api.ApplicationV2;
const HandlebarsApplicationMixin = foundry.applications.api.HandlebarsApplicationMixin;

/**
 * Video playback window for video-type media notes.
 * One singleton per drawing document (id: "video-player-{drawingId}").
 */
export class VideoPlayer extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(document, options = {}) {
    options.id = `video-player-${document.id}`;
    super(options);
    this.document = document;
    this._broadcastActive = false;
    this._lastSyncedTime = 0;
    this._seekThrottleTimer = null;
    this._syncInterval = null;

    // Effect loop handles
    this._grainRaf = null;
    this._timestampRaf = null;
    this._glitchTimeout = null;

    // Effect state
    this._timestampEl = null;
    this._timestampBaseMs = null;
    this._timestampDateFormat = "us";
    this._grainWrapper = null;
  }

  static DEFAULT_OPTIONS = {
    tag: "div",
    classes: ["ib-video-player"],
    window: {
      title: "Video",
      resizable: true,
      minimizable: true,
      icon: "fas fa-film"
    },
    position: {
      width: 800,
      height: "auto"
    }
  };

  static PARTS = {
    content: {
      template: "modules/investigation-board/templates/video-player.html"
    }
  };

  async _prepareContext(options) {
    const noteData = this.document.flags[MODULE_ID] || {};
    const formatKey = noteData.videoFormat || "crt";
    const format = VIDEO_FORMATS[formatKey] ?? VIDEO_FORMATS.crt;

    return {
      videoPath: noteData.videoPath || "",
      formatKey,
      format,
      isGM: game.user.isGM,
      isBroadcastActive: activeVideoBroadcasts.has(this.document.id),
      drawingId: this.document.id,
      title: noteData.text || "Video",
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);

    const { format } = context;
    const container = this.element.querySelector(".ib-video-player-content");
    const video = this.element.querySelector(".ib-video-element");

    if (!container) return;

    // Apply format padding as CSS variables
    container.style.setProperty("--vp-pad-top",    `${format.padding.top}px`);
    container.style.setProperty("--vp-pad-right",  `${format.padding.right}px`);
    container.style.setProperty("--vp-pad-bottom", `${format.padding.bottom}px`);
    container.style.setProperty("--vp-pad-left",   `${format.padding.left}px`);
    container.style.setProperty("--vp-aspect",     `${format.aspectRatio}`);

    // Size the window
    const winWidth   = Math.max(Math.round(window.innerWidth * 0.6), 400);
    const videoWidth  = winWidth - format.padding.left - format.padding.right;
    const videoHeight = Math.round(videoWidth / format.aspectRatio);
    const controlsH  = game.user.isGM ? 44 : 0;
    const totalHeight = videoHeight + format.padding.top + format.padding.bottom + controlsH;
    this.setPosition({ width: winWidth, height: totalHeight });

    // Update window title
    const titleEl = this.element.closest(".app")?.querySelector(".window-title");
    if (titleEl && context.title) titleEl.textContent = context.title;

    if (!video) return;

    video.volume = 0.8;

    // ---- GM BROADCAST EVENTS ----
    if (game.user.isGM) {
      video.addEventListener("play", () => {
        if (!this._broadcastActive) return;
        this._emitVideoEvent("playVideo", video.currentTime);
      });

      video.addEventListener("pause", () => {
        if (!this._broadcastActive) return;
        clearInterval(this._syncInterval);
        this._emitVideoEvent("pauseVideo", video.currentTime);
      });

      video.addEventListener("seeked", () => {
        if (!this._broadcastActive) return;
        clearTimeout(this._seekThrottleTimer);
        this._seekThrottleTimer = setTimeout(() => {
          this._emitVideoEvent("seekVideo", video.currentTime);
        }, 200);
      });

      video.addEventListener("ended", () => {
        if (!this._broadcastActive) return;
        clearInterval(this._syncInterval);
        this._emitVideoEvent("pauseVideo", video.currentTime);
        this._stopBroadcast();
      });
    }

    // ---- BROADCAST BUTTON ----
    const broadcastBtn = this.element.querySelector(".ib-broadcast-btn");
    if (broadcastBtn) {
      broadcastBtn.addEventListener("click", () => {
        if (this._broadcastActive) this._stopBroadcast();
        else this._startBroadcast();
      });
    }

    // ---- CLICK-TO-PLAY OVERLAY ----
    const overlay = this.element.querySelector(".ib-click-to-play");
    if (overlay) {
      overlay.addEventListener("click", () => {
        video.currentTime = this._lastSyncedTime;
        video.play().then(() => {
          overlay.classList.remove("visible");
        }).catch(() => {});
      });
    }

    // ---- ENTRY EFFECTS ----
    this._runEntryEffects(context);
  }

  // ---------------------------------------------------------------------------
  // Broadcast helpers
  // ---------------------------------------------------------------------------

  _startBroadcast() {
    if (!socket) return;
    const video = this.element?.querySelector(".ib-video-element");

    activeVideoBroadcasts.set(this.document.id, { gmUserId: game.user.id });
    this._broadcastActive = true;
    this._updateBroadcastButton(true);

    socket.emit(SOCKET_NAME, {
      action: "openVideoPlayer",
      drawingId: this.document.id,
    });

    if (video && !video.paused) {
      this._emitVideoEvent("playVideo", video.currentTime);
    }
  }

  _stopBroadcast() {
    if (!socket) return;
    clearInterval(this._syncInterval);
    activeVideoBroadcasts.delete(this.document.id);
    this._broadcastActive = false;
    this._updateBroadcastButton(false);

    socket.emit(SOCKET_NAME, {
      action: "stopVideoBroadcast",
      drawingId: this.document.id,
    });
  }

  _updateBroadcastButton(active) {
    const btn = this.element?.querySelector(".ib-broadcast-btn");
    if (!btn) return;
    const icon = btn.querySelector("i");
    const span = btn.querySelector("span");
    btn.classList.toggle("active", active);
    if (icon) icon.className = `fas ${active ? "fa-stop" : "fa-broadcast-tower"}`;
    if (span) span.textContent = active ? "Stop Broadcast" : "Open for All";
  }

  _emitVideoEvent(action, currentTime) {
    if (!socket) return;
    socket.emit(SOCKET_NAME, { action, drawingId: this.document.id, currentTime });
  }

  // ---------------------------------------------------------------------------
  // Incoming sync
  // ---------------------------------------------------------------------------

  syncPlayback(action, currentTime) {
    const video = this.element?.querySelector(".ib-video-element");
    if (!video) return;

    this._lastSyncedTime = currentTime;
    video.currentTime = currentTime;

    if (action === "seekVideo") return;

    if (action === "playVideo") {
      video.play().catch(() => {
        const overlay = this.element.querySelector(".ib-click-to-play");
        if (overlay) overlay.classList.add("visible");
      });
    } else if (action === "pauseVideo") {
      video.pause();
    }
  }

  onBroadcastStop() {
    const video = this.element?.querySelector(".ib-video-element");
    if (video) video.pause();
    activeVideoBroadcasts.delete(this.document.id);
    this._broadcastActive = false;
    this._updateBroadcastButton(false);
  }

  // ---------------------------------------------------------------------------
  // Entry effects
  // ---------------------------------------------------------------------------

  _runEntryEffects(context) {
    // Stop any loops left over from a previous render
    this._stopGrainLoop();
    this._stopTimestampLoop();
    this._stopGlitchInterval();

    const noteData = this.document.flags[MODULE_ID] || {};
    const effects  = noteData.videoEffects ?? {};
    const format   = context.format;

    const wrapper = this.element.querySelector(".ib-video-wrapper");
    if (!wrapper) return;
    this._grainWrapper = wrapper;

    // ---- Rolling shutter — dark scan band sweeping top → bottom ----
    if (effects.rollingShutter) {
      const shutter = document.createElement("div");
      shutter.classList.add("ib-effect-rolling-shutter");
      wrapper.appendChild(shutter);
      shutter.addEventListener("animationend", () => shutter.remove(), { once: true });
    }

    // ---- Mechanical sound ----
    if (effects.mechanicalSound && format?.mechanicalSfx) {
      game.audio.play(format.mechanicalSfx, { volume: 0.6 }).catch(() => {});
    }

    // ---- Timestamp: needs base date to activate ----
    const timestampEnabled = effects.timestampEnabled && !!effects.recordingStartISO;
    if (timestampEnabled) this._initTimestamp(wrapper, effects);

    // ---- Film grain — canvas RAF loop (also drives timestamp if both on) ----
    if (effects.filmGrain) {
      const intensity = effects.filmGrainIntensity ?? 0.15;
      this._startGrainLoop(wrapper, intensity, timestampEnabled);
    } else if (timestampEnabled) {
      // Grain off but timestamp needs RAF
      this._startTimestampLoop();
    }

    // ---- Tracking glitch — one immediately, then random recurring interval ----
    if (effects.trackingGlitch) {
      const minSec = effects.glitchIntervalMin ?? 8;
      const maxSec = effects.glitchIntervalMax ?? 20;
      this._spawnGlitch(wrapper);
      this._startGlitchInterval(minSec, maxSec);
    }
  }

  // ---------------------------------------------------------------------------
  // Film grain — canvas-based RAF
  // ---------------------------------------------------------------------------

  _startGrainLoop(wrapper, intensity, driveTimestamp) {
    const canvas = wrapper.querySelector(".ib-grain-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const rect = wrapper.getBoundingClientRect();
    canvas.width  = rect.width  || 640;
    canvas.height = rect.height || 360;

    const w     = canvas.width;
    const h     = canvas.height;
    const buf   = new Uint8ClampedArray(w * h * 4);
    const alpha = Math.round(Math.min(Math.max(intensity, 0.02), 0.5) * 255);

    let frame = 0;
    const tick = () => {
      // Draw grain every other frame (~30fps) for a natural flicker
      if (frame % 2 === 0) {
        for (let i = 0; i < buf.length; i += 4) {
          const v = (Math.random() * 255) | 0;
          buf[i] = buf[i + 1] = buf[i + 2] = v;
          buf[i + 3] = Math.random() < 0.35 ? alpha : 0;
        }
        ctx.putImageData(new ImageData(buf, w, h), 0, 0);
      }
      frame++;

      if (driveTimestamp) this._updateTimestamp();

      this._grainRaf = requestAnimationFrame(tick);
    };
    this._grainRaf = requestAnimationFrame(tick);
  }

  _stopGrainLoop() {
    if (this._grainRaf) {
      cancelAnimationFrame(this._grainRaf);
      this._grainRaf = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Timestamp-only RAF (when grain is off)
  // ---------------------------------------------------------------------------

  _startTimestampLoop() {
    const tick = () => {
      this._updateTimestamp();
      this._timestampRaf = requestAnimationFrame(tick);
    };
    this._timestampRaf = requestAnimationFrame(tick);
  }

  _stopTimestampLoop() {
    if (this._timestampRaf) {
      cancelAnimationFrame(this._timestampRaf);
      this._timestampRaf = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Timestamp
  // ---------------------------------------------------------------------------

  /**
   * Parse the recording start into a base UTC millisecond value and store it.
   * @param {HTMLElement} wrapper
   * @param {object} effects  — noteData.videoEffects
   */
  _initTimestamp(wrapper, effects) {
    const el = wrapper.querySelector(".ib-timestamp");
    if (!el) return;
    this._timestampEl = el;
    el.style.display = "";

    const iso   = effects.recordingStartISO ?? "";
    const centi = Math.min(99, Math.max(0, effects.recordingStartCenti ?? 0));

    // Parse datetime-local string (e.g. "1986-10-23T03:29:14") treating it as
    // UTC so the displayed time always matches exactly what the GM typed.
    const [datePart, timePart = "00:00:00"] = iso.split("T");
    const [y, mo, d] = datePart.split("-").map(Number);
    const tp = timePart.split(":").map(Number);
    const h = tp[0] ?? 0, mi = tp[1] ?? 0, s = tp[2] ?? 0;

    this._timestampBaseMs     = Date.UTC(y, mo - 1, d, h, mi, s) + centi * 10;
    this._timestampDateFormat = effects.timestampDateFormat ?? "us";

    // Apply position / style from saved settings
    this.updateTimestampStyle({
      x:        effects.timestampX        ?? 0,
      y:        effects.timestampY        ?? -1,
      fontSize: effects.timestampFontSize ?? 13,
      color:    effects.timestampColor    ?? "#00e040",
    });
  }

  /**
   * Update timestamp position and style live — called from the edit dialog sliders.
   * Safe to call even if the timestamp isn't currently shown.
   * @param {object} opts
   * @param {number} [opts.x]        — horizontal position, -1 (left) … 0 (center) … 1 (right)
   * @param {number} [opts.y]        — vertical position,  -1 (bottom) … 1 (top)
   * @param {number} [opts.fontSize] — font size in px
   * @param {string} [opts.color]    — CSS color string
   */
  updateTimestampStyle({ x, y, fontSize, color } = {}) {
    const el = this._timestampEl;
    if (!el) return;
    if (x        !== undefined) el.style.left     = `${50 + x * 45}%`;
    if (y        !== undefined) el.style.bottom   = `${5 + (y + 1) * 42}%`;
    if (fontSize !== undefined) el.style.fontSize = `${fontSize}px`;
    if (color    !== undefined) {
      el.style.color      = color;
      el.style.textShadow = `0 0 6px ${color}99`;
    }
  }

  /**
   * Recompute and update the timestamp overlay from video.currentTime.
   * Called every RAF tick when timestamp is enabled.
   */
  _updateTimestamp() {
    if (!this._timestampEl || this._timestampBaseMs == null) return;
    const video = this.element?.querySelector(".ib-video-element");
    if (!video) return;

    const offsetMs = Math.round(video.currentTime * 1000);
    const totalMs  = this._timestampBaseMs + offsetMs;
    const date     = new Date(totalMs);

    const d  = date.getUTCDate();
    const mo = date.getUTCMonth() + 1;
    const y  = date.getUTCFullYear();
    const h  = date.getUTCHours();
    const mi = date.getUTCMinutes();
    const s  = date.getUTCSeconds();
    const cc = Math.floor((totalMs % 1000) / 10);

    const p2 = n => String(n).padStart(2, "0");
    const p4 = n => String(n).padStart(4, "0");

    const dateStr = this._timestampDateFormat === "us"
      ? `${p2(mo)}-${p2(d)}-${p4(y)}`
      : `${p2(d)}-${p2(mo)}-${p4(y)}`;

    this._timestampEl.textContent = `${dateStr}  ${p2(h)}:${p2(mi)}:${p2(s)}:${p2(cc)}`;
  }

  // ---------------------------------------------------------------------------
  // Tracking glitch — recurring
  // ---------------------------------------------------------------------------

  _spawnGlitch(wrapper) {
    const el = document.createElement("div");
    el.classList.add("ib-effect-glitch");
    wrapper.appendChild(el);
    el.addEventListener("animationend", () => el.remove(), { once: true });
  }

  /**
   * Schedule recurring glitches at random intervals between minSec and maxSec.
   * Uses recursive setTimeout so the next glitch fires after the current one
   * plays out, giving a natural feel.
   */
  _startGlitchInterval(minSec, maxSec) {
    const range = Math.max(0, maxSec - minSec);
    const schedule = () => {
      const delay = (minSec + Math.random() * range) * 1000;
      this._glitchTimeout = setTimeout(() => {
        if (this._grainWrapper) this._spawnGlitch(this._grainWrapper);
        schedule();
      }, delay);
    };
    schedule();
  }

  _stopGlitchInterval() {
    clearTimeout(this._glitchTimeout);
    this._glitchTimeout = null;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async _onClose(options) {
    clearTimeout(this._seekThrottleTimer);
    clearInterval(this._syncInterval);
    this._stopGrainLoop();
    this._stopTimestampLoop();
    this._stopGlitchInterval();
    if (game.user.isGM && this._broadcastActive) {
      this._stopBroadcast();
    }
    return super._onClose?.(options);
  }
}
