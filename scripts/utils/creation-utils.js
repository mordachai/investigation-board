import { MODULE_ID } from "../config.js";
import { InvestigationBoardState } from "../state.js";
import { getActorDisplayName } from "./helpers.js";
import { collaborativeCreate } from "./socket-handler.js";

/**
 * Internal helper to find a random cassette image from assets
 */
async function _getRandomCassetteImage() {
  let imagePath = "modules/investigation-board/assets/cassette1.webp"; // Default fallback
  try {
    const folder = "modules/investigation-board/assets/";
    const browse = await FilePicker.browse("data", folder);
    const cassettes = browse.files.filter(f => {
      const filename = f.split("/").pop();
      return filename.startsWith("cassette") && f.endsWith(".webp");
    });
    if (cassettes.length > 0) {
      imagePath = cassettes[Math.floor(Math.random() * cassettes.length)];
    }
  } catch (err) {
    console.warn("Investigation Board: Could not browse assets folder for cassettes", err);
  }
  return imagePath;
}

export async function createNote(noteType) {
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
  const mediaW = 400;

  const width = noteType === "photo" ? photoW
                : noteType === "index" ? indexW
                : noteType === "handout" ? handoutW
                : noteType === "media" ? mediaW
                : stickyW;
  const height = noteType === "photo" ? Math.round(photoW / (225 / 290))
                 : noteType === "index" ? Math.round(indexW / (600 / 400))
                 : noteType === "handout" ? handoutH
                 : noteType === "media" ? Math.round(mediaW * 0.74)
                 : stickyW;

  const viewCenter = canvas.stage.pivot;
  const x = viewCenter.x - width / 2;
  const y = viewCenter.y - height / 2;

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

  // Set default image and audio for media notes
  if (noteType === "media") {
    extraFlags.image = await _getRandomCassetteImage();
    extraFlags.audioPath = "";
  }

  const created = await collaborativeCreate({
    type: "r",
    author: game.user.id,
    x,
    y,
    shape: { width, height },
    fillColor: noteType === "handout" || noteType === "media" ? "#000000" : "#ffffff",
    fillAlpha: noteType === "handout" || noteType === "media" ? 0 : 1,
    strokeColor: "#000000",
    strokeWidth: 0,
    strokeAlpha: 0,
    locked: false,
    flags: {
      [MODULE_ID]: {
        type: noteType,
        text: defaultText,
        linkedObject: "",
        ...extraFlags
      },
      core: {
        sheetClass: "investigation-board.CustomDrawingSheet"
      }
    },
    ownership: { default: 3 },
  });

  // If in Investigation Board mode, ensure the new drawing is interactive
  if (InvestigationBoardState.isActive && created && created[0]) {
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
  if (InvestigationBoardState.isActive) {
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
export async function createPhotoNoteFromActor(actor, isUnknown = false) {
  const scene = canvas.scene;
  if (!scene) {
    ui.notifications.error("Cannot create note: No active scene.");
    return;
  }

  // Get displayName using the helper function
  let displayName = getActorDisplayName(actor);

  // Override if isUnknown is true
  if (isUnknown) {
    displayName = "Unknown";
  }

  const imagePath = actor.img || "modules/investigation-board/assets/placeholder.webp";
  const extraFlags = {
    image: imagePath,
    ...(isUnknown ? { unknown: true } : {})
  };

  const photoW = game.settings.get(MODULE_ID, "photoNoteWidth") || 225;
  const height = Math.round(photoW / (225 / 290));

  const viewCenter = canvas.stage.pivot;
  const x = viewCenter.x - photoW / 2;
  const y = viewCenter.y - height / 2;

  const created = await collaborativeCreate({
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
        linkedObject: `@UUID[${actor.uuid}]{${displayName}}`,
        ...extraFlags
      },
      core: { sheetClass: "investigation-board.CustomDrawingSheet" }
    },
    ownership: { default: 3 }
  }, { skipAutoOpen: true });

  // Handle interactivity in Investigation Board mode
  if (InvestigationBoardState.isActive && created?.[0]) {
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
export async function createPhotoNoteFromScene(targetScene) {
  const scene = canvas.scene;
  if (!scene) {
    ui.notifications.error("Cannot create note: No active scene.");
    return;
  }

  const photoW = game.settings.get(MODULE_ID, "photoNoteWidth") || 225;
  const height = Math.round(photoW / (225 / 290));

  const viewCenter = canvas.stage.pivot;
  const x = viewCenter.x - photoW / 2;
  const y = viewCenter.y - height / 2;

  const displayName = targetScene.navName || targetScene.name || "Unknown Location";
  const imagePath = targetScene.background?.src || "modules/investigation-board/assets/placeholder.webp";

  const boardMode = game.settings.get(MODULE_ID, "boardMode");
  const extraFlags = { image: imagePath };

  if (boardMode === "futuristic") {
    extraFlags.identityName = displayName;
  }

  const created = await collaborativeCreate({
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
        linkedObject: `@UUID[${targetScene.uuid}]{${displayName}}`,
        ...extraFlags
      },
      core: { sheetClass: "investigation-board.CustomDrawingSheet" }
    },
    ownership: { default: 3 }
  }, { skipAutoOpen: true });

  if (InvestigationBoardState.isActive && created?.[0]) {
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
 * Creates a Handout Note from a Journal Page.
 * @param {JournalEntryPage} page - The Journal Page document
 */
export async function createHandoutNoteFromPage(page) {
  const scene = canvas.scene;
  if (!scene) {
    ui.notifications.error("Cannot create note: No active scene.");
    return;
  }

  const handoutW = game.settings.get(MODULE_ID, "handoutNoteWidth") || 400;
  const handoutH = game.settings.get(MODULE_ID, "handoutNoteHeight") || 400;

  const viewCenter = canvas.stage.pivot;
  const x = viewCenter.x - handoutW / 2;
  const y = viewCenter.y - handoutH / 2;

  const imagePath = page.src || "modules/investigation-board/assets/newhandout.webp";

  // Attempt to get natural dimensions for better initial sizing
  let finalWidth = handoutW;
  let finalHeight = handoutH;
  try {
    const texture = await PIXI.Assets.load(imagePath);
    if (texture) {
      finalWidth = texture.width;
      finalHeight = texture.height;

      // Apply caps similar to FilePicker callback in CustomDrawingSheet
      if (finalHeight > 1000) {
        const scale = 1000 / finalHeight;
        finalWidth = Math.round(finalWidth * scale);
        finalHeight = 1000;
      }
      if (finalWidth > 2000) {
        const scale = 2000 / finalWidth;
        finalHeight = Math.round(finalHeight * scale);
        finalWidth = 2000;
      }
    }
  } catch (err) {
    console.error("Investigation Board: Failed to get image dimensions for handout", err);
  }

  const created = await collaborativeCreate({
    type: "r",
    author: game.user.id,
    x, y,
    shape: { width: finalWidth, height: finalHeight },
    fillColor: "#000000",
    fillAlpha: 0,
    strokeColor: "#000000",
    strokeWidth: 0,
    strokeAlpha: 0,
    locked: false,
    flags: {
      [MODULE_ID]: {
        type: "handout",
        text: "",
        linkedObject: `@UUID[${page.uuid}]{${page.name}}`,
        image: imagePath
      },
      core: { sheetClass: "investigation-board.CustomDrawingSheet" }
    },
    ownership: { default: 3 }
  }, { skipAutoOpen: true });

  if (InvestigationBoardState.isActive && created?.[0]) {
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
 * Creates a Media Note from a PlaylistSound.
 * @param {PlaylistSound} sound - The sound document
 */
export async function createMediaNoteFromSound(sound) {
  const scene = canvas.scene;
  if (!scene) {
    ui.notifications.error("Cannot create note: No active scene.");
    return;
  }

  const mediaW = 400;
  const height = Math.round(mediaW * 0.74);

  const viewCenter = canvas.stage.pivot;
  const x = viewCenter.x - mediaW / 2;
  const y = viewCenter.y - height / 2;

  const imagePath = await _getRandomCassetteImage();

  const created = await collaborativeCreate({
    type: "r",
    author: game.user.id,
    x, y,
    shape: { width: mediaW, height },
    fillColor: "#000000",
    fillAlpha: 0,
    strokeColor: "#000000",
    strokeWidth: 0,
    strokeAlpha: 0,
    locked: false,
    flags: {
      [MODULE_ID]: {
        type: "media",
        text: sound.name,
        image: imagePath,
        audioPath: sound.path,
        linkedObject: `@UUID[${sound.uuid}]{${sound.name}}`
      },
      core: { sheetClass: "investigation-board.CustomDrawingSheet" }
    },
    ownership: { default: 3 }
  }, { skipAutoOpen: true });

  if (InvestigationBoardState.isActive && created?.[0]) {
    setTimeout(() => {
      const newDrawing = canvas.drawings.get(created[0].id);
      if (newDrawing) {
        newDrawing.eventMode = 'auto';
        newDrawing.interactiveChildren = true;
      }
    }, 250);
  }
}
