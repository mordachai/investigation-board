import { MODULE_ID, SOCKET_NAME, VIDEO_FORMATS } from "../config.js";
import { socket, activeVideoBroadcasts } from "../utils/socket-handler.js";

const ApplicationV2 = foundry.applications.api.ApplicationV2;
const HandlebarsApplicationMixin = foundry.applications.api.HandlebarsApplicationMixin;

/**
 * Video playback window for video-type media notes.
 * One singleton per drawing document (id: "video-player-{drawingId}").
 *
 * Phases:
 *  5 — local playback, format sizing, volume, click-to-play overlay
 *  6 — socket broadcast wiring (playVideo / pauseVideo / seekVideo / stopVideoBroadcast)
 *  7 — entry effects (white noise, mechanical sound, tracking glitch, film grain)
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

    // Apply format padding as CSS variables so the frame margins are respected
    container.style.setProperty("--vp-pad-top",    `${format.padding.top}px`);
    container.style.setProperty("--vp-pad-right",  `${format.padding.right}px`);
    container.style.setProperty("--vp-pad-bottom", `${format.padding.bottom}px`);
    container.style.setProperty("--vp-pad-left",   `${format.padding.left}px`);
    container.style.setProperty("--vp-aspect",     `${format.aspectRatio}`);

    // Size the window: 60% of the viewport width, clamped to a sensible minimum
    const winWidth   = Math.max(Math.round(window.innerWidth * 0.6), 400);
    const videoWidth  = winWidth - format.padding.left - format.padding.right;
    const videoHeight = Math.round(videoWidth / format.aspectRatio);
    // Controls row height: 44px when GM (broadcast button), 0 for players
    const controlsH  = game.user.isGM ? 44 : 0;
    const totalHeight = videoHeight + format.padding.top + format.padding.bottom + controlsH;
    this.setPosition({ width: winWidth, height: totalHeight });

    // Update window title to the note's text
    const titleEl = this.element.closest(".app")?.querySelector(".window-title");
    if (titleEl && context.title) titleEl.textContent = context.title;

    if (!video) return;

    // Default volume
    video.volume = 0.8;

    // ---- GM BROADCAST EVENTS (wired to socket in Phase 6) ----
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

    // ---- BROADCAST BUTTON (GM only) ----
    const broadcastBtn = this.element.querySelector(".ib-broadcast-btn");
    if (broadcastBtn) {
      broadcastBtn.addEventListener("click", () => {
        if (this._broadcastActive) {
          this._stopBroadcast();
        } else {
          this._startBroadcast();
        }
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

    // ---- ENTRY EFFECTS (Phase 7) ----
    this._runEntryEffects(context);
  }

  // ---------------------------------------------------------------------------
  // Broadcast helpers
  // ---------------------------------------------------------------------------

  /**
   * Start broadcasting — opens the window for all clients, then syncs playback.
   * Socket wiring added in Phase 6.
   */
  _startBroadcast() {
    if (!socket) return;
    const video = this.element?.querySelector(".ib-video-element");

    activeVideoBroadcasts.set(this.document.id, { gmUserId: game.user.id });
    this._broadcastActive = true;
    this._updateBroadcastButton(true);

    // Tell all clients to open the window (Phase 6 socket emit)
    socket.emit(SOCKET_NAME, {
      action: "openVideoPlayer",
      drawingId: this.document.id,
    });

    // If video is already playing, emit a playVideo with current time
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

  /**
   * Emit a video sync event via socket.
   * Only called when broadcast is active and this client is GM.
   */
  _emitVideoEvent(action, currentTime) {
    if (!socket) return;
    socket.emit(SOCKET_NAME, { action, drawingId: this.document.id, currentTime });
  }

  // ---------------------------------------------------------------------------
  // Incoming sync (called by socket handler — Phase 6)
  // ---------------------------------------------------------------------------

  /**
   * Synchronise local video element to an incoming broadcast event.
   * @param {"playVideo"|"pauseVideo"|"seekVideo"} action
   * @param {number} currentTime
   */
  syncPlayback(action, currentTime) {
    const video = this.element?.querySelector(".ib-video-element");
    if (!video) return;

    this._lastSyncedTime = currentTime;

    if (action === "seekVideo") {
      video.currentTime = currentTime;
      return;
    }

    video.currentTime = currentTime;

    if (action === "playVideo") {
      video.play().catch(() => {
        // Browser autoplay policy blocked the play — show the click-to-play overlay
        const overlay = this.element.querySelector(".ib-click-to-play");
        if (overlay) overlay.classList.add("visible");
      });
    } else if (action === "pauseVideo") {
      video.pause();
    }
  }

  /**
   * Called when the GM stops the broadcast.
   * Pauses the local video and clears broadcast state.
   */
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
    const noteData = this.document.flags[MODULE_ID] || {};
    const effects = noteData.videoEffects ?? {};
    const format = context.format;

    // Ensure the SVG filter defs are present in the document (injected once globally)
    VideoPlayer._ensureSvgFilters();

    const wrapper = this.element.querySelector(".ib-video-wrapper");
    const video   = this.element.querySelector(".ib-video-element");

    // White noise overlay — full-frame flash that fades out
    if (effects.whiteNoise && wrapper) {
      const noise = document.createElement("div");
      noise.classList.add("ib-effect-noise");
      wrapper.appendChild(noise);
      noise.addEventListener("animationend", () => noise.remove(), { once: true });
    }

    // Tracking glitch overlay — brief horizontal jitter
    if (effects.trackingGlitch && wrapper) {
      const glitch = document.createElement("div");
      glitch.classList.add("ib-effect-glitch");
      wrapper.appendChild(glitch);
      glitch.addEventListener("animationend", () => glitch.remove(), { once: true });
    }

    // Film grain filter — stays on the video element while it exists
    if (effects.filmGrain && video) {
      video.classList.add("ib-film-grain");
    }

    // Mechanical sound — play format-specific SFX
    if (effects.mechanicalSound && format?.mechanicalSfx) {
      game.audio.play(format.mechanicalSfx, { volume: 0.6 }).catch(() => {});
    }
  }

  /**
   * Inject the reusable SVG filter definitions into the document body once.
   * Safe to call repeatedly — skipped if already present.
   */
  static _ensureSvgFilters() {
    if (document.getElementById("ib-svg-filters")) return;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.id = "ib-svg-filters";
    svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;";
    svg.innerHTML = `
      <defs>
        <!-- White noise filter for the noise overlay div -->
        <filter id="ib-noise-filter" x="0%" y="0%" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" result="noise"/>
          <feColorMatrix type="saturate" values="0" in="noise" result="grey"/>
          <feBlend in="SourceGraphic" in2="grey" mode="screen"/>
        </filter>
        <!-- Film grain filter for the video element -->
        <filter id="ib-grain-filter" x="0%" y="0%" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.80" numOctaves="4" stitchTiles="stitch" result="grain"/>
          <feColorMatrix type="saturate" values="0" in="grain" result="grey_grain"/>
          <feBlend in="SourceGraphic" in2="grey_grain" mode="overlay" result="blended"/>
          <feComponentTransfer in="blended">
            <feFuncA type="linear" slope="0.93"/>
          </feComponentTransfer>
        </filter>
      </defs>
    `;
    document.body.appendChild(svg);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async _onClose(options) {
    clearTimeout(this._seekThrottleTimer);
    clearInterval(this._syncInterval);
    // If GM closes while broadcasting, stop the broadcast
    if (game.user.isGM && this._broadcastActive) {
      this._stopBroadcast();
    }
    return super._onClose?.(options);
  }
}
