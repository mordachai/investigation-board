import { MODULE_ID, STICKY_TINTS, INK_COLORS, VIDEO_FORMATS } from "../config.js";
import { getAvailablePinFiles } from "../utils/helpers.js";
import { collaborativeUpdate } from "../utils/socket-handler.js";
import { applyTapeEffectToSound } from "../utils/audio-utils.js";
import { getRandomCassetteImage, getRandomVideoImage } from "../utils/creation-utils.js";
import { 
  startConnectionAnimation, 
  stopConnectionAnimation, 
  showConnectionNumbers, 
  clearConnectionNumbers, 
  drawAllConnectionLines 
} from "../canvas/connection-manager.js";

// v13 namespaced imports
const DrawingConfig = foundry.applications.sheets.DrawingConfig;
const FilePicker = foundry.applications.apps.FilePicker.implementation;
const TextEditor = foundry.applications.ux.TextEditor.implementation;

export class CustomDrawingSheet extends DrawingConfig {
  constructor(...args) {
    super(...args);
    this.previewSound = null;
  }

  /**
   * Override _canRender to allow all users to open this sheet for investigation board notes.
   * This bypasses Foundry's default permission check.
   */
  _canRender(options) {
    // Check if this is an investigation board note
    const noteData = this.document.flags?.[MODULE_ID];
    if (noteData?.type) {
      // Allow all users to render the sheet for investigation board notes
      return true;
    }
    // Fall back to default behavior
    return super._canRender(options);
  }

  static PARTS = {
    form: {
      template: "modules/investigation-board/templates/drawing-sheet.html"
    }
  };

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["custom-drawing-sheet"],
      template: "modules/investigation-board/templates/drawing-sheet.html",
      width: 400,
      height: "auto",
      title: "Note Configuration",
    });
  }

  // ApplicationV2 data preparation method
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const customData = this.getData(options);

    // Merge custom data into context
    context.noteType = customData.noteType;
    context.text = customData.text;
    context.image = customData.image;
    context.audioPath = customData.audioPath;
    context.linkedObject = customData.linkedObject;
    context.noteTypes = customData.noteTypes;
    context.connections = customData.connections;
    context.font = customData.font;
    context.fontSize = customData.fontSize;
    context.audioEffectEnabled = customData.audioEffectEnabled;
    context.tint = customData.tint;
    context.textColor = customData.textColor;
    context.stickyTints = customData.stickyTints;
    context.inkColors = customData.inkColors;
    // Video fields
    context.videoPath = customData.videoPath;
    context.videoFormat = customData.videoFormat;
    context.videoEffects = customData.videoEffects;
    context.mediaMode = customData.mediaMode;
    context.videoFormats = customData.videoFormats;

    // Enrich the linked object for display
    context.enrichedLinkedObject = context.linkedObject ? await TextEditor.enrichHTML(context.linkedObject, { async: true }) : "";

    // Gate sensitive fields (image paths, linked object) behind file-browse permission
    context.canViewSensitive = game.user.isGM || game.user.can("FILES_BROWSE");

    // Pin image choices — scan the configured folder, fall back to built-in list
    context.selectedPinColor = customData.selectedPinColor;
    context.showPinSelector  = game.settings.get(MODULE_ID, "pinColor") !== "none";
    if (context.showPinSelector) {
      const files = await getAvailablePinFiles();
      context.pinImageChoices = files.map(f => ({
        value: f,
        // "redPin.webp" → "Red Pin", "nail_gold.webp" → "Nail Gold"
        label: f.replace(/\.\w+$/, "").replace(/[_-]/g, " ").replace(/([A-Z])/g, " $1").trim()
               .replace(/\b\w/g, c => c.toUpperCase()),
        selected: f === customData.selectedPinColor
      }));
    }

    return context;
  }

  getData(options) {
    // In v13, super.getData() doesn't exist in ApplicationV2
    // Build the data object directly

    // Get connections and format them for display
    const connections = this.document.flags[MODULE_ID]?.connections || [];
    const formattedConnections = connections.map((conn, index) => {
      const targetDrawing = canvas.drawings.get(conn.targetId);
      let targetLabel = "Unknown Note";
      if (targetDrawing) {
        const targetData = targetDrawing.document.flags[MODULE_ID];
        if (targetData) {
          const typeLabels = { sticky: "Sticky Note", photo: "Photo Note", index: "Index Card", handout: "Handout", media: "Media Note" };
          targetLabel = typeLabels[targetData.type] || "Note";
        }
      } else {
        targetLabel = "Deleted Note";
      }

      return {
        targetId: conn.targetId,
        targetLabel: targetLabel,
        displayNumber: index + 1,
        color: conn.color || "#FF0000",
        width: conn.width || 3,
        index: index
      };
    });

    const noteType = this.document.flags[MODULE_ID]?.type || "sticky";
    const defaultFontSize = noteType === "index" ? 9 : game.settings.get(MODULE_ID, "baseFontSize");

    const ibFlags = this.document.flags[MODULE_ID] || {};
    const isVideoNote = !!ibFlags.videoPath;
    // mediaMode is stored explicitly in flags when the user toggles the radio button.
    // Fall back to deriving it from videoPath for notes created before this field existed.
    const mediaMode = ibFlags.mediaMode ?? (isVideoNote ? "video" : "audio");

    const data = {
      document: this.document,
      noteType: noteType,
      text: ibFlags.text || "Default Text",
      audioPath: ibFlags.audioPath || "",
      audioEffectEnabled: ibFlags.audioEffectEnabled !== false,
      linkedObject: ibFlags.linkedObject || "",
      image: ibFlags.image || (noteType === "handout" ? "modules/investigation-board/assets/newhandout.webp" : "modules/investigation-board/assets/placeholder.webp"),
      font: ibFlags.font || game.settings.get(MODULE_ID, "font"),
      fontSize: ibFlags.fontSize || defaultFontSize,
      tint: ibFlags.tint || "#ffffff",
      textColor: ibFlags.textColor || "#000000",
      stickyTints: STICKY_TINTS,
      inkColors: INK_COLORS,
      connections: formattedConnections,
      noteTypes: {
        sticky: "Sticky Note",
        photo: "Photo Note",
        index: "Index Card",
        handout: "Handout"
      },
      // Video fields
      videoPath: ibFlags.videoPath || "",
      videoFormat: ibFlags.videoFormat || "crt",
      videoEffects: (() => {
        // Hard defaults for every field (used as fallback for new or missing keys)
        const base = {
          rollingShutter: false,
          mechanicalSound: true,
          trackingGlitch: false,
          filmGrain: false,
          filmGrainIntensity: 0.15,
          glitchIntervalMin: 8,
          glitchIntervalMax: 20,
          timestampEnabled: false,
          recordingStartISO: new Date().toISOString().slice(0, 19),
          recordingStartCenti: 0,
          timestampDateFormat: "us",
          timestampX: 0,
          timestampY: -1,
          timestampFontSize: 13,
          timestampColor: "#00e040",
        };
        // For new notes (no saved effects yet) apply the format's defaults
        const formatKey = ibFlags.videoFormat || "crt";
        const formatDef = ibFlags.videoEffects
          ? {}
          : (VIDEO_FORMATS[formatKey]?.defaultEffects ?? {});
        return Object.assign(base, formatDef, ibFlags.videoEffects || {});
      })(),
      mediaMode,
      videoFormats: VIDEO_FORMATS,
      // Pin — bare filename stored in flags, or "" meaning "auto/random"
      selectedPinColor: ibFlags.pinColor || "",
    };
    return data;
  }
  

  /**
   * Override _prepareSubmitData to prevent AppV2's DocumentSheetV2 from validating
   * IB-specific form fields (text, image, font, etc.) against the DrawingDocument
   * schema. IB handles all updates manually through the submit event handler in _onRender.
   */
  _prepareSubmitData(event, form, formData) {
    return {};
  }

  // ApplicationV2 form submission handler (not used, kept for compatibility)
  async _processFormData(event, form, formData) {
    return formData;
  }

  async _processSubmitData(event, form, submitData) {
    // Not used in v13 - form handling done in _onRender
    return;
  }

  async _updateObject(event, formData) {
    // V1 fallback - not used in v13, form handling done in _onRender
    return;
  }

  // ApplicationV2 lifecycle method
  _onRender(context, options) {
    super._onRender?.(context, options);

    // ---- Tab switching (media notes only) ----
    const tabBtns = this.element.querySelectorAll(".ib-tab-btn");
    tabBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        tabBtns.forEach(b => b.classList.remove("active"));
        this.element.querySelectorAll(".ib-tab-panel").forEach(p => p.classList.remove("active"));
        btn.classList.add("active");
        this.element.querySelector(`.ib-tab-panel[data-panel="${btn.dataset.tab}"]`)?.classList.add("active");
      });
    });

    // ---- Film grain intensity — live label ----
    const grainRange = this.element.querySelector("[name='videoEffects.filmGrainIntensity']");
    const grainVal   = this.element.querySelector(".ib-intensity-val");
    if (grainRange && grainVal) {
      const updateLabel = () => {
        grainVal.textContent = `${Math.round(parseFloat(grainRange.value) * 100)}%`;
      };
      grainRange.addEventListener("input", updateLabel);
      updateLabel();
    }

    // ---- Reset effects to format defaults ----
    const resetBtn = this.element.querySelector(".ib-reset-effects-btn");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        const formatKey = this.element.querySelector("[name='videoFormat']")?.value ?? "crt";
        const defs = VIDEO_FORMATS[formatKey]?.defaultEffects ?? {};
        const boolKeys = ["rollingShutter", "mechanicalSound", "trackingGlitch", "filmGrain", "timestampEnabled"];
        boolKeys.forEach(k => {
          const cb = this.element.querySelector(`[name="videoEffects.${k}"]`);
          if (cb) cb.checked = !!defs[k];
        });
      });
    }

    // ---- Timestamp position/style — live update the open VideoPlayer ----
    const getPlayer = () =>
      foundry.applications.instances?.get(`video-player-${this.document.id}`);

    const tsX    = this.element.querySelector("[name='videoEffects.timestampX']");
    const tsY    = this.element.querySelector("[name='videoEffects.timestampY']");
    const tsSize = this.element.querySelector("[name='videoEffects.timestampFontSize']");
    const tsClr  = this.element.querySelector("[name='videoEffects.timestampColor']");
    const xVal   = this.element.querySelector(".ib-ts-x-val");
    const yVal   = this.element.querySelector(".ib-ts-y-val");
    const szVal  = this.element.querySelector(".ib-ts-size-val");

    const initLabel = (el, valEl, fmt) => { if (el && valEl) valEl.textContent = fmt(el.value); };
    initLabel(tsX,    xVal,  v => parseFloat(v).toFixed(2));
    initLabel(tsY,    yVal,  v => parseFloat(v).toFixed(2));
    initLabel(tsSize, szVal, v => `${v}px`);

    if (tsX) tsX.addEventListener("input", () => {
      if (xVal) xVal.textContent = parseFloat(tsX.value).toFixed(2);
      getPlayer()?.updateTimestampStyle({ x: parseFloat(tsX.value) });
    });
    if (tsY) tsY.addEventListener("input", () => {
      if (yVal) yVal.textContent = parseFloat(tsY.value).toFixed(2);
      getPlayer()?.updateTimestampStyle({ y: parseFloat(tsY.value) });
    });
    if (tsSize) tsSize.addEventListener("input", () => {
      if (szVal) szVal.textContent = `${tsSize.value}px`;
      getPlayer()?.updateTimestampStyle({ fontSize: parseInt(tsSize.value) });
    });
    if (tsClr) tsClr.addEventListener("input", () => {
      getPlayer()?.updateTimestampStyle({ color: tsClr.value });
    });

    // Start animating connections from this note
    startConnectionAnimation(this.document.id);

    // Show connection numbers on connected notes
    showConnectionNumbers(this.document.id);

    // Drop zone handling
    const dropZone = this.element.querySelector(".ib-drop-zone");
    if (dropZone) {
      dropZone.addEventListener("dragover", (ev) => {
        ev.preventDefault();
        dropZone.classList.add("drag-over");
      });

      dropZone.addEventListener("dragleave", () => {
        dropZone.classList.remove("drag-over");
      });

      dropZone.addEventListener("drop", async (ev) => {
        ev.preventDefault();
        dropZone.classList.remove("drag-over");
        
        try {
          const data = JSON.parse(ev.dataTransfer.getData("text/plain"));
          if (data.uuid) {
            const doc = await fromUuid(data.uuid);
            const link = doc ? `@UUID[${doc.uuid}]{${doc.name}}` : `@UUID[${data.uuid}]`;
            
            // Update immediately and re-render for enrichment
            await collaborativeUpdate(this.document.id, {
              [`flags.${MODULE_ID}.linkedObject`]: link
            });
            this.render(true);
          }
        } catch (err) {
          console.error("Investigation Board: Failed to process drop in sheet", err);
        }
      });
    }

    // Handle remove link button
    const removeLinkBtn = this.element.querySelector(".remove-link-btn");
    if (removeLinkBtn) {
      removeLinkBtn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        await collaborativeUpdate(this.document.id, {
          [`flags.${MODULE_ID}.linkedObject`]: ""
        });
        this.render(true);
      });
    }

    // Audio picker handling
    const audioPickerButton = this.element.querySelector(".audio-picker-button");
    if (audioPickerButton) {
      audioPickerButton.addEventListener("click", (ev) => {
        ev.preventDefault();
        const input = this.element.querySelector("input[name='audioPath']");
        new FilePicker({
          type: "audio",
          current: "",
          callback: async (path) => {
            input.value = path;
            // Enable preview button if a path is selected
            const previewBtn = this.element.querySelector(".preview-audio-btn");
            if (previewBtn) previewBtn.disabled = !path;
          }
        }).browse();
      });
    }

    // Audio preview handling
    const previewAudioBtn = this.element.querySelector(".preview-audio-btn");
    if (previewAudioBtn) {
      previewAudioBtn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        
        // If already playing, stop it
        if (this.previewSound && this.previewSound.playing) {
          this.previewSound.stop();
          this.previewSound = null;
          previewAudioBtn.innerHTML = '<i class="fas fa-play"></i>';
          previewAudioBtn.title = "Preview Audio";
          return;
        }

        const audioPath = this.element.querySelector("input[name='audioPath']")?.value;
        if (audioPath) {
          this.previewSound = await game.audio.play(audioPath, { volume: 0.8 });
          
          // Apply tape effect if enabled in the form
          const effectEnabled = this.element.querySelector("input[name='audioEffectEnabled']")?.checked;
          if (effectEnabled && this.previewSound) {
            applyTapeEffectToSound(this.previewSound);
          }

          previewAudioBtn.innerHTML = '<i class="fas fa-stop"></i>';
          previewAudioBtn.title = "Stop Preview";
          
          // Reset button when sound ends
          const sound = this.previewSound;
          setTimeout(() => {
            if (this.previewSound === sound && !sound.playing) {
               previewAudioBtn.innerHTML = '<i class="fas fa-play"></i>';
               previewAudioBtn.title = "Preview Audio";
            }
          }, 100); // Small delay to let it start
          
          // Monitor for end
          const checkEnd = setInterval(() => {
            if (!this.previewSound || this.previewSound !== sound || !sound.playing) {
              if (this.previewSound === sound) {
                previewAudioBtn.innerHTML = '<i class="fas fa-play"></i>';
                previewAudioBtn.title = "Preview Audio";
                this.previewSound = null;
              }
              clearInterval(checkEnd);
            }
          }, 500);
        }
      });
    }

    // Media type toggle (audio ↔ video)
    const mediaRadios = this.element.querySelectorAll("input[name='mediaMode']");
    const audioFields = this.element.querySelector(".ib-audio-fields");
    const videoFields = this.element.querySelector(".ib-video-fields");
    mediaRadios.forEach(radio => {
      radio.addEventListener("change", async () => {
        const isVideo = radio.value === "video";
        if (audioFields) audioFields.style.display = isVideo ? "none" : "";
        if (videoFields) videoFields.style.display = isVideo ? "" : "none";

        // Persist mediaMode explicitly in flags so the sheet re-render (triggered by
        // ApplicationV2's auto-render-on-document-update) reads the correct value and
        // doesn't snap the radio back to its previous state.
        const w = this.document.shape.width || 400;
        await collaborativeUpdate(this.document.id, {
          [`flags.${MODULE_ID}.mediaMode`]: radio.value,
          [`flags.${MODULE_ID}.image`]: isVideo ? getRandomVideoImage() : getRandomCassetteImage(),
          "shape.height": Math.round(w * (isVideo ? 0.571 : 0.74)),
        });

        // Foundry doesn't await async hook handlers, so the updateDrawing hook's
        // placeable.refresh() races with the frame render cycle and the sprite
        // texture update loses. Force a synchronous sprite redraw here, same as
        // the submit handler does after its collaborativeUpdate.
        const placeable = canvas.drawings.get(this.document.id);
        if (placeable) await placeable.refresh();
      });
    });

    // Video file picker
    const videoPickerButton = this.element.querySelector(".video-picker-button");
    if (videoPickerButton) {
      videoPickerButton.addEventListener("click", (ev) => {
        ev.preventDefault();
        const input = this.element.querySelector("input[name='videoPath']");
        new FilePicker({
          type: "video",
          current: input?.value || "",
          callback: (path) => {
            if (input) input.value = path;
          }
        }).browse();
      });
    }

    // Hook up file picker button
    const filePickerButton = this.element.querySelector(".file-picker-button");
    if (filePickerButton) {
      filePickerButton.addEventListener("click", (ev) => {
        ev.preventDefault();
        const input = this.element.querySelector("input[name='image']");

        new FilePicker({
          type: "image",
          current: "",
          callback: async (path) => {
            input.value = path;

            // Update image immediately for all note types
            const noteType = this.document.flags[MODULE_ID]?.type;
            if (noteType === "handout") {
              // Auto-resize handout notes when image is selected
              try {
                // Load the texture to get natural dimensions
                const texture = await PIXI.Assets.load(path);
                if (texture) {
                  let targetWidth = texture.width;
                  let targetHeight = texture.height;

                  // Apply 500px height cap
                  if (targetHeight > 500) {
                    const scale = 500 / targetHeight;
                    targetWidth = Math.round(targetWidth * scale);
                    targetHeight = 500;
                  }

                  // Apply 500px width cap
                  if (targetWidth > 500) {
                    const scale = 500 / targetWidth;
                    targetHeight = Math.round(targetHeight * scale);
                    targetWidth = 500;
                  }

                  // Update the drawing document dimensions AND image path (collaborative)
                  await collaborativeUpdate(this.document.id, {
                    'shape.width': targetWidth,
                    'shape.height': targetHeight,
                    [`flags.${MODULE_ID}.image`]: path
                  });

                  // Refresh the drawing on canvas
                  const drawing = canvas.drawings.get(this.document.id);
                  if (drawing) {
                    await drawing.refresh();
                  }
                }
              } catch (err) {
                console.error("Failed to auto-resize handout:", err);
              }
            } else if (noteType === "photo") {
              // Update photo note image immediately (no resize) - collaborative
              await collaborativeUpdate(this.document.id, {
                [`flags.${MODULE_ID}.image`]: path
              });

              // Refresh the drawing on canvas
              const drawing = canvas.drawings.get(this.document.id);
              if (drawing) {
                await drawing.refresh();
              }
            }
          }
        }).render(true);
      });
    }

    // Handle color selection
    this.element.querySelectorAll(".color-option").forEach(opt => {
      opt.addEventListener("click", async (ev) => {
        ev.preventDefault();
        const color = opt.dataset.color;
        const type = opt.dataset.type; // 'tint' or 'textColor'
        const hiddenInput = this.element.querySelector(`input[name='${type}']`);
        
        if (hiddenInput) {
          hiddenInput.value = color;
          
          // Update UI
          opt.parentElement.querySelectorAll(".color-option").forEach(o => o.classList.remove("active"));
          opt.classList.add("active");

          // Real-time update (collaborative)
          await collaborativeUpdate(this.document.id, {
            [`flags.${MODULE_ID}.${type}`]: color
          });

          // Refresh the drawing on canvas
          const drawing = canvas.drawings.get(this.document.id);
          if (drawing) {
            await drawing.refresh();
          }
        }
      });
    });

    const form = this.element.querySelector("form");
    if (form) {
      // Handle cancel button
      const cancelButton = this.element.querySelector(".cancel-button");
      if (cancelButton) {
        cancelButton.addEventListener("click", (ev) => {
          ev.preventDefault();
          this.close();
        });
      }

      // Handle remove connection buttons
      const removeButtons = this.element.querySelectorAll(".remove-connection-btn");
      removeButtons.forEach(btn => {
        btn.addEventListener("click", async (ev) => {
          ev.preventDefault();
          const index = parseInt(btn.dataset.index);
          const connections = this.document.flags[MODULE_ID]?.connections || [];
          connections.splice(index, 1);

          // Use collaborative update to remove connections (works for all users)
          await collaborativeUpdate(this.document.id, {
            [`flags.${MODULE_ID}.connections`]: connections
          });

          // Redraw connection lines
          drawAllConnectionLines();

          // Re-render the sheet to update the UI
          this.render(true);
        });
      });

      form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();

        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());

        // Update the document flags
        const noteType = this.document.flags[MODULE_ID]?.type;
        const updates = {};

        // Only save text for notes that have text fields
        if (noteType !== "handout" && noteType !== "media" && noteType !== "pin") {
          updates[`flags.${MODULE_ID}.text`] = data.text || "";
        }

        // Save image for photo and handout notes
        if (noteType === "photo" || noteType === "handout") {
          updates[`flags.${MODULE_ID}.image`] = data.image || (noteType === "handout" ? "modules/investigation-board/assets/newhandout.webp" : "modules/investigation-board/assets/placeholder.webp");
        }

        if (noteType === "media") {
          const prevMode = this.document.flags[MODULE_ID]?.mediaMode
            ?? (!!this.document.flags[MODULE_ID]?.videoPath ? "video" : "audio");
          const newMode = data.mediaMode || "audio";
          const modeChanged = prevMode !== newMode;

          updates[`flags.${MODULE_ID}.mediaMode`] = newMode;

          if (newMode === "video") {
            updates[`flags.${MODULE_ID}.videoPath`] = data.videoPath || "";
            updates[`flags.${MODULE_ID}.audioPath`] = "";
            updates[`flags.${MODULE_ID}.videoFormat`] = data.videoFormat || "crt";
            updates[`flags.${MODULE_ID}.videoEffects`] = {
              rollingShutter:      !!data["videoEffects.rollingShutter"],
              mechanicalSound:     !!data["videoEffects.mechanicalSound"],
              trackingGlitch:      !!data["videoEffects.trackingGlitch"],
              filmGrain:           !!data["videoEffects.filmGrain"],
              filmGrainIntensity:  parseFloat(data["videoEffects.filmGrainIntensity"]) || 0.15,
              glitchIntervalMin:   Math.max(1, parseInt(data["videoEffects.glitchIntervalMin"]) || 8),
              glitchIntervalMax:   Math.max(1, parseInt(data["videoEffects.glitchIntervalMax"]) || 20),
              timestampEnabled:    !!data["videoEffects.timestampEnabled"],
              recordingStartISO:   data["videoEffects.recordingStartISO"] || "",
              recordingStartCenti: Math.min(99, Math.max(0, parseInt(data["videoEffects.recordingStartCenti"]) || 0)),
              timestampDateFormat: data["videoEffects.timestampDateFormat"] || "us",
              timestampX:          parseFloat(data["videoEffects.timestampX"])        || 0,
              timestampY:          parseFloat(data["videoEffects.timestampY"])        ?? -1,
              timestampFontSize:   parseInt(data["videoEffects.timestampFontSize"])   || 13,
              timestampColor:      data["videoEffects.timestampColor"]               || "#00e040",
            };
            // Only swap canvas sprite on mode change — the radio change handler
            // already handles immediate updates, but this covers Save-without-toggle.
            if (modeChanged) {
              const w = this.document.shape.width || 400;
              updates[`flags.${MODULE_ID}.image`] = getRandomVideoImage();
              updates["shape.height"] = Math.round(w * 0.571);
            }
          } else {
            updates[`flags.${MODULE_ID}.audioPath`] = data.audioPath || "";
            updates[`flags.${MODULE_ID}.videoPath`] = "";
            updates[`flags.${MODULE_ID}.audioEffectEnabled`] = !!data.audioEffectEnabled;
            if (modeChanged) {
              const w = this.document.shape.width || 400;
              updates[`flags.${MODULE_ID}.image`] = getRandomCassetteImage();
              updates["shape.height"] = Math.round(w * 0.74);
            }
          }
        }

        if (data.linkedObject !== undefined) {
          updates[`flags.${MODULE_ID}.linkedObject`] = data.linkedObject;
        }

        // Save font and fontSize to note flags (skip for handouts, media, and pins)
        if (noteType !== "handout" && noteType !== "media" && noteType !== "pin") {
          if (data.font !== undefined) {
            updates[`flags.${MODULE_ID}.font`] = data.font;
          }

          if (data.fontSize !== undefined) {
            updates[`flags.${MODULE_ID}.fontSize`] = parseInt(data.fontSize);
          }
        }

        if (data.tint !== undefined) {
          updates[`flags.${MODULE_ID}.tint`] = data.tint;
        }

        if (data.textColor !== undefined) {
          updates[`flags.${MODULE_ID}.textColor`] = data.textColor;
        }

        // Save per-note pin image choice (all note types)
        // "" means "auto" — cleared flag triggers a new random pick on next render
        if (data.pinColor !== undefined) {
          updates[`flags.${MODULE_ID}.pinColor`] = data.pinColor;
        }

        // Process connection color changes
        const connections = this.document.flags[MODULE_ID]?.connections || [];
        connections.forEach((conn, index) => {
          const colorKey = `connection-color-${index}`;
          if (data[colorKey]) {
            conn.color = data[colorKey];
          }
        });

        if (connections.length > 0) {
          updates[`flags.${MODULE_ID}.connections`] = connections;
        }

        // Use collaborative update to save all changes (works for all users)
        await collaborativeUpdate(this.document.id, updates);

        // Refresh the drawing on canvas
        const drawing = canvas.drawings.get(this.document.id);
        if (drawing) {
          await drawing.refresh();
        }

        // Redraw connection lines with new colors
        drawAllConnectionLines();

        // Close the sheet
        await this.close();
      }, true);
    }
  }

  // Stop animation when dialog closes
  async _onClose(options) {
    if (this.previewSound) {
      this.previewSound.stop();
      this.previewSound = null;
    }
    stopConnectionAnimation();
    clearConnectionNumbers();
    return super._onClose?.(options);
  }

  // V1 fallback - not used in v13, event binding done in _onRender
  activateListeners(html) {
    super.activateListeners(html);
  }
}
