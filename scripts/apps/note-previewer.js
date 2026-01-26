import { MODULE_ID, SOCKET_NAME } from "../config.js";
import { socket, activeGlobalSounds } from "../utils/socket-handler.js";
import { applyTapeEffectToElement, applyTapeEffectToSound } from "../utils/audio-utils.js";

// v13 namespaced imports
const ApplicationV2 = foundry.applications.api.ApplicationV2;
const HandlebarsApplicationMixin = foundry.applications.api.HandlebarsApplicationMixin;
const TextEditor = foundry.applications.ux.TextEditor.implementation;

/**
 * Application for viewing notes in a larger format.
 */
export class NotePreviewer extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(document, options = {}) {
    // Ensure singleton instance per document
    options.id = `note-preview-${document.id}`;
    super(options);
    this.document = document;
    this.localSound = null;
    this.globalSoundActive = false;
    this.audioPollInterval = null;
  }

  static DEFAULT_OPTIONS = {
    tag: "div",
    classes: ["note-preview-app"],
    window: {
      title: "Note Preview",
      resizable: true,
      minimizable: true,
      icon: "fas fa-search-plus"
    },
    position: {
      width: 600,
      height: "auto"
    }
  };

  static PARTS = {
    content: {
      template: "modules/investigation-board/templates/note-preview.html"
    }
  };

  async _prepareContext(options) {
    const noteData = this.document.flags[MODULE_ID];
    const noteType = noteData?.type || "sticky";
    
    // Use the note's font or fall back to Rock Salt
    const font = noteData?.font || "Rock Salt";
    const fontClass = font.toLowerCase().replace(/\s+/g, '-');

    // Determine the frame path for photo notes or background for others
    let framePath = "";
    let backgroundPath = "";
    
    if (noteType === "photo") {
      framePath = "modules/investigation-board/assets/photoFrame.webp";
    } else if (noteType === "sticky" || noteType === "index") {
      backgroundPath = noteType === "index" ? "modules/investigation-board/assets/note_index.webp" : "modules/investigation-board/assets/note_white.webp";
    }

    // Determine if we should show a separate text container
    // We show it for sticky and index notes
    const showSeparateText = ["sticky", "index"].includes(noteType);

    const audioPath = noteData?.audioPath;
    const isGlobalActive = !!(audioPath && activeGlobalSounds.has(audioPath) && activeGlobalSounds.get(audioPath).playing);
    this.globalSoundActive = isGlobalActive;

    const fontBoost = font === "Caveat" ? 1.25 : 1.0;

    return {
      noteType: noteType,
      text: noteData?.text || "",
      image: noteData?.image || "modules/investigation-board/assets/placeholder.webp",
      audioPath: audioPath,
      framePath: framePath,
      backgroundPath: backgroundPath,
      fontClass: fontClass,
      previewFontSize: (noteData?.fontSize || 15) * 2.5 * fontBoost,
      showSeparateText: showSeparateText,
      tint: noteData?.tint || "#ffffff",
      textColor: noteData?.textColor || "#000000",
      isGM: game.user.isGM,
      isGlobalActive: isGlobalActive,
      linkedObject: noteData?.linkedObject || "",
      enrichedLinkedObject: noteData?.linkedObject ? await TextEditor.enrichHTML(noteData.linkedObject, { async: true }) : ""
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    
    const html = this.element;
    
    // Close button
    html.querySelector(".close-preview-btn")?.addEventListener("click", () => this.close());

    // Edit button
    html.querySelector(".edit-note-btn")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      this.document.sheet.render(true);
    });

    // Local Audio Player Logic
    const localAudio = html.querySelector(".local-audio-player");
    const cassette = html.querySelector(".cassette-wrapper");
    
    if (localAudio && cassette) {
      // Apply tape effect if enabled
      const noteData = this.document.flags[MODULE_ID];
      if (noteData?.audioEffectEnabled !== false) {
        this.tapeEffect = applyTapeEffectToElement(localAudio);
      }

      localAudio.addEventListener("play", () => {
        cassette.classList.add("playing");
      });
      localAudio.addEventListener("pause", () => {
        if (!this.globalSoundActive) cassette.classList.remove("playing");
      });
      localAudio.addEventListener("ended", () => {
        if (!this.globalSoundActive) cassette.classList.remove("playing");
      });

      // Poll for external playback (e.g. from canvas context menu) to sync animation
      const audioPath = this.document.flags[MODULE_ID]?.audioPath;
      if (audioPath) {
        this.audioPollInterval = setInterval(() => {
          // Check if any sound with this source is currently playing
          const isPlaying = Array.from(game.audio.playing.values()).some(s => s.src === audioPath && s.playing);
          
          if (isPlaying) {
            if (!cassette.classList.contains("playing")) {
              cassette.classList.add("playing");
            }
          } else {
            // Only remove if not locally playing (checked via audio element) and not globally active state
            if (localAudio.paused && !this.globalSoundActive && cassette.classList.contains("playing")) {
              cassette.classList.remove("playing");
            }
          }
        }, 500);
      }
    }

    // Global Play Button (GM only)
    const playGlobalBtn = html.querySelector(".global-toggle");
    if (playGlobalBtn) {
      playGlobalBtn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        const audioPath = this.document.flags[MODULE_ID]?.audioPath;
        if (!audioPath || !socket) return;

        const icon = playGlobalBtn.querySelector("i");
        const span = playGlobalBtn.querySelector("span");

        const noteData = this.document.flags[MODULE_ID];
        const audioEffectEnabled = noteData?.audioEffectEnabled !== false;

        // If currently active, stop it
        if (this.globalSoundActive) {
          socket.emit(SOCKET_NAME, { action: "stopAudio", audioPath: audioPath });
          const localGlobal = activeGlobalSounds.get(audioPath);
          if (localGlobal) {
            localGlobal.stop();
            activeGlobalSounds.delete(audioPath);
          }
          this.globalSoundActive = false;
          icon.className = "fas fa-broadcast-tower";
          span.innerText = game.i18n.localize("investigation-board.html.playForAll"); // Play for All
          playGlobalBtn.classList.remove("active");
          if (localAudio?.paused) cassette.classList.remove("playing");
          return;
        }

        // START NEW - Stop any existing first to be sure
        const existing = activeGlobalSounds.get(audioPath);
        if (existing) {
          existing.stop();
          activeGlobalSounds.delete(audioPath);
        }

        // Get offset from local audio if it's already playing
        const offset = (localAudio && !localAudio.paused) ? localAudio.currentTime : 0;

        // PAUSE local audio before starting global to prevent doubling/distortion
        if (localAudio && !localAudio.paused) {
          localAudio.pause();
        }

        socket.emit(SOCKET_NAME, { 
            action: "playAudio", 
            audioPath: audioPath,
            applyEffect: audioEffectEnabled,
            offset: offset
        });
        
        const sound = await game.audio.play(audioPath, { 
          volume: 0.8,
          offset: offset
        });

        if (sound) {
          activeGlobalSounds.set(audioPath, sound);
          
          if (audioEffectEnabled) {
            applyTapeEffectToSound(sound);
          }

          this.globalSoundActive = true;
          icon.className = "fas fa-stop";
          span.innerText = game.i18n.localize("investigation-board.html.stopForAll"); // Stop for All
          playGlobalBtn.classList.add("active");
          cassette.classList.add("playing");

          const checkEnd = setInterval(() => {
            if (!sound.playing) {
              this.globalSoundActive = false;
              icon.className = "fas fa-broadcast-tower";
              span.innerText = game.i18n.localize("investigation-board.html.playForAll"); // Play for All
              playGlobalBtn.classList.remove("active");
              const current = activeGlobalSounds.get(audioPath);
              if (current === sound) activeGlobalSounds.delete(audioPath);
              if (localAudio?.paused) cassette.classList.remove("playing");
              clearInterval(checkEnd);
            }
          }, 1000);
        }
      });
    }

    // Handle clicking on enriched links in preview
    html.querySelectorAll(".preview-link a.content-link").forEach(link => {
      link.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation(); // Stop Foundry's global listener from also firing

        const uuid = link.dataset.uuid || 
                     link.getAttribute("data-uuid") || 
                     link.dataset.id || 
                     link.getAttribute("data-id");
        
        if (uuid) {
          try {
            const doc = await fromUuid(uuid);
            if (doc) {
              if (doc.testUserPermission(game.user, "LIMITED")) {
                doc.sheet.render(true);
              } else {
                ui.notifications.warn(`You do not have permission to view ${doc.name}.`);
              }
            }
          } catch (err) {
            console.error("Investigation Board: Error opening linked document", err);
          }
        }
      });
    });

    // Handle auto-play options passed from Context Menu
    if (options.autoplay) {
      if (localAudio && localAudio.paused) {
        // Small delay to ensure DOM is ready and constraints are met
        setTimeout(() => {
          localAudio.play().catch(e => console.warn("Investigation Board: Auto-play blocked by browser policy", e));
        }, 100);
      }
    }

    if (options.autobroadcast && playGlobalBtn) {
      // Small delay to ensure logic is ready
      setTimeout(() => {
        if (!playGlobalBtn.classList.contains("active")) {
          playGlobalBtn.click();
        }
      }, 100);
    }
  }

  async _onClose(options) {
    if (this.tapeEffect) {
      this.tapeEffect.disconnect();
      this.tapeEffect = null;
    }
    if (this.audioPollInterval) {
      clearInterval(this.audioPollInterval);
      this.audioPollInterval = null;
    }
    if (this.localSound) {
      this.localSound.stop();
      this.localSound = null;
    }
    return super._onClose?.(options);
  }
}
