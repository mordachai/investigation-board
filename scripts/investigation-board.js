//investigation-boards.js

import { registerSettings } from "./settings.js";
// HUD disabled - double-click to edit instead
// import { InvestigationBoardHUD } from "./investigation-board-hud.js";

const MODULE_ID = "investigation-board";
const BASE_FONT_SIZE = 15;
const PIN_COLORS = ["redPin.webp", "bluePin.webp", "yellowPin.webp", "greenPin.webp"];

// Pin-click connection state variables
let pinConnectionFirstNote = null;
let pinConnectionHighlight = null; // PIXI.Graphics for border
let connectionPreviewLine = null; // PIXI.Graphics for live preview line
let connectionLinesContainer = null; // Global container for all connection lines
let pinsContainer = null; // Global container for all pins (to render on top)

// Investigation Board Mode state variables
let investigationBoardModeActive = false;
let originalDrawingMethods = {}; // Store original layer methods for restoration
// let investigationBoardHUD = null; // HUD disabled - double-click to edit instead

// Connection animation state
let activeEditingDrawingId = null; // Which drawing's edit dialog is open
let animationTickerId = null; // Ticker for animating connection lines

// Connection number overlays
let connectionNumberOverlays = []; // Array of PIXI.Text objects showing connection numbers

// Socket for collaborative editing
let socket = null;
const SOCKET_NAME = `module.${MODULE_ID}`;

// v13 namespaced imports
const Drawing = foundry.canvas.placeables.Drawing;
const DrawingConfig = foundry.applications.sheets.DrawingConfig;
const DrawingDocument = foundry.documents.DrawingDocument;
const DocumentSheetConfig = foundry.applications.apps.DocumentSheetConfig;
const FilePicker = foundry.applications.apps.FilePicker.implementation;

function getBaseCharacterLimits() {
  return game.settings.get(MODULE_ID, "baseCharacterLimits") || {
    sticky: 60,
    photo: 15,
    index: 200,
  };
}

function getDynamicCharacterLimits(noteType, currentFontSize) {
  const baseLimits = getBaseCharacterLimits();
  const scaleFactor = BASE_FONT_SIZE / currentFontSize;
  const limits = baseLimits[noteType] || { sticky: 60, photo: 15, index: 200 };
  return {
    sticky: Math.round(limits.sticky * scaleFactor),
    photo: Math.round(limits.photo * scaleFactor),
    index: Math.round(limits.index * scaleFactor),
  };
}

/**
 * Helper to resolve actor display name based on characterNameKey setting.
 */
function getActorDisplayName(actor) {
  const keyPath = game.settings.get(MODULE_ID, "characterNameKey") || "prototypeToken.name";

  // Navigate the key path (e.g., "prototypeToken.name" or "system.alias")
  const keys = keyPath.split(".");
  let value = actor;
  for (const key of keys) {
    value = value?.[key];
    if (value === undefined) break;
  }

  // Fallback to actor name if path doesn't resolve
  return value || actor.name || "Unknown";
}

/**
 * Updates a drawing document, using socket communication if the user doesn't have permission.
 * This enables collaborative editing where any user can modify any investigation board note.
 * @param {string} drawingId - The ID of the drawing to update
 * @param {object} updateData - The update data to apply
 * @param {string} sceneId - Optional scene ID (defaults to current scene)
 * @returns {Promise<void>}
 */
async function collaborativeUpdate(drawingId, updateData, sceneId = null) {
  const scene = sceneId ? game.scenes.get(sceneId) : canvas.scene;
  if (!scene) {
    console.error("Investigation Board: No scene found for collaborative update");
    return;
  }

  const drawing = scene.drawings.get(drawingId);
  if (!drawing) {
    console.error("Investigation Board: Drawing not found for collaborative update", drawingId);
    return;
  }

  // Check if the drawing is an investigation board note
  const noteData = drawing.flags?.[MODULE_ID];
  if (!noteData) {
    console.warn("Investigation Board: Not an investigation board note, skipping collaborative update");
    return;
  }

  // If user is GM or has owner permission, update directly
  if (game.user.isGM || drawing.testUserPermission(game.user, "OWNER")) {
    await drawing.update(updateData);
    return;
  }

  // Otherwise, request update via socket (GM will perform it)
  if (socket) {
    socket.emit(SOCKET_NAME, {
      action: "updateDrawing",
      sceneId: scene.id,
      drawingId: drawingId,
      updateData: updateData,
      requestingUser: game.user.id
    });
    console.log("Investigation Board: Sent socket request to update drawing", drawingId);
  } else {
    console.error("Investigation Board: Socket not available for collaborative update");
  }
}

/**
 * Handles incoming socket messages for collaborative updates.
 * Only GM clients process these requests.
 */
function handleSocketMessage(data) {
  // Only GM processes socket requests
  if (!game.user.isGM) return;

  if (data.action === "updateDrawing") {
    const scene = game.scenes.get(data.sceneId);
    if (!scene) {
      console.error("Investigation Board: Scene not found for socket update", data.sceneId);
      return;
    }

    const drawing = scene.drawings.get(data.drawingId);
    if (!drawing) {
      console.error("Investigation Board: Drawing not found for socket update", data.drawingId);
      return;
    }

    // Verify this is an investigation board note
    const noteData = drawing.flags?.[MODULE_ID];
    if (!noteData) {
      console.warn("Investigation Board: Socket update rejected - not an investigation board note");
      return;
    }

    // Perform the update on behalf of the requesting user
    console.log("Investigation Board: GM processing socket update for drawing", data.drawingId, "requested by", data.requestingUser);
    drawing.update(data.updateData);
  }
}


class CustomDrawingSheet extends DrawingConfig {
  constructor(...args) {
    super(...args);
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
    context.identityName = customData.identityName;
    context.boardMode = customData.boardMode;
    context.noteTypes = customData.noteTypes;
    context.connections = customData.connections;
    context.font = customData.font;
    context.fontSize = customData.fontSize;

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
          const typeLabels = { sticky: "Sticky Note", photo: "Photo Note", index: "Index Card", handout: "Handout" };
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
      image: this.document.flags[MODULE_ID]?.image || (noteType === "handout" ? "modules/investigation-board/assets/newhandout.webp" : "modules/investigation-board/assets/placeholder.webp"),
      identityName: this.document.flags[MODULE_ID]?.identityName || "",
      font: this.document.flags[MODULE_ID]?.font || game.settings.get(MODULE_ID, "font"),
      fontSize: this.document.flags[MODULE_ID]?.fontSize || defaultFontSize,
      boardMode: game.settings.get(MODULE_ID, "boardMode"),
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

                  // Apply 1000px height cap
                  if (targetHeight > 1000) {
                    const scale = 1000 / targetHeight;
                    targetWidth = Math.round(targetWidth * scale);
                    targetHeight = 1000;
                  }

                  // Apply 2000px width cap
                  if (targetWidth > 2000) {
                    const scale = 2000 / targetWidth;
                    targetHeight = Math.round(targetHeight * scale);
                    targetWidth = 2000;
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
        }).browse();
      });
    }

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

        // Only save text for non-handout notes
        if (noteType !== "handout") {
          updates[`flags.${MODULE_ID}.text`] = data.text || "";
        }

        // Save image for photo and handout notes
        if (noteType === "photo" || noteType === "handout") {
          updates[`flags.${MODULE_ID}.image`] = data.image || (noteType === "handout" ? "modules/investigation-board/assets/newhandout.webp" : "modules/investigation-board/assets/placeholder.webp");
        }

        if (data.identityName !== undefined) {
          updates[`flags.${MODULE_ID}.identityName`] = data.identityName;
        }

        // Save font and fontSize to note flags (skip for handouts)
        if (noteType !== "handout") {
          if (data.font !== undefined) {
            updates[`flags.${MODULE_ID}.font`] = data.font;
          }

          if (data.fontSize !== undefined) {
            updates[`flags.${MODULE_ID}.fontSize`] = parseInt(data.fontSize);
          }
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
    stopConnectionAnimation();
    clearConnectionNumbers();
    return super._onClose?.(options);
  }

  // V1 fallback - not used in v13, event binding done in _onRender
  activateListeners(html) {
    super.activateListeners(html);
  }


}

class CustomDrawing extends Drawing {
  constructor(...args) {
    super(...args);
    this.bgSprite = null;
    this.pinSprite = null;
    this.noteText = null;
    this.photoImageSprite = null;
    this.photoMask = null;
    this.identityNameText = null;
    this.futuristicText = null;
  }

  /**
   * Override _canControl to allow all users to select investigation board notes.
   * This enables collaborative selection regardless of who created the note.
   */
  _canControl(user, event) {
    // Check if this is an investigation board note
    const noteData = this.document.flags?.[MODULE_ID];
    if (noteData?.type) {
      // Allow all users to control investigation board notes
      return true;
    }
    // Fall back to default behavior for regular drawings
    return super._canControl(user, event);
  }

  /**
   * Override _canDrag to allow all users to drag investigation board notes.
   * This enables collaborative movement regardless of who created the note.
   */
  _canDrag(user, event) {
    // Check if this is an investigation board note
    const noteData = this.document.flags?.[MODULE_ID];
    if (noteData?.type) {
      // Allow all users to drag investigation board notes (unless locked)
      return !this.document.locked;
    }
    // Fall back to default behavior for regular drawings
    return super._canDrag(user, event);
  }

  /**
   * Override _canView to allow all users to view/edit investigation board notes.
   * This enables opening the edit dialog regardless of who created the note.
   */
  _canView(user, event) {
    // Check if this is an investigation board note
    const noteData = this.document.flags?.[MODULE_ID];
    if (noteData?.type) {
      // Allow all users to view investigation board notes
      return true;
    }
    // Fall back to default behavior for regular drawings
    return super._canView?.(user, event) ?? true;
  }

  // Ensure sprites are created when the drawing is first rendered.
  async draw() {
    await super.draw();
    // Mark as investigation board note for CSS filtering
    this.element?.setAttribute("data-investigation-note", "true");
    await this._updateSprites();
    // Redraw all connections and reposition pins globally
    drawAllConnectionLines();
    return this;
  }

  // Ensure sprites update correctly on refresh.
  async refresh() {
    await super.refresh();
    // Mark as investigation board note for CSS filtering
    this.element?.setAttribute("data-investigation-note", "true");
    await this._updateSprites();
    // Redraw all connections and reposition pins globally
    drawAllConnectionLines();
    return this;
  }

  async _updateSprites() {
    const noteData = this.document.flags[MODULE_ID];
    if (!noteData) return;

    const isPhoto = noteData.type === "photo";
    const isIndex = noteData.type === "index";
    const isHandout = noteData.type === "handout";
    const mode = game.settings.get(MODULE_ID, "boardMode");

    // HANDOUT NOTE LAYOUT (Image-only, transparent background)
    if (isHandout) {
      const drawingWidth = this.document.shape.width || 400;
      const drawingHeight = this.document.shape.height || 400;

      // No background sprite for handouts (transparent)
      if (this.bgSprite) {
        this.removeChild(this.bgSprite);
        this.bgSprite.destroy();
        this.bgSprite = null;
      }

      // --- User Image (primary content) ---
      // Check if sprite exists and has a valid parent, recreate if orphaned
      if (!this.photoImageSprite || !this.photoImageSprite.parent) {
        // Destroy old sprite if it exists
        if (this.photoImageSprite) {
          this.photoImageSprite.destroy();
        }
        this.photoImageSprite = new PIXI.Sprite();
        this.addChild(this.photoImageSprite);
      }

      const imagePath = noteData.image || "modules/investigation-board/assets/newhandout.webp";
      try {
        const texture = await PIXI.Assets.load(imagePath);
        if (texture && this.photoImageSprite && this.photoImageSprite.parent) {
          this.photoImageSprite.texture = texture;

          // Scale image to fit drawing bounds while maintaining aspect ratio
          const textureRatio = texture.width / texture.height;
          const drawingRatio = drawingWidth / drawingHeight;

          if (textureRatio > drawingRatio) {
            // Image is wider - fit to width
            this.photoImageSprite.width = drawingWidth;
            this.photoImageSprite.height = drawingWidth / textureRatio;
          } else {
            // Image is taller - fit to height
            this.photoImageSprite.height = drawingHeight;
            this.photoImageSprite.width = drawingHeight * textureRatio;
          }

          // Center the image within the drawing bounds
          this.photoImageSprite.position.set(
            (drawingWidth - this.photoImageSprite.width) / 2,
            (drawingHeight - this.photoImageSprite.height) / 2
          );

          // Ensure mask is disabled for handouts
          this.photoImageSprite.mask = null;
          if (this.photoMask) this.photoMask.visible = false;

          // Ensure sprite is visible and has correct properties
          this.photoImageSprite.visible = true;
          this.photoImageSprite.alpha = 1;
          this.photoImageSprite.renderable = true;
        }
      } catch (err) {
        console.error(`Failed to load handout image: ${imagePath}`, err);
        if (this.photoImageSprite) {
          this.photoImageSprite.texture = PIXI.Texture.EMPTY;
        }
      }

      // --- Pin Sprite ---
      const pinSetting = game.settings.get(MODULE_ID, "pinColor");
      if (pinSetting === "none") {
        if (this.pinSprite) {
          this.removeChild(this.pinSprite);
          this.pinSprite.destroy();
          this.pinSprite = null;
        }
      } else {
        // Check if sprite exists and has a valid parent, recreate if orphaned
        if (!this.pinSprite || !this.pinSprite.parent) {
          // Destroy old sprite if it exists
          if (this.pinSprite) {
            this.pinSprite.destroy();
          }
          this.pinSprite = new PIXI.Sprite();
          this.addChild(this.pinSprite);
        }

        let pinColor = noteData.pinColor;
        if (!pinColor) {
          pinColor = (pinSetting === "random")
            ? PIN_COLORS[Math.floor(Math.random() * PIN_COLORS.length)]
            : `${pinSetting}Pin.webp`;
          // Use collaborative update to save pin color (works for all users)
          await collaborativeUpdate(this.document.id, { [`flags.${MODULE_ID}.pinColor`]: pinColor });
        }

        const pinImage = `modules/investigation-board/assets/${pinColor}`;
        try {
          const texture = await PIXI.Assets.load(pinImage);
          if (texture && this.pinSprite && this.pinSprite.parent) {
            this.pinSprite.texture = texture;
            this.pinSprite.width = 40;
            this.pinSprite.height = 40;
            // Position at 5% from top, centered horizontally
            this.pinSprite.position.set(
              drawingWidth / 2 - 20,
              drawingHeight * 0.05
            );

            // Make pin interactive for connections
            this.pinSprite.eventMode = 'static';
            this.pinSprite.cursor = 'pointer';
            this.pinSprite.on('click', (event) => {
              event.stopPropagation();
              handlePinClick(this);
            });
          }
        } catch (err) {
          console.error(`Failed to load pin texture: ${pinImage}`, err);
          if (this.pinSprite) {
            this.pinSprite.texture = PIXI.Texture.EMPTY;
          }
        }
      }

      // Hide text sprites (handouts don't have text)
      if (this.noteText) {
        this.noteText.visible = false;
      }
      if (this.identityNameText) {
        this.identityNameText.visible = false;
      }
      if (this.futuristicText) {
        this.futuristicText.visible = false;
      }

      // Ensure the drawing itself is visible for handouts
      this.visible = true;
      this.alpha = 1;
      this.renderable = true;

      // Force PIXI render update by multiple methods
      this.transform.updateTransform(this.parent.transform);

      // Mark all children as needing update
      if (this.photoImageSprite) {
        this.photoImageSprite.updateTransform();
      }
      if (this.pinSprite) {
        this.pinSprite.updateTransform();
      }

      // Force canvas render on next frame
      requestAnimationFrame(() => {
        if (canvas?.app?.renderer) {
          canvas.app.renderer.render(canvas.stage);
        }
      });

      return; // Early exit for handout notes
    }

    // FUTURISTIC PHOTO NOTE LAYOUT
    if (isPhoto && mode === "futuristic") {
      const fullWidth = game.settings.get(MODULE_ID, "photoNoteWidth");
      const margin = 10;
      const photoImgWidth = fullWidth * 0.4;
      const photoImgHeight = photoImgWidth * (4 / 3);
      const textAreaX = margin + photoImgWidth + margin;
      const fullHeight = photoImgHeight + margin * 2;
    
      // --- Background Frame ---
      if (!this.bgSprite) {
        this.bgSprite = new PIXI.Sprite();
        this.addChildAt(this.bgSprite, 0);
      }
      try {
        const texture = await PIXI.Assets.load("modules/investigation-board/assets/photoFrame.webp");
        if (texture && this.bgSprite) {
          this.bgSprite.texture = texture;
          this.bgSprite.width = fullWidth;
          this.bgSprite.height = fullHeight;
        }
      } catch (err) {
        console.error("Failed to load photo frame texture", err);
        if (this.bgSprite) {
          this.bgSprite.texture = PIXI.Texture.EMPTY;
        }
      }

      // --- Foreground (User-Assigned) Photo ---
      if (!this.photoImageSprite) {
        this.photoImageSprite = new PIXI.Sprite();
        this.addChild(this.photoImageSprite);
      }
      try {
        const imagePath = noteData.image || "modules/investigation-board/assets/placeholder.webp";
        const texture = await PIXI.Assets.load(imagePath);
        if (texture && this.photoImageSprite) {
          this.photoImageSprite.texture = texture;
          this.photoImageSprite.width = fullWidth * 0.9;
          this.photoImageSprite.height = fullHeight * 0.9;
          this.photoImageSprite.position.set(fullWidth * 0.05, fullHeight * 0.05);
          
          // Ensure mask is disabled for futuristic mode
          this.photoImageSprite.mask = null;
          if (this.photoMask) this.photoMask.visible = false;
        }
      } catch (err) {
        console.error(`Failed to load user photo: ${noteData.image}`, err);
        if (this.photoImageSprite) {
          this.photoImageSprite.texture = PIXI.Texture.EMPTY;
        }
      }

      // --- Identity Name and Additional Text (Futuristic) ---
      const font = noteData.font || game.settings.get(MODULE_ID, "font");
      const baseFontSize = noteData.fontSize || game.settings.get(MODULE_ID, "baseFontSize");
      const fontSize = (fullWidth / 200) * baseFontSize;
      const textStyle = new PIXI.TextStyle({
        fontFamily: font,
        fontSize: fontSize,
        fill: "#000000",
        wordWrap: true,
        wordWrapWidth: fullWidth - textAreaX - margin,
        align: "left",
      });
      if (!this.identityNameText) {
        this.identityNameText = new PIXI.Text("", textStyle);
        this.addChild(this.identityNameText);
      }
      this.identityNameText.text = noteData.identityName || "Name";
      this.identityNameText.style = textStyle;
      this.identityNameText.position.set(textAreaX, margin);
    
      if (!this.futuristicText) {
        this.futuristicText = new PIXI.Text("", textStyle);
        this.addChild(this.futuristicText);
      }
      this.futuristicText.text = noteData.text || "";
      this.futuristicText.style = textStyle;
      this.futuristicText.position.set(textAreaX, margin + this.identityNameText.height + 5);
    
      // Remove default note text if present.
      if (this.noteText) {
        this.removeChild(this.noteText);
        this.noteText.destroy();
        this.noteText = null;
      }
    
      // --- Pin Handling (Futuristic) ---
      const pinSetting = game.settings.get(MODULE_ID, "pinColor");
      if (pinSetting === "none") {
        if (this.pinSprite) {
          this.removeChild(this.pinSprite);
          this.pinSprite.destroy();
          this.pinSprite = null;
        }
      } else {
        if (!this.pinSprite) {
          this.pinSprite = new PIXI.Sprite();
          this.addChild(this.pinSprite);
        }
        let pinColor = noteData.pinColor;
        if (!pinColor) {
          pinColor = (pinSetting === "random")
            ? PIN_COLORS[Math.floor(Math.random() * PIN_COLORS.length)]
            : `${pinSetting}Pin.webp`;
          // Use collaborative update to save pin color (works for all users)
          await collaborativeUpdate(this.document.id, { [`flags.${MODULE_ID}.pinColor`]: pinColor });
        }
        const pinImage = `modules/investigation-board/assets/${pinColor}`;
        try {
          const texture = await PIXI.Assets.load(pinImage);
          if (texture && this.pinSprite) {
            this.pinSprite.texture = texture;
            this.pinSprite.width = 40;
            this.pinSprite.height = 40;
            this.pinSprite.position.set(fullWidth / 2 - 20, 3);
          }
        } catch (err) {
          console.error(`Failed to load pin texture: ${pinImage}`, err);
          if (this.pinSprite) {
            this.pinSprite.texture = PIXI.Texture.EMPTY;
          }
        }
      }
      return; // End early for futuristic photo notes.
    }
    
    // STANDARD LAYOUT (Modern photo notes, sticky, index, etc.)
    const width = isPhoto
      ? game.settings.get(MODULE_ID, "photoNoteWidth")
      : isIndex
        ? game.settings.get(MODULE_ID, "indexNoteWidth") || 600
        : game.settings.get(MODULE_ID, "stickyNoteWidth");
    
    const height = isPhoto
      ? Math.round(width / (225 / 290))
      : isIndex
        ? Math.round(width / (600 / 400))
        : width;
    
    // Background Image based on board mode.
    const getBackgroundImage = (noteType, mode) => {
      if (mode === "futuristic") {
        if (noteType === "photo") return "modules/investigation-board/assets/futuristic_photoFrame.webp";
        if (noteType === "index") return "modules/investigation-board/assets/futuristic_note_index.webp";
        return "modules/investigation-board/assets/futuristic_note_white.webp";
      } else if (mode === "custom") {
        if (noteType === "photo") return "modules/investigation-board/assets/custom_photoFrame.webp";
        if (noteType === "index") return "modules/investigation-board/assets/custom_note_index.webp";
        return "modules/investigation-board/assets/custom_note_white.webp";
      }
      // Default "modern" mode:
      if (noteType === "photo") return "modules/investigation-board/assets/photoFrame.webp";
      if (noteType === "index") return "modules/investigation-board/assets/note_index.webp";
      return "modules/investigation-board/assets/note_white.webp";
    };
    const bgImage = getBackgroundImage(noteData.type, mode);
    
    if (!this.bgSprite) {
      this.bgSprite = new PIXI.Sprite();
      this.addChild(this.bgSprite);
    }
    try {
      const texture = await PIXI.Assets.load(bgImage);
      if (texture && this.bgSprite) {
        this.bgSprite.texture = texture;
        this.bgSprite.width = width;
        this.bgSprite.height = height;
      }
    } catch (err) {
      console.error(`Failed to load background texture: ${bgImage}`, err);
      if (this.bgSprite) {
        this.bgSprite.texture = PIXI.Texture.EMPTY;
      }
    }
    
    // --- Foreground (User-Assigned) Photo for Modern Mode ---
    if (isPhoto) {
      const fgImage = noteData.image || "modules/investigation-board/assets/placeholder.webp";
      if (!this.photoImageSprite) {
        this.photoImageSprite = new PIXI.Sprite();
        this.addChild(this.photoImageSprite);
      }
      try {
        const texture = await PIXI.Assets.load(fgImage);
        if (texture && this.photoImageSprite) {
          this.photoImageSprite.texture = texture;
          
          // Calculate available frame space inside the polaroid
          const widthOffset = width * 0.13333;
          const heightOffset = height * 0.30246;
          const frameWidth = width - widthOffset;
          const frameHeight = height - heightOffset;

          // Use center-top positioning logic
          const textureRatio = texture.width / texture.height;
          const frameRatio = frameWidth / frameHeight;

          let spriteWidth, spriteHeight, offsetX, offsetY;

          if (textureRatio > frameRatio) {
            // Case 1: Image is wider than frame
            // Fit by height, center horizontally
            spriteHeight = frameHeight;
            spriteWidth = frameHeight * textureRatio;
            offsetX = (frameWidth - spriteWidth) / 2; // Center horizontally
            offsetY = 0; // Top aligned
          } else {
            // Case 2: Image is taller than frame (Standard Portrait)
            // Fit by width, crop from bottom
            spriteWidth = frameWidth;
            spriteHeight = frameWidth / textureRatio;
            offsetX = 0; 
            offsetY = 0; // Top aligned - KEEPS HEAD VISIBLE
          }

          // Apply size and position
          this.photoImageSprite.width = spriteWidth;
          this.photoImageSprite.height = spriteHeight;
          this.photoImageSprite.position.set(widthOffset / 2 + offsetX, heightOffset / 2 + offsetY);

          // Apply Mask to clip overflow
          if (!this.photoMask) {
            this.photoMask = new PIXI.Graphics();
            this.addChild(this.photoMask);
          }
          this.photoMask.clear();
          this.photoMask.beginFill(0xffffff);
          this.photoMask.drawRect(widthOffset / 2, heightOffset / 2, frameWidth, frameHeight);
          this.photoMask.endFill();
          this.photoImageSprite.mask = this.photoMask;
          this.photoMask.visible = true;
          this.photoImageSprite.visible = true;
        }
      } catch (err) {
        console.error(`Failed to load foreground texture: ${fgImage}`, err);
        if (this.photoImageSprite) {
          this.photoImageSprite.texture = PIXI.Texture.EMPTY;
        }
      }
    } else if (this.photoImageSprite) {
      this.photoImageSprite.visible = false;
      if (this.photoMask) this.photoMask.visible = false;
    }
    
    // --- Pin Handling (Standard) ---
    {
      const pinSetting = game.settings.get(MODULE_ID, "pinColor");
      if (pinSetting === "none") {
        if (this.pinSprite) {
          this.removeChild(this.pinSprite);
          this.pinSprite.destroy();
          this.pinSprite = null;
        }
      } else {
        if (!this.pinSprite) {
          this.pinSprite = new PIXI.Sprite();
          this.addChild(this.pinSprite);
        }
        let pinColor = noteData.pinColor;
        if (!pinColor) {
          pinColor = (pinSetting === "random")
            ? PIN_COLORS[Math.floor(Math.random() * PIN_COLORS.length)]
            : `${pinSetting}Pin.webp`;
          // Use collaborative update to save pin color (works for all users)
          await collaborativeUpdate(this.document.id, { [`flags.${MODULE_ID}.pinColor`]: pinColor });
        }
        const pinImage = `modules/investigation-board/assets/${pinColor}`;
        try {
          const texture = await PIXI.Assets.load(pinImage);
          if (texture && this.pinSprite) {
            this.pinSprite.texture = texture;
            this.pinSprite.width = 40;
            this.pinSprite.height = 40;
            this.pinSprite.position.set(width / 2 - 20, 3);
          }
        } catch (err) {
          console.error(`Failed to load pin texture: ${pinImage}`, err);
          if (this.pinSprite) {
            this.pinSprite.texture = PIXI.Texture.EMPTY;
          }
        }
      }
    }

    // Default text layout for non-futuristic notes.
    const font = noteData.font || game.settings.get(MODULE_ID, "font");
    const defaultFontSize = isIndex ? 9 : game.settings.get(MODULE_ID, "baseFontSize");
    const baseFontSize = noteData.fontSize || defaultFontSize;
    const fontSize = (width / 200) * baseFontSize;
    const textStyle = new PIXI.TextStyle({
      fontFamily: font,
      fontSize: fontSize,
      fill: "#000000",
      wordWrap: true,
      wordWrapWidth: width - 15,
      align: "center",
    });
    const truncatedText = this._truncateText(noteData.text || "Default Text", font, noteData.type, fontSize);
    if (!this.noteText) {
      this.noteText = new PIXI.Text(truncatedText, textStyle);
      this.noteText.anchor.set(0.5);
      this.addChild(this.noteText);
    } else {
      this.noteText.style = textStyle;
      this.noteText.text = truncatedText;
    }
    this.noteText.position.set(width / 2, isPhoto ? height - 25 : height / 2);
  }
  
  
  

  _truncateText(text, font, noteType, currentFontSize) {
    const limits = getDynamicCharacterLimits(font, currentFontSize);
    const charLimit = limits[noteType] || 100;
    return text.length <= charLimit ? text : text.slice(0, charLimit).trim() + "...";
  }

  _getPinPosition() {
    const noteData = this.document.flags[MODULE_ID];
    if (!noteData) return { x: this.document.x, y: this.document.y };

    // Handout notes use dynamic positioning based on drawing height
    if (noteData.type === "handout") {
      const width = this.document.shape.width || 400;
      const height = this.document.shape.height || 400;
      return {
        x: this.document.x + width / 2,
        y: this.document.y + (height * 0.05) + 20  // 5% from top + half pin height
      };
    }

    const isPhoto = noteData.type === "photo";
    const isIndex = noteData.type === "index";

    // Get note width based on type
    let width;
    if (isPhoto) {
      width = game.settings.get(MODULE_ID, "photoNoteWidth");
    } else if (isIndex) {
      width = game.settings.get(MODULE_ID, "indexNoteWidth") || 600;
    } else {
      width = game.settings.get(MODULE_ID, "stickyNoteWidth");
    }

    // Pin center is at (width/2, 23) relative to drawing position
    return {
      x: this.document.x + width / 2,
      y: this.document.y + 23
    };
  }
}

// Global function to draw all connection lines and pins
function drawAllConnectionLines(animationOffset = 0) {
  if (!canvas || !canvas.drawings) return;

  // Enable sortable children on the drawings layer for z-index control
  canvas.drawings.sortableChildren = true;

  // Initialize containers
  if (!connectionLinesContainer) {
    connectionLinesContainer = new PIXI.Graphics();
    connectionLinesContainer.zIndex = 10; // Yarn in the middle
    canvas.drawings.addChild(connectionLinesContainer);
  } else {
    connectionLinesContainer.clear();
  }

  if (!pinsContainer) {
    pinsContainer = new PIXI.Container();
    pinsContainer.zIndex = 20; // Pins on top
    canvas.drawings.addChild(pinsContainer);
  } else {
    // Clear all pins
    pinsContainer.removeChildren();
  }

  // Set all investigation board drawings to base zIndex
  canvas.drawings.placeables.forEach(drawing => {
    const noteData = drawing.document.flags[MODULE_ID];
    if (noteData) {
      drawing.zIndex = 0; // Base level (backgrounds render here)

      // If drawing has a pin sprite, move it to the global pins container
      if (drawing.pinSprite) {
        // Remove from drawing if it's there
        if (drawing.pinSprite.parent === drawing) {
          drawing.removeChild(drawing.pinSprite);
        }

        // Position in world coordinates
        const noteData = drawing.document.flags[MODULE_ID];
        const isPhoto = noteData.type === "photo";
        const isIndex = noteData.type === "index";
        const isHandout = noteData.type === "handout";

        let width, pinY;
        if (isHandout) {
          // Handout notes use dynamic positioning based on drawing dimensions
          width = drawing.document.shape.width || 400;
          const height = drawing.document.shape.height || 400;
          pinY = drawing.document.y + (height * 0.05);
        } else {
          // Other note types use fixed positioning
          if (isPhoto) {
            width = game.settings.get(MODULE_ID, "photoNoteWidth");
          } else if (isIndex) {
            width = game.settings.get(MODULE_ID, "indexNoteWidth") || 600;
          } else {
            width = game.settings.get(MODULE_ID, "stickyNoteWidth");
          }
          pinY = drawing.document.y + 3;
        }

        drawing.pinSprite.x = drawing.document.x + width / 2 - 20;
        drawing.pinSprite.y = pinY;

        // Make pin interactive for connection creation
        drawing.pinSprite.eventMode = 'static';
        drawing.pinSprite.cursor = 'pointer';
        drawing.pinSprite.removeAllListeners(); // Clear old listeners
        drawing.pinSprite.on('click', (event) => onPinClick(event, drawing));

        // Add to global pins container
        pinsContainer.addChild(drawing.pinSprite);
      }
    }
  });

  // Draw all connections from all notes
  canvas.drawings.placeables.forEach(drawing => {
    const noteData = drawing.document.flags[MODULE_ID];
    if (!noteData) return;

    const connections = noteData.connections || [];
    if (connections.length === 0) return;

    // Check if this drawing's connections should be animated
    const shouldAnimate = activeEditingDrawingId === drawing.document.id;

    // Get source pin position
    const sourcePin = drawing._getPinPosition();

    // Draw each connection
    connections.forEach(conn => {
      const targetDrawing = canvas.drawings.get(conn.targetId);
      if (!targetDrawing) return;

      const targetNoteData = targetDrawing.document.flags[MODULE_ID];
      if (!targetNoteData) return;

      const targetPin = targetDrawing._getPinPosition();

      // Get line style
      const lineColor = conn.color || game.settings.get(MODULE_ID, "connectionLineColor") || "#FF0000";
      const lineWidth = conn.width || game.settings.get(MODULE_ID, "connectionLineWidth") || 6;
      const colorNum = parseInt(lineColor.replace("#", ""), 16);

      // Draw yarn line in world coordinates with animation if editing this note
      drawYarnLine(
        connectionLinesContainer,
        sourcePin.x,
        sourcePin.y,
        targetPin.x,
        targetPin.y,
        colorNum,
        lineWidth,
        shouldAnimate,
        animationOffset
      );
    });
  });
}

// Helper function to draw a yarn line
function drawYarnLine(graphics, x1, y1, x2, y2, color, width, animated = false, animationOffset = 0) {
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const distance = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
  const sagAmount = distance * 0.15;
  const dx = x2 - x1;
  const horizontalOffset = dx * 0.05;
  const ctrlX = midX + horizontalOffset;
  const ctrlY = midY + sagAmount;
  const seed = (Math.abs(x1) + Math.abs(y1) + Math.abs(x2) + Math.abs(y2)) % 100;
  const wobble = (seed / 100) * 20 - 10;

  if (animated) {
    // Draw HIGHLY VISIBLE animated dashed line with marching effect
    const dashLength = 30; // Longer dashes
    const gapLength = 20; // Longer gaps

    // Calculate points along the curve for dashed effect
    const steps = 100; // More points for smoother animation
    const points = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * (ctrlX + wobble) + t * t * x2;
      const y = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * ctrlY + t * t * y2;
      points.push({ x, y });
    }

    // Draw background solid line first (dimmed original)
    graphics.lineStyle(width, color, 0.3);
    graphics.moveTo(x1, y1);
    graphics.quadraticCurveTo(ctrlX + wobble, ctrlY, x2, y2);

    // Draw bright animated dashes on top
    let currentDistance = -animationOffset;
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      const segmentLength = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));

      const startDist = currentDistance;
      const endDist = currentDistance + segmentLength;

      // Determine if this segment should be drawn (in dash, not gap)
      const dashCycle = dashLength + gapLength;
      const startMod = ((startDist % dashCycle) + dashCycle) % dashCycle;
      const endMod = ((endDist % dashCycle) + dashCycle) % dashCycle;

      if (startMod < dashLength || endMod < dashLength || startMod > endMod) {
        // Draw thick bright dash with glow
        graphics.lineStyle(width * 2.5, 0xFFFFFF, 0.8); // White glow
        graphics.moveTo(p1.x, p1.y);
        graphics.lineTo(p2.x, p2.y);

        // Draw colored dash on top
        graphics.lineStyle(width * 2, color, 1); // Full opacity, thicker
        graphics.moveTo(p1.x, p1.y);
        graphics.lineTo(p2.x, p2.y);
      }

      currentDistance = endDist;
    }
  } else {
    // Draw solid yarn line (original code)
    graphics.lineStyle(width, color, 0.9);
    graphics.moveTo(x1, y1);
    graphics.quadraticCurveTo(ctrlX + wobble, ctrlY, x2, y2);

    graphics.lineStyle(Math.max(1, width - 1), color, 0.7);
    graphics.moveTo(x1 + 1, y1);
    graphics.quadraticCurveTo(ctrlX + wobble + 1, ctrlY, x2 + 1, y2);

    graphics.lineStyle(Math.max(1, width - 1), color, 0.6);
    graphics.moveTo(x1 - 1, y1);
    graphics.quadraticCurveTo(ctrlX + wobble - 1, ctrlY, x2 - 1, y2);
  }
}

// Start animating connection lines for a specific drawing
function startConnectionAnimation(drawingId) {
  activeEditingDrawingId = drawingId;

  if (animationTickerId) {
    canvas.app.ticker.remove(animationTickerId);
  }

  let offset = 0;
  animationTickerId = () => {
    offset += 4; // Faster animation speed (was 2)
    if (offset > 50) offset = 0; // Reset to create loop (matches dashLength + gapLength)
    drawAllConnectionLines(offset);
  };

  canvas.app.ticker.add(animationTickerId);
}

// Stop animating connection lines
function stopConnectionAnimation() {
  activeEditingDrawingId = null;

  if (animationTickerId) {
    canvas.app.ticker.remove(animationTickerId);
    animationTickerId = null;
  }

  // Redraw without animation
  drawAllConnectionLines();
}

// Show connection numbers on connected notes
function showConnectionNumbers(sourceDrawingId) {
  // Clear any existing overlays first
  clearConnectionNumbers();

  const sourceDrawing = canvas.drawings.get(sourceDrawingId);
  if (!sourceDrawing) return;

  const connections = sourceDrawing.document.flags[MODULE_ID]?.connections || [];

  connections.forEach((conn, index) => {
    const targetDrawing = canvas.drawings.get(conn.targetId);
    if (!targetDrawing) return;

    const noteData = targetDrawing.document.flags[MODULE_ID];
    if (!noteData) return;

    // Get note dimensions
    const isPhoto = noteData.type === "photo";
    const isIndex = noteData.type === "index";
    let width, height;

    if (isPhoto) {
      width = game.settings.get(MODULE_ID, "photoNoteWidth");
      height = Math.round(width / (225 / 290));
    } else if (isIndex) {
      width = game.settings.get(MODULE_ID, "indexNoteWidth") || 600;
      height = Math.round(width / (600 / 400));
    } else {
      width = game.settings.get(MODULE_ID, "stickyNoteWidth");
      height = width;
    }

    // Create text overlay
    const numberText = new PIXI.Text(String(index + 1), {
      fontFamily: "Arial",
      fontSize: Math.max(48, width / 4),
      fontWeight: "bold",
      fill: "#FFFFFF",
      stroke: "#000000",
      strokeThickness: 6,
      dropShadow: true,
      dropShadowDistance: 3,
      dropShadowBlur: 4,
      dropShadowAlpha: 0.7
    });

    numberText.anchor.set(0.5);
    numberText.position.set(
      targetDrawing.document.x + width / 2,
      targetDrawing.document.y + height / 2
    );
    numberText.zIndex = 100; // Very high, above everything

    canvas.drawings.addChild(numberText);
    connectionNumberOverlays.push(numberText);
  });

  console.log(`Investigation Board: Showing ${connectionNumberOverlays.length} connection numbers`);
}

// Clear all connection number overlays
function clearConnectionNumbers() {
  connectionNumberOverlays.forEach(overlay => {
    if (overlay.parent) {
      overlay.parent.removeChild(overlay);
    }
    overlay.destroy();
  });
  connectionNumberOverlays = [];
}

async function createNote(noteType) {
  const scene = canvas.scene;
  if (!scene) {
    console.error("Cannot create note: No active scene.");
    return;
  }

  // Retrieve width settings (or use defaults)
  const stickyW = game.settings.get(MODULE_ID, "stickyNoteWidth") || 200;
  const photoW = game.settings.get(MODULE_ID, "photoNoteWidth") || 225;
  const indexW = game.settings.get(MODULE_ID, "indexNoteWidth") || 600;
  const handoutW = game.settings.get(MODULE_ID, "handoutNoteWidth") || 400;
  const handoutH = game.settings.get(MODULE_ID, "handoutNoteHeight") || 400;

  const width = noteType === "photo" ? photoW
                : noteType === "index" ? indexW
                : noteType === "handout" ? handoutW
                : stickyW;
  const height = noteType === "photo" ? Math.round(photoW / (225 / 290))
                 : noteType === "index" ? Math.round(indexW / (600 / 400))
                 : noteType === "handout" ? handoutH
                 : stickyW;

  const dims = canvas.dimensions;
  const x = dims.width / 2;
  const y = dims.height / 2;

  // Get default text from settings (fallback if missing)
  const defaultText = noteType === "handout"
                    ? ""
                    : (game.settings.get(MODULE_ID, `${noteType}NoteDefaultText`) || "Notes");

  // Determine board mode and include identityName if note is a futuristic photo note
  const boardMode = game.settings.get(MODULE_ID, "boardMode");
  const extraFlags = {};
  if (noteType === "photo" && boardMode === "futuristic") {
    extraFlags.identityName = "";
  }

  // Set default font size to 9 for index cards
  if (noteType === "index") {
    extraFlags.fontSize = 9;
  }

  // Set default image for handout notes
  if (noteType === "handout") {
    extraFlags.image = "modules/investigation-board/assets/newhandout.webp";
  }

  const created = await canvas.scene.createEmbeddedDocuments("Drawing", [
    {
      type: "r",
      author: game.user.id,
      x,
      y,
      shape: { width, height },
      fillColor: noteType === "handout" ? "#000000" : "#ffffff",
      fillAlpha: noteType === "handout" ? 0 : 1,
      strokeColor: "#000000",
      strokeWidth: 0,
      strokeAlpha: 0,
      locked: false,
      flags: {
        [MODULE_ID]: {
          type: noteType,
          text: defaultText,
          ...extraFlags
        },
        core: {
          sheetClass: "investigation-board.CustomDrawingSheet"
        }
      },
      ownership: { default: 3 },
    },
  ]);

  // If in Investigation Board mode, ensure the new drawing is interactive
  if (investigationBoardModeActive && created && created[0]) {
    // Wait for rendering to complete
    setTimeout(() => {
      const newDrawing = canvas.drawings.get(created[0].id);
      if (newDrawing) {
        newDrawing.eventMode = 'auto';
        newDrawing.interactiveChildren = true;
        console.log("Investigation Board: New note made interactive immediately", created[0].id);
      }
    }, 250);
  }

  // Switch back to select tool so user can immediately manipulate the note
  if (investigationBoardModeActive) {
    const drawingsControl = ui.controls?.controls?.drawings;
    if (drawingsControl) {
      drawingsControl.activeTool = "select";
      ui.controls.render();
    }
  }
}

/**
 * Creates a Photo Note from an Actor document.
 * @param {Actor} actor - The Actor document to use
 * @param {boolean} isUnknown - Whether to use "????" as the name
 */
async function createPhotoNoteFromActor(actor, isUnknown = false) {
  console.log("Investigation Board: Creating photo note from actor", actor.name, "isUnknown:", isUnknown);
  const scene = canvas.scene;
  if (!scene) {
    ui.notifications.error("Cannot create note: No active scene.");
    return;
  }

  const photoW = game.settings.get(MODULE_ID, "photoNoteWidth") || 225;
  const height = Math.round(photoW / (225 / 290));

  const dims = canvas.dimensions;
  const x = dims.width / 2;
  const y = dims.height / 2;

  const displayName = isUnknown ? "????" : getActorDisplayName(actor);
  const imagePath = actor.img || "modules/investigation-board/assets/placeholder.webp";

  const boardMode = game.settings.get(MODULE_ID, "boardMode");
  const extraFlags = { image: imagePath };

  if (boardMode === "futuristic") {
    extraFlags.identityName = displayName;
  }

  console.log("Investigation Board: Creating drawing document with flags:", {
    type: "photo",
    text: displayName,
    ...extraFlags
  });

  const created = await canvas.scene.createEmbeddedDocuments("Drawing", [{
    type: "r",
    author: game.user.id,
    x, y,
    shape: { width: photoW, height },
    fillColor: "#ffffff",
    fillAlpha: 1,
    strokeColor: "#000000",
    strokeWidth: 0,
    strokeAlpha: 0,
    locked: false,
    flags: {
      [MODULE_ID]: {
        type: "photo",
        text: displayName,
        ...extraFlags
      },
      core: { sheetClass: "investigation-board.CustomDrawingSheet" }
    },
    ownership: { default: 3 }
  }]);

  console.log("Investigation Board: Drawing created:", created?.[0]?.id);

  // Handle interactivity in Investigation Board mode
  if (investigationBoardModeActive && created?.[0]) {
    setTimeout(() => {
      const newDrawing = canvas.drawings.get(created[0].id);
      if (newDrawing) {
        newDrawing.eventMode = 'auto';
        newDrawing.interactiveChildren = true;
      }
    }, 250);
  }
}

/**
 * Creates a Photo Note from a Scene document.
 * @param {Scene} targetScene - The Scene document to use
 */
async function createPhotoNoteFromScene(targetScene) {
  console.log("Investigation Board: Creating photo note from scene", targetScene.name);
  const scene = canvas.scene;
  if (!scene) {
    ui.notifications.error("Cannot create note: No active scene.");
    return;
  }

  const photoW = game.settings.get(MODULE_ID, "photoNoteWidth") || 225;
  const height = Math.round(photoW / (225 / 290));

  const dims = canvas.dimensions;
  const x = dims.width / 2;
  const y = dims.height / 2;

  const displayName = targetScene.navName || targetScene.name || "Unknown Location";
  const imagePath = targetScene.background?.src || "modules/investigation-board/assets/placeholder.webp";

  const boardMode = game.settings.get(MODULE_ID, "boardMode");
  const extraFlags = { image: imagePath };

  if (boardMode === "futuristic") {
    extraFlags.identityName = displayName;
  }

  console.log("Investigation Board: Creating drawing document with flags:", {
    type: "photo",
    text: displayName,
    ...extraFlags
  });

  const created = await canvas.scene.createEmbeddedDocuments("Drawing", [{
    type: "r",
    author: game.user.id,
    x, y,
    shape: { width: photoW, height },
    fillColor: "#ffffff",
    fillAlpha: 1,
    strokeColor: "#000000",
    strokeWidth: 0,
    strokeAlpha: 0,
    locked: false,
    flags: {
      [MODULE_ID]: {
        type: "photo",
        text: displayName,
        ...extraFlags
      },
      core: { sheetClass: "investigation-board.CustomDrawingSheet" }
    },
    ownership: { default: 3 }
  }]);

  console.log("Investigation Board: Drawing created:", created?.[0]?.id);

  if (investigationBoardModeActive && created?.[0]) {
    setTimeout(() => {
      const newDrawing = canvas.drawings.get(created[0].id);
      if (newDrawing) {
        newDrawing.eventMode = 'auto';
        newDrawing.interactiveChildren = true;
      }
    }, 250);
  }
}

// Mouse move handler for connection preview
function onMouseMovePreview(event) {
  if (!pinConnectionFirstNote || !connectionPreviewLine) {
    console.log("Investigation Board: Preview handler called but state missing", {
      hasFirstNote: !!pinConnectionFirstNote,
      hasPreviewLine: !!connectionPreviewLine
    });
    return;
  }

  // Get mouse position in world coordinates from the event
  const worldPos = event.getLocalPosition(canvas.stage);

  // Get the first pin position
  const firstPin = pinConnectionFirstNote._getPinPosition();

  // Clear and redraw the preview line
  connectionPreviewLine.clear();

  // Use player's color for preview
  const playerColor = game.user.color || game.settings.get(MODULE_ID, "connectionLineColor") || "#FF0000";
  const width = game.settings.get(MODULE_ID, "connectionLineWidth") || 3;

  // Draw yarn line from first pin to cursor
  drawYarnLine(connectionPreviewLine, firstPin.x, firstPin.y, worldPos.x, worldPos.y, playerColor, width, false, 0);
}

// Start connection preview
function startConnectionPreview(drawing) {
  // Create preview line container if it doesn't exist
  if (!connectionPreviewLine) {
    connectionPreviewLine = new PIXI.Graphics();
    connectionPreviewLine.zIndex = 15; // Between yarn lines and pins
    canvas.drawings.sortableChildren = true;
    canvas.drawings.addChild(connectionPreviewLine);
    console.log("Investigation Board: Preview line container created");
  }

  // Add mouse move listener to canvas
  canvas.stage.on('pointermove', onMouseMovePreview);
  console.log("Investigation Board: Started connection preview mode");
}

// Clear connection preview
function clearConnectionPreview() {
  // Remove mouse move listener
  canvas.stage.off('pointermove', onMouseMovePreview);

  // Clear and remove preview line
  if (connectionPreviewLine) {
    connectionPreviewLine.clear();
    if (connectionPreviewLine.parent) {
      connectionPreviewLine.parent.removeChild(connectionPreviewLine);
    }
    connectionPreviewLine.destroy();
    connectionPreviewLine = null;
  }
}

// Pin-Click Connection Function
function onPinClick(event, drawing) {
  event.stopPropagation(); // Prevent selection of the drawing itself

  // Only allow connections when in Investigation Board mode
  if (!investigationBoardModeActive) return;

  // Check if it's an investigation board note
  const noteData = drawing.document.flags[MODULE_ID];
  if (!noteData) return;

  // First click: store the note
  if (!pinConnectionFirstNote) {
    pinConnectionFirstNote = drawing;

    // Draw green border highlight
    if (pinConnectionHighlight) {
      canvas.controls.removeChild(pinConnectionHighlight);
      pinConnectionHighlight.destroy();
    }

    pinConnectionHighlight = new PIXI.Graphics();
    pinConnectionHighlight.lineStyle(4, 0x00ff00, 1);
    pinConnectionHighlight.drawRect(
      drawing.document.x,
      drawing.document.y,
      drawing.document.shape.width,
      drawing.document.shape.height
    );
    canvas.controls.addChild(pinConnectionHighlight);

    // Start the preview line
    startConnectionPreview(drawing);

    return;
  }

  // Second click: create connection
  if (drawing === pinConnectionFirstNote) {
    ui.notifications.error("Cannot connect a note to itself.");
    return;
  }

  createConnection(pinConnectionFirstNote, drawing);

  // Reset state
  pinConnectionFirstNote = null;
  if (pinConnectionHighlight) {
    canvas.controls.removeChild(pinConnectionHighlight);
    pinConnectionHighlight.destroy();
    pinConnectionHighlight = null;
  }

  // Clear the preview line
  clearConnectionPreview();
}

async function createConnection(sourceDrawing, targetDrawing) {
  const connections = sourceDrawing.document.flags[MODULE_ID]?.connections || [];

  // Check for duplicate
  const isDuplicate = connections.some(conn => conn.targetId === targetDrawing.document.id);
  if (isDuplicate) {
    // ui.notifications.warn("Connection already exists between these notes.");
    return;
  }

  // Use player's color by default, fallback to setting or red
  const playerColor = game.user.color || game.settings.get(MODULE_ID, "connectionLineColor") || "#FF0000";
  const width = game.settings.get(MODULE_ID, "connectionLineWidth") || 6;

  // Add new connection
  connections.push({
    targetId: targetDrawing.document.id,
    color: playerColor,
    width: width
  });

  // Update document using collaborative update (works for all users)
  await collaborativeUpdate(sourceDrawing.document.id, {
    [`flags.${MODULE_ID}.connections`]: connections
  });

  // Immediately redraw all connection lines
  drawAllConnectionLines();

  // ui.notifications.info("Connection created successfully.");
}

// Old context menu dialog removed - now using double-click edit dialog

/**
 * Helper function to refresh interactive properties of all drawings
 */
function refreshDrawingsInteractivity() {
  if (!canvas.drawings) return;

  canvas.drawings.placeables.forEach(drawing => {
    const isInvestigationNote = drawing.document.flags[MODULE_ID];
    if (!isInvestigationNote) {
      drawing.eventMode = 'none';
      drawing.interactiveChildren = false;
    } else {
      // Ensure investigation notes are interactive and selectable
      drawing.eventMode = 'static';
      drawing.interactiveChildren = true;
      drawing.cursor = 'pointer';
    }
  });
}

/**
 * Activates Investigation Board mode - filters interactions to only investigation board notes
 */
function activateInvestigationBoardMode() {
  if (investigationBoardModeActive) return;
  if (!canvas.drawings) {
    console.error("Investigation Board: drawings layer not available");
    return;
  }

  console.log("Investigation Board: Activating mode...");
  investigationBoardModeActive = true;

  // Store original double-click handler only
  originalDrawingMethods._onClickLeft2 = canvas.drawings._onClickLeft2;

  // Override double-click handler to open CustomDrawingSheet
  canvas.drawings._onClickLeft2 = async function(event) {
    // First check controlled drawings
    let drawing = this.controlled[0];

    // If no controlled drawing, try to find from event target
    if (!drawing) {
      const interactionData = event.interactionData;
      if (interactionData?.object) {
        drawing = interactionData.object;
      }
    }

    // Check if it's an investigation board note
    if (drawing?.document?.flags?.[MODULE_ID]) {
      // Open custom sheet instead of default drawing config
      event.stopPropagation();
      drawing.document.sheet.render(true);
      return;
    }
    // Fallback to original behavior
    return originalDrawingMethods._onClickLeft2?.call(this, event);
  };

  // Filter visible placeables using helper function
  refreshDrawingsInteractivity();

  // Add CSS class for visual styling
  document.body.classList.add("investigation-board-mode");

  console.log("Investigation Board: Mode ACTIVE");
}

/**
 * Deactivates Investigation Board mode - restores normal drawing interactions
 */
function deactivateInvestigationBoardMode() {
  if (!investigationBoardModeActive) return;

  console.log("Investigation Board: Deactivating mode...");
  investigationBoardModeActive = false;

  // Clear pin connection state
  pinConnectionFirstNote = null;
  if (pinConnectionHighlight) {
    canvas.controls.removeChild(pinConnectionHighlight);
    pinConnectionHighlight.destroy();
    pinConnectionHighlight = null;
  }

  // Clear the preview line
  clearConnectionPreview();

  // Clear connection numbers
  clearConnectionNumbers();

  // Restore original methods
  if (canvas.drawings) {
    canvas.drawings._onClickLeft2 = originalDrawingMethods._onClickLeft2;

    // Restore default interactivity to all drawings
    canvas.drawings.placeables.forEach(drawing => {
      drawing.eventMode = 'auto';
      drawing.interactiveChildren = true;
      drawing.cursor = null;
    });
  }

  // Remove CSS class
  document.body.classList.remove("investigation-board-mode");

  console.log("Investigation Board: Mode INACTIVE");
}


Hooks.on("getSceneControlButtons", (controls) => {
  // Add Investigation Board tools to the existing drawings control
  if (controls.drawings && controls.drawings.tools) {
    // Add a separator for visual grouping (optional)
    controls.drawings.tools.createStickyNote = {
      name: "createStickyNote",
      title: "Create Sticky Note",
      icon: "fas fa-sticky-note",
      onChange: () => createNote("sticky"),
      button: true
    };

    controls.drawings.tools.createPhotoNote = {
      name: "createPhotoNote",
      title: "Create Photo Note",
      icon: "fa-solid fa-camera-polaroid",
      onChange: () => createNote("photo"),
      button: true
    };

    controls.drawings.tools.createIndexCard = {
      name: "createIndexCard",
      title: "Create Index Card",
      icon: "fa-regular fa-subtitles",
      onChange: () => createNote("index"),
      button: true
    };

    controls.drawings.tools.createHandout = {
      name: "createHandout",
      title: "Create Handout Note",
      icon: "fas fa-file-image",
      onChange: () => createNote("handout"),
      button: true
    };

    // Connect mode removed - now done by clicking pins directly
  }
});

// Hook to handle Investigation Board mode activation/deactivation
Hooks.on("renderSceneControls", (controls, html) => {
  const activeControl = controls.control?.name;

  if (activeControl === "drawings") {
    activateInvestigationBoardMode();
  } else if (investigationBoardModeActive) {
    deactivateInvestigationBoardMode();
  }
});

// HUD disabled - double-click to edit notes instead
// Hooks.on("controlDrawing", (drawing, controlled) => {
//   if (!investigationBoardModeActive) return;
//   const isInvestigationNote = drawing.document.flags[MODULE_ID];
//   if (!isInvestigationNote) return;
//   if (controlled) {
//     if (!investigationBoardHUD) {
//       investigationBoardHUD = new InvestigationBoardHUD();
//     }
//     investigationBoardHUD.bind(drawing);
//     investigationBoardHUD.render(true);
//   } else if (investigationBoardHUD?.object === drawing) {
//     investigationBoardHUD.clear();
//   }
// });

Hooks.once("init", () => {
  registerSettings();
  CONFIG.Drawing.objectClass = CustomDrawing;

  DocumentSheetConfig.registerSheet(DrawingDocument, "investigation-board", CustomDrawingSheet, {
    label: "Note Drawing Sheet",
    types: ["base"],
    makeDefault: false,
  });

  // ESC key handler to cancel pin connection
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && pinConnectionFirstNote) {
      // Clear pin connection state
      pinConnectionFirstNote = null;
      if (pinConnectionHighlight) {
        canvas.controls.removeChild(pinConnectionHighlight);
        pinConnectionHighlight.destroy();
        pinConnectionHighlight = null;
      }
      // Clear the preview line
      clearConnectionPreview();
    }
  });

  console.log("Investigation Board module initialized.");
});

// Hook to initialize socket for collaborative editing
Hooks.once("ready", () => {
  // Set up socket listener for collaborative updates
  socket = game.socket;
  socket.on(SOCKET_NAME, handleSocketMessage);
  console.log("Investigation Board: Socket listener registered for collaborative editing.");
});

// Hook to ensure newly created notes are interactive in Investigation Board mode
Hooks.on("createDrawing", (drawing, options, userId) => {
  // Check if this is an investigation board note
  const noteData = drawing.flags[MODULE_ID];
  if (!noteData) return;

  // If we're in Investigation Board mode, refresh interactivity after the drawing is rendered
  if (investigationBoardModeActive) {
    // Wait for the drawing to be fully rendered on canvas
    setTimeout(() => {
      refreshDrawingsInteractivity();
      console.log("Investigation Board: Refreshed interactivity for new note", drawing.id);
    }, 300);
  }
});

// Hook to intercept drawing updates and route through socket if user lacks permission
Hooks.on("preUpdateDrawing", (drawing, changes, options, userId) => {
  // Only intercept if this is the current user's action
  if (userId !== game.user.id) return true;

  // Check if this is an investigation board note
  const noteData = drawing.flags?.[MODULE_ID];
  if (!noteData?.type) return true;

  // If user is GM or has owner permission, allow normal update
  if (game.user.isGM || drawing.testUserPermission(game.user, "OWNER")) {
    return true;
  }

  // User doesn't have permission - route through socket
  if (socket) {
    socket.emit(SOCKET_NAME, {
      action: "updateDrawing",
      sceneId: canvas.scene.id,
      drawingId: drawing.id,
      updateData: changes,
      requestingUser: game.user.id
    });
    console.log("Investigation Board: Routed update through socket for", drawing.id);
  }

  // Return false to prevent the normal update (socket will handle it)
  return false;
});

// Hook to redraw lines and refresh visuals when notes change
Hooks.on("updateDrawing", async (drawing, changes, options, userId) => {
  // Check if this is an investigation board note
  const noteData = drawing.flags[MODULE_ID];
  if (!noteData) return;

  const placeable = canvas.drawings.get(drawing.id);

  // For handouts, check if actual dimensions differ from sprite dimensions
  if (noteData.type === "handout" && placeable && placeable.photoImageSprite) {
    const docW = drawing.shape.width;
    const docH = drawing.shape.height;
    const spriteW = placeable.photoImageSprite.width || 0;
    const spriteH = placeable.photoImageSprite.height || 0;

    // Check if sprite dimensions don't match document (allowing for aspect ratio differences)
    const tolerance = 5; // pixels
    const widthMismatch = Math.abs(spriteW - docW) > tolerance;
    const heightMismatch = Math.abs(spriteH - docH) > tolerance;

    if (widthMismatch || heightMismatch) {
      await placeable.refresh();
    }
  }

  // Check if flags changed (text, image, connections, font, etc.)
  const flagsChanged = changes.flags?.[MODULE_ID] !== undefined;

  // If flags changed, refresh the drawing to update visuals on ALL clients
  if (flagsChanged && placeable) {
    await placeable.refresh();
  }

  // Redraw connection lines when position OR connections change
  if (changes.x !== undefined || changes.y !== undefined || flagsChanged) {
    drawAllConnectionLines();
  }
});

// Hook to redraw lines when notes are deleted
Hooks.on("deleteDrawing", (drawing, options, userId) => {
  // Check if this is an investigation board note
  const noteData = drawing.flags[MODULE_ID];
  if (!noteData) return;

  // Redraw all connection lines to remove orphaned connections
  drawAllConnectionLines();
});

// Context menu hook for Actor directory
Hooks.on("getActorContextOptions", (html, entryOptions) => {
  console.log("Investigation Board: Actor context menu hook triggered");
  entryOptions.push(
    {
      name: "Photo Note from Actor",
      icon: '<i class="fa-solid fa-camera-polaroid"></i>',
      callback: async (li) => {
        console.log("Investigation Board: Actor context menu callback triggered", li);
        // Handle both native HTMLElement and jQuery objects, and check both documentId and entryId
        const actorId = li.dataset?.documentId || 
                        li.getAttribute?.("data-document-id") || 
                        li.dataset?.entryId || 
                        li.getAttribute?.("data-entry-id") ||
                        (typeof li.data === "function" ? (li.data("documentId") || li.data("entryId")) : null);
        
        console.log("Investigation Board: Resolved actorId:", actorId);
        const actor = game.actors.get(actorId);
        if (actor) await createPhotoNoteFromActor(actor, false);
        else console.error("Investigation Board: Actor not found for ID:", actorId);
      },
      condition: () => game.user.isGM
    },
    {
      name: "Unknown Photo Note from Actor",
      icon: '<i class="fa-solid fa-camera-polaroid"></i>',
      callback: async (li) => {
        console.log("Investigation Board: Unknown Actor context menu callback triggered", li);
        const actorId = li.dataset?.documentId || 
                        li.getAttribute?.("data-document-id") || 
                        li.dataset?.entryId || 
                        li.getAttribute?.("data-entry-id") ||
                        (typeof li.data === "function" ? (li.data("documentId") || li.data("entryId")) : null);
        
        console.log("Investigation Board: Resolved actorId:", actorId);
        const actor = game.actors.get(actorId);
        if (actor) await createPhotoNoteFromActor(actor, true);
        else console.error("Investigation Board: Actor not found for ID:", actorId);
      },
      condition: () => game.user.isGM
    }
  );
});

// Context menu hook for Scene directory
Hooks.on("getSceneDirectoryEntryContext", (html, entryOptions) => {
  console.log("Investigation Board: Scene context menu hook triggered");
  entryOptions.push({
    name: "Photo Note from Scene",
    icon: '<i class="fa-solid fa-camera-polaroid"></i>',
    callback: async (li) => {
      console.log("Investigation Board: Scene context menu callback triggered", li);
      const sceneId = li.dataset?.documentId || 
                      li.getAttribute?.("data-document-id") || 
                      li.dataset?.entryId || 
                      li.getAttribute?.("data-entry-id") ||
                      (typeof li.data === "function" ? (li.data("documentId") || li.data("entryId")) : null);
      
      console.log("Investigation Board: Resolved sceneId:", sceneId);
      const scene = game.scenes.get(sceneId);
      if (scene) await createPhotoNoteFromScene(scene);
      else console.error("Investigation Board: Scene not found for ID:", sceneId);
    },
    condition: () => game.user.isGM
  });
});

// Hook to deactivate connect mode on scene change and initialize connection lines
Hooks.on("canvasReady", () => {
  // Properly destroy and remove old containers before clearing references
  if (connectionLinesContainer) {
    if (connectionLinesContainer.parent) {
      connectionLinesContainer.parent.removeChild(connectionLinesContainer);
    }
    connectionLinesContainer.destroy();
    connectionLinesContainer = null;
  }

  if (pinsContainer) {
    if (pinsContainer.parent) {
      pinsContainer.parent.removeChild(pinsContainer);
    }
    pinsContainer.destroy();
    pinsContainer = null;
  }

  // Clear pin connection state on scene change
  pinConnectionFirstNote = null;
  if (pinConnectionHighlight) {
    pinConnectionHighlight.destroy();
    pinConnectionHighlight = null;
  }

  // Clear the preview line on canvas change
  clearConnectionPreview();

  // Clear connection numbers on canvas change
  clearConnectionNumbers();

  // Reapply Investigation Board mode if it was active before canvas recreation
  if (investigationBoardModeActive) {
    console.log("Investigation Board: Canvas recreated, reapplying mode...");
    deactivateInvestigationBoardMode();
    activateInvestigationBoardMode();
  }

  // Draw all connection lines and pins after a short delay to ensure all drawings are loaded
  setTimeout(() => {
    drawAllConnectionLines();
  }, 100);
});

// Context menu hook removed - connections now managed in double-click edit dialog


export { CustomDrawing, CustomDrawingSheet };
