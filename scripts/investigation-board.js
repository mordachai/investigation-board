//investigation-boards.js

import { registerSettings } from "./settings.js";

const MODULE_ID = "investigation-board";
const BASE_FONT_SIZE = 15;
const PIN_COLORS = ["redPin.webp", "bluePin.webp", "yellowPin.webp", "greenPin.webp"];

// Connect Mode state variables
let connectModeActive = false;
let connectModeFirstNote = null;
let connectModeHighlight = null; // PIXI.Graphics for border
let connectionLinesContainer = null; // Global container for all connection lines
let pinsContainer = null; // Global container for all pins (to render on top)

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


class CustomDrawingSheet extends DrawingConfig {
  constructor(...args) {
    super(...args);
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

    return context;
  }

  getData(options) {
    // In v13, super.getData() doesn't exist in ApplicationV2
    // Build the data object directly
    const data = {
      document: this.document,
      noteType: this.document.flags[MODULE_ID]?.type || "sticky",
      text: this.document.flags[MODULE_ID]?.text || "Default Text",
      image: this.document.flags[MODULE_ID]?.image || "modules/investigation-board/assets/placeholder.webp",
      identityName: this.document.flags[MODULE_ID]?.identityName || "",
      boardMode: game.settings.get(MODULE_ID, "boardMode"),
      noteTypes: {
        sticky: "Sticky Note",
        photo: "Photo Note",
        index: "Index Card",
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

    // Hook up file picker button
    const filePickerButton = this.element.querySelector(".file-picker-button");
    if (filePickerButton) {
      filePickerButton.addEventListener("click", (ev) => {
        ev.preventDefault();
        const input = this.element.querySelector("input[name='image']");

        new FilePicker({
          type: "image",
          current: "modules/investigation-board/assets/",
          callback: (path) => {
            input.value = path;
          }
        }).browse();
      });
    }

    const form = this.element.querySelector("form");
    if (form) {
      form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();

        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());

        // Update the document flags
        const updates = {
          [`flags.${MODULE_ID}.text`]: data.text || "",
          [`flags.${MODULE_ID}.image`]: data.image || "modules/investigation-board/assets/placeholder.webp",
        };

        if (data.identityName !== undefined) {
          updates[`flags.${MODULE_ID}.identityName`] = data.identityName;
        }

        await this.document.update(updates);

        // Refresh the drawing on canvas
        const drawing = canvas.drawings.get(this.document.id);
        if (drawing) {
          await drawing.refresh();
        }

        // Close the sheet
        await this.close();
      }, true);
    }
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
    this.identityNameText = null;
    this.futuristicText = null;
  }

  // Ensure sprites are created when the drawing is first rendered.
  async draw() {
    await super.draw();
    await this._updateSprites();
    // Redraw all connections and reposition pins globally
    drawAllConnectionLines();
    return this;
  }

  // Ensure sprites update correctly on refresh.
  async refresh() {
    await super.refresh();
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
    const mode = game.settings.get(MODULE_ID, "boardMode");
    
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
        // Always use the fixed photo frame image.
        this.bgSprite.texture = PIXI.Texture.from("modules/investigation-board/assets/photoFrame.webp");
      } catch (err) {
        console.error("Failed to load photo frame texture", err);
        this.bgSprite.texture = PIXI.Texture.EMPTY;
      }
      this.bgSprite.width = fullWidth;
      this.bgSprite.height = fullHeight;
    
      // --- Foreground (User-Assigned) Photo ---
      if (!this.photoImageSprite) {
        this.photoImageSprite = new PIXI.Sprite();
        this.addChild(this.photoImageSprite);
      }
      try {
        // Use a fallback if no image is assigned.
        const imagePath = noteData.image || "modules/investigation-board/assets/placeholder.webp";
        this.photoImageSprite.texture = PIXI.Texture.from(imagePath);
      } catch (err) {
        console.error(`Failed to load user photo: ${noteData.image}`, err);
        this.photoImageSprite.texture = PIXI.Texture.EMPTY;
      }
      // Position the user photo inside the frame.
      this.photoImageSprite.width = fullWidth * 0.9;
      this.photoImageSprite.height = fullHeight * 0.9;
      this.photoImageSprite.position.set(fullWidth * 0.05, fullHeight * 0.05);
    
      // --- Identity Name and Additional Text (Futuristic) ---
      const font = game.settings.get(MODULE_ID, "font");
      const baseFontSize = game.settings.get(MODULE_ID, "baseFontSize");
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
          if (this.document.isOwner) {
            await this.document.update({ [`flags.${MODULE_ID}.pinColor`]: pinColor });
          }
        }
        const pinImage = `modules/investigation-board/assets/${pinColor}`;
        try {
          this.pinSprite.texture = PIXI.Texture.from(pinImage);
        } catch (err) {
          console.error(`Failed to load pin texture: ${pinImage}`, err);
          this.pinSprite.texture = PIXI.Texture.EMPTY;
        }
        this.pinSprite.width = 40;
        this.pinSprite.height = 40;
        this.pinSprite.position.set(fullWidth / 2 - 20, 3);
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
      this.bgSprite.texture = PIXI.Texture.from(bgImage);
    } catch (err) {
      console.error(`Failed to load background texture: ${bgImage}`, err);
      this.bgSprite.texture = PIXI.Texture.EMPTY;
    }
    this.bgSprite.width = width;
    this.bgSprite.height = height;
    
    // --- Foreground (User-Assigned) Photo for Modern Mode ---
    // (This is the code missing from your current version.)
    if (isPhoto) {
      const fgImage = noteData.image || "modules/investigation-board/assets/placeholder.webp";
      if (!this.photoImageSprite) {
        this.photoImageSprite = new PIXI.Sprite();
        this.addChild(this.photoImageSprite);
      }
      try {
        this.photoImageSprite.texture = PIXI.Texture.from(fgImage);
      } catch (err) {
        console.error(`Failed to load foreground texture: ${fgImage}`, err);
        this.photoImageSprite.texture = PIXI.Texture.EMPTY;
      }
      // Use offsets similar to your old code.
      const widthOffset = width * 0.13333;
      const heightOffset = height * 0.30246;
      this.photoImageSprite.width = width - widthOffset;
      this.photoImageSprite.height = height - heightOffset;
      this.photoImageSprite.position.set(widthOffset / 2, heightOffset / 2);
      this.photoImageSprite.visible = true;
    } else if (this.photoImageSprite) {
      this.photoImageSprite.visible = false;
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
	  if (this.document.isOwner) {
            await this.document.update({ [`flags.${MODULE_ID}.pinColor`]: pinColor });
          }
        }
        const pinImage = `modules/investigation-board/assets/${pinColor}`;
        try {
          this.pinSprite.texture = PIXI.Texture.from(pinImage);
        } catch (err) {
          console.error(`Failed to load pin texture: ${pinImage}`, err);
          this.pinSprite.texture = PIXI.Texture.EMPTY;
        }
        this.pinSprite.width = 40;
        this.pinSprite.height = 40;
        this.pinSprite.position.set(width / 2 - 20, 3);
      }
    }
    
    // Default text layout for non-futuristic notes.
    const font = game.settings.get(MODULE_ID, "font");
    const baseFontSize = game.settings.get(MODULE_ID, "baseFontSize");
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
function drawAllConnectionLines() {
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

        let width;
        if (isPhoto) {
          width = game.settings.get(MODULE_ID, "photoNoteWidth");
        } else if (isIndex) {
          width = game.settings.get(MODULE_ID, "indexNoteWidth") || 600;
        } else {
          width = game.settings.get(MODULE_ID, "stickyNoteWidth");
        }

        drawing.pinSprite.x = drawing.document.x + width / 2 - 20;
        drawing.pinSprite.y = drawing.document.y + 3;

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
      const lineWidth = conn.width || game.settings.get(MODULE_ID, "connectionLineWidth") || 3;
      const colorNum = parseInt(lineColor.replace("#", ""), 16);

      // Draw yarn line in world coordinates
      drawYarnLine(
        connectionLinesContainer,
        sourcePin.x,
        sourcePin.y,
        targetPin.x,
        targetPin.y,
        colorNum,
        lineWidth
      );
    });
  });
}

// Helper function to draw a yarn line
function drawYarnLine(graphics, x1, y1, x2, y2, color, width) {
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

  const width = noteType === "photo" ? photoW 
                : noteType === "index" ? indexW 
                : stickyW;
  const height = noteType === "photo" ? Math.round(photoW / (225 / 290)) 
                 : noteType === "index" ? Math.round(indexW / (600 / 400)) 
                 : stickyW;

  const dims = canvas.dimensions;
  const x = dims.width / 2;
  const y = dims.height / 2;

  // Get default text from settings (fallback if missing)
  const defaultText = game.settings.get(MODULE_ID, `${noteType}NoteDefaultText`) || "Notes";

  // Determine board mode and include identityName if note is a futuristic photo note
  const boardMode = game.settings.get(MODULE_ID, "boardMode");
  const extraFlags = {};
  if (noteType === "photo" && boardMode === "futuristic") {
    extraFlags.identityName = "";
  }

  await canvas.scene.createEmbeddedDocuments("Drawing", [
    {
      type: "r",
      author: game.user.id,
      x,
      y,
      shape: { width, height },
      fillColor: "#ffffff",
      fillAlpha: 1,
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

  canvas.drawings.activate();
}

// Connect Mode Functions
function activateConnectMode() {
  connectModeActive = true;
  connectModeFirstNote = null;
  ui.notifications.info("Connect Mode: Click first note, then second note to connect them.");

  // Add click listener
  canvas.stage.on("click", onCanvasClickConnectMode);

  // Add CSS class for cursor styling
  document.body.classList.add("connect-mode-active");
}

function deactivateConnectMode() {
  connectModeActive = false;
  connectModeFirstNote = null;

  // Remove highlight if exists
  if (connectModeHighlight) {
    canvas.controls.removeChild(connectModeHighlight);
    connectModeHighlight.destroy();
    connectModeHighlight = null;
  }

  // Remove click listener
  canvas.stage.off("click", onCanvasClickConnectMode);

  // Remove CSS class
  document.body.classList.remove("connect-mode-active");
}

function onCanvasClickConnectMode(event) {
  if (!connectModeActive) return;

  // Get the position of the click
  const position = event.data.getLocalPosition(canvas.stage);

  // Find drawing at this position
  const drawings = canvas.drawings.placeables.filter(d => {
    const bounds = d.bounds;
    return position.x >= bounds.x && position.x <= bounds.x + bounds.width &&
           position.y >= bounds.y && position.y <= bounds.y + bounds.height;
  });

  if (drawings.length === 0) return;

  // Get the top-most drawing
  const drawing = drawings[drawings.length - 1];

  // Check if it's an investigation board note
  const noteData = drawing.document.flags[MODULE_ID];
  if (!noteData) {
    ui.notifications.warn("Please click on an Investigation Board note.");
    return;
  }

  // First click: store the note
  if (!connectModeFirstNote) {
    connectModeFirstNote = drawing;

    // Draw green border highlight
    if (connectModeHighlight) {
      canvas.controls.removeChild(connectModeHighlight);
      connectModeHighlight.destroy();
    }

    connectModeHighlight = new PIXI.Graphics();
    connectModeHighlight.lineStyle(4, 0x00ff00, 1);
    connectModeHighlight.drawRect(
      drawing.document.x,
      drawing.document.y,
      drawing.document.shape.width,
      drawing.document.shape.height
    );
    canvas.controls.addChild(connectModeHighlight);

    ui.notifications.info("First note selected. Click second note to create connection.");
    return;
  }

  // Second click: create connection
  if (drawing === connectModeFirstNote) {
    ui.notifications.error("Cannot connect a note to itself.");
    return;
  }

  createConnection(connectModeFirstNote, drawing);

  // Reset state
  connectModeFirstNote = null;
  if (connectModeHighlight) {
    canvas.controls.removeChild(connectModeHighlight);
    connectModeHighlight.destroy();
    connectModeHighlight = null;
  }
}

async function createConnection(sourceDrawing, targetDrawing) {
  const connections = sourceDrawing.document.flags[MODULE_ID]?.connections || [];

  // Check for duplicate
  const isDuplicate = connections.some(conn => conn.targetId === targetDrawing.document.id);
  if (isDuplicate) {
    ui.notifications.warn("Connection already exists between these notes.");
    return;
  }

  // Get settings
  const color = game.settings.get(MODULE_ID, "connectionLineColor") || "#FF0000";
  const width = game.settings.get(MODULE_ID, "connectionLineWidth") || 3;

  // Add new connection
  connections.push({
    targetId: targetDrawing.document.id,
    color: color,
    width: width
  });

  // Update document
  await sourceDrawing.document.update({
    [`flags.${MODULE_ID}.connections`]: connections
  });

  // Immediately redraw all connection lines
  drawAllConnectionLines();

  ui.notifications.info("Connection created successfully.");
}

async function showRemoveConnectionDialog(sourceDrawing) {
  const connections = sourceDrawing.document.flags[MODULE_ID]?.connections || [];
  if (connections.length === 0) return;

  // Build HTML for the dialog
  let html = `<form><div class="form-group"><label>Select connections to remove:</label>`;

  connections.forEach((conn, index) => {
    const targetDrawing = canvas.drawings.get(conn.targetId);
    let targetLabel = "Unknown Note";
    if (targetDrawing) {
      const targetData = targetDrawing.document.flags[MODULE_ID];
      if (targetData) {
        targetLabel = `${targetData.type} (${conn.targetId.substring(0, 8)}...)`;
      }
    } else {
      targetLabel = `Deleted Note (${conn.targetId.substring(0, 8)}...)`;
    }

    html += `<div><input type="checkbox" name="conn-${index}" id="conn-${index}"><label for="conn-${index}">${targetLabel}</label></div>`;
  });

  html += `</div></form>`;

  // Create dialog
  new Dialog({
    title: "Remove Connections",
    content: html,
    buttons: {
      remove: {
        icon: '<i class="fas fa-unlink"></i>',
        label: "Remove Selected",
        callback: async (html) => {
          const form = html[0].querySelector("form");
          const formData = new FormData(form);

          // Collect indices to remove
          const indicesToRemove = [];
          for (let i = 0; i < connections.length; i++) {
            if (formData.get(`conn-${i}`) === "on") {
              indicesToRemove.push(i);
            }
          }

          if (indicesToRemove.length === 0) {
            ui.notifications.warn("No connections selected.");
            return;
          }

          // Filter out the selected connections
          const remainingConnections = connections.filter((_, idx) => !indicesToRemove.includes(idx));

          // Update document
          await sourceDrawing.document.update({
            [`flags.${MODULE_ID}.connections`]: remainingConnections
          });

          // Immediately redraw all connection lines
          drawAllConnectionLines();

          ui.notifications.info(`Removed ${indicesToRemove.length} connection(s).`);
        }
      },
      cancel: {
        icon: '<i class="fas fa-times"></i>',
        label: "Cancel"
      }
    },
    default: "remove"
  }).render(true);
}



Hooks.on("getSceneControlButtons", (controls) => {
  const journalControls = controls.notes;
  if (!journalControls) return;

  // v13: tools is now an object/record, not an array
  // v13: onClick is deprecated, use onChange instead
  journalControls.tools.createStickyNote = {
    name: "createStickyNote",
    title: "Create Sticky Note",
    icon: "fas fa-sticky-note",
    onChange: () => createNote("sticky"),
    button: true
  };

  journalControls.tools.createPhotoNote = {
    name: "createPhotoNote",
    title: "Create Photo Note",
    icon: "fa-solid fa-camera-polaroid",
    onChange: () => createNote("photo"),
    button: true
  };

  journalControls.tools.createIndexCard = {
    name: "createIndexCard",
    title: "Create Index Card",
    icon: "fa-regular fa-subtitles",
    onChange: () => createNote("index"),
    button: true
  };

  journalControls.tools.connectMode = {
    name: "connectMode",
    title: "Connect Mode (Click two notes to connect)",
    icon: "fas fa-link",
    toggle: true,
    active: false,
    onChange: (active) => {
      if (active) {
        activateConnectMode();
      } else {
        deactivateConnectMode();
      }
    }
  };
});

Hooks.once("init", () => {
  registerSettings();
  CONFIG.Drawing.objectClass = CustomDrawing;

  DocumentSheetConfig.registerSheet(DrawingDocument, "investigation-board", CustomDrawingSheet, {
    label: "Note Drawing Sheet",
    types: ["base"],
    makeDefault: true,
  });

  // ESC key handler to exit connect mode
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && connectModeActive) {
      // Deactivate connect mode
      deactivateConnectMode();

      // Toggle off the button in the toolbar
      const connectModeButton = ui.controls?.controls?.find(c => c.name === "notes")
        ?.tools?.find(t => t.name === "connectMode");
      if (connectModeButton) {
        connectModeButton.active = false;
        ui.controls.render();
      }
    }
  });

  console.log("Investigation Board module initialized.");
});

// Hook to redraw lines when notes move
Hooks.on("updateDrawing", (drawing, changes, options, userId) => {
  // Check if this is an investigation board note
  const noteData = drawing.flags[MODULE_ID];
  if (!noteData) return;

  // If position changed, redraw all connection lines
  if (changes.x !== undefined || changes.y !== undefined) {
    drawAllConnectionLines();
  }
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

  if (connectModeActive) {
    deactivateConnectMode();

    // Toggle off the button in the toolbar
    const connectModeButton = ui.controls?.controls?.find(c => c.name === "notes")
      ?.tools?.find(t => t.name === "connectMode");
    if (connectModeButton) {
      connectModeButton.active = false;
      ui.controls.render();
    }
  }

  // Draw all connection lines and pins after a short delay to ensure all drawings are loaded
  setTimeout(() => {
    drawAllConnectionLines();
  }, 100);
});

// Hook to add "Remove Connections" to context menu
Hooks.on("getDrawingContextOptions", (drawing, options) => {
  const noteData = drawing.document.flags[MODULE_ID];
  if (!noteData) return;

  const connections = noteData.connections || [];
  if (connections.length === 0) return;

  options.push({
    name: "Remove Connections",
    icon: '<i class="fas fa-unlink"></i>',
    condition: () => game.user.isGM || drawing.document.testUserPermission(game.user, "OWNER"),
    callback: () => {
      const drawingPlaceable = canvas.drawings.get(drawing.id);
      if (drawingPlaceable) {
        showRemoveConnectionDialog(drawingPlaceable);
      }
    }
  });
});


export { CustomDrawing, CustomDrawingSheet };
