import { MODULE_ID, PIN_COLORS, STICKY_TINTS, INK_COLORS } from "../config.js";
import { collaborativeUpdate } from "../utils/socket-handler.js";
import { applyTapeEffectToSound } from "../utils/audio-utils.js";
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

    // Enrich the linked object for display
    context.enrichedLinkedObject = context.linkedObject ? await TextEditor.enrichHTML(context.linkedObject, { async: true }) : "";

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

    const data = {
      document: this.document,
      noteType: noteType,
      text: this.document.flags[MODULE_ID]?.text || "Default Text",
      audioPath: this.document.flags[MODULE_ID]?.audioPath || "",
      audioEffectEnabled: this.document.flags[MODULE_ID]?.audioEffectEnabled !== false, // Default to true
      linkedObject: this.document.flags[MODULE_ID]?.linkedObject || "",
      image: this.document.flags[MODULE_ID]?.image || (noteType === "handout" ? "modules/investigation-board/assets/newhandout.webp" : "modules/investigation-board/assets/placeholder.webp"),
      font: this.document.flags[MODULE_ID]?.font || game.settings.get(MODULE_ID, "font"),
      fontSize: this.document.flags[MODULE_ID]?.fontSize || defaultFontSize,
      tint: this.document.flags[MODULE_ID]?.tint || "#ffffff",
      textColor: this.document.flags[MODULE_ID]?.textColor || "#000000",
      stickyTints: STICKY_TINTS,
      inkColors: INK_COLORS,
      connections: formattedConnections,
      noteTypes: {
        sticky: "Sticky Note",
        photo: "Photo Note",
        index: "Index Card",
        handout: "Handout"
      }
    };
    return data;
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

        if (data.audioPath !== undefined) {
          updates[`flags.${MODULE_ID}.audioPath`] = data.audioPath;
        }

        if (noteType === "media") {
          updates[`flags.${MODULE_ID}.audioEffectEnabled`] = !!data.audioEffectEnabled;
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
