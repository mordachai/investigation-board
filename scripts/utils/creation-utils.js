import { MODULE_ID, CASSETTE_IMAGES, VIDEO_IMAGES } from "../config.js";
import { InvestigationBoardState } from "../state.js";
import { getActorDisplayName, getEffectiveScale } from "./helpers.js";
import { collaborativeCreate, collaborativeCreateMany } from "./socket-handler.js";

/** Returns a random cassette sprite path for an audio media note. */
export function getRandomCassetteImage() {
  const name = CASSETTE_IMAGES[Math.floor(Math.random() * CASSETTE_IMAGES.length)];
  return `modules/investigation-board/assets/${name}`;
}

/** Returns a random VHS tape sprite path for a video media note. */
export function getRandomVideoImage() {
  const name = VIDEO_IMAGES[Math.floor(Math.random() * VIDEO_IMAGES.length)];
  return `modules/investigation-board/assets/${name}`;
}

export async function createNote(noteType, { x = null, y = null } = {}) {
  const scene = canvas.scene;
  if (!scene) {
    console.error("Cannot create note: No active scene.");
    return;
  }

  const sceneScale = getEffectiveScale();

  // Retrieve width settings (or use defaults)
  const stickyW = game.settings.get(MODULE_ID, "stickyNoteWidth") || 200;
  const photoW = game.settings.get(MODULE_ID, "photoNoteWidth") || 225;
  const indexW = game.settings.get(MODULE_ID, "indexNoteWidth") || 600;
  const handoutW = game.settings.get(MODULE_ID, "handoutNoteWidth") || 400;
  const handoutH = game.settings.get(MODULE_ID, "handoutNoteHeight") || 400;
  const mediaW = 400;
  const pinW = 40;

  const width = noteType === "photo" ? photoW
                : noteType === "index" ? indexW
                : noteType === "handout" ? handoutW
                : noteType === "media" ? mediaW
                : noteType === "pin" ? pinW
                : stickyW;
  // Media notes start as audio (cassette) by default; height updates if user sets a videoPath
  const height = noteType === "photo" ? Math.round(photoW / (225 / 290))
                 : noteType === "index" ? Math.round(indexW / (600 / 400))
                 : noteType === "handout" ? handoutH
                 : noteType === "media" ? Math.round(mediaW * 0.74)
                 : noteType === "pin" ? pinW
                 : stickyW;

  // Final coordinates
  let finalX = x;
  let finalY = y;

  if (finalX === null || finalY === null) {
    const viewCenter = canvas.stage.pivot;

    // Cascade offset: each existing IB note shifts the new one diagonally so notes
    // don't stack. Step size is 15% of the note's own dimensions, capped at 80 world
    // units per step, cycling every 6 notes back to the centre.
    const existingCount = canvas.drawings.placeables.filter(
      d => d.document.flags[MODULE_ID]?.type
    ).length;
    const cascadeStep = existingCount % 6;
    const stepX = Math.min(Math.round(width * 0.15), 80);
    const stepY = Math.min(Math.round(height * 0.15), 80);

    finalX = viewCenter.x - (width * sceneScale) / 2 + cascadeStep * stepX;
    finalY = viewCenter.y - (height * sceneScale) / 2 + cascadeStep * stepY;
  }

  // Get default text from settings (fallback if missing)
  const defaultText = (noteType === "handout" || noteType === "pin")
                    ? ""
                    : (game.settings.get(MODULE_ID, `${noteType}NoteDefaultText`) || "Notes");

  const extraFlags = {};
  
  // Apply default colors from settings
  if (noteType !== "handout" && noteType !== "pin") {
    extraFlags.tint = game.settings.get(MODULE_ID, "defaultNoteColor") || "#ffffff";
    extraFlags.textColor = game.settings.get(MODULE_ID, "defaultInkColor") || "#000000";
  }

  // Set default font size to 9 for index cards
  if (noteType === "index") {
    extraFlags.fontSize = 9;
  }

  // Set default image for handout notes
  if (noteType === "handout") {
    extraFlags.image = "modules/investigation-board/assets/newhandout.webp";
  }

  // Set default image for media notes (audio/cassette default; swaps to VHS when videoPath is set)
  if (noteType === "media") {
    extraFlags.image = getRandomCassetteImage();
    extraFlags.audioPath = "";
  }

  const created = await collaborativeCreate({
    type: "r",
    author: game.user.id,
    x: finalX,
    y: finalY,
    shape: { width, height },
    fillColor: noteType === "handout" || noteType === "media" || noteType === "pin" ? "#000000" : "#ffffff",
    fillAlpha: noteType === "handout" || noteType === "media" || noteType === "pin" ? 0.001 : 1,
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
  }, { skipAutoOpen: noteType === "pin" });

  // If in Investigation Board mode, ensure the new drawing is interactive
  if (InvestigationBoardState.isActive && created && created[0]) {
    // Wait for rendering to complete
    setTimeout(() => {
      const newDrawing = canvas.drawings.get(created[0].id);
      if (newDrawing) {
        newDrawing.eventMode = 'auto';
        newDrawing.interactiveChildren = true;
      }
    }, 250);
  }

  // Switch back to select tool so user can immediately manipulate the note
  if (InvestigationBoardState.isActive && ui.controls) {
    ui.controls.activate({ control: "drawings", tool: "select" });
  }

  return created?.[0];
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
    displayName = "???";
  }

  const imagePath = actor.img || "modules/investigation-board/assets/placeholder.webp";
  const extraFlags = {
    image: imagePath,
    textColor: game.settings.get(MODULE_ID, "defaultInkColor") || "#000000",
    ...(isUnknown ? { unknown: true } : {})
  };

  const photoW = game.settings.get(MODULE_ID, "photoNoteWidth") || 225;
  const height = Math.round(photoW / (225 / 290));
  const sceneScale = getEffectiveScale();

  const viewCenter = canvas.stage.pivot;
  const x = viewCenter.x - (photoW * sceneScale) / 2;
  const y = viewCenter.y - (height * sceneScale) / 2;

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
  const sceneScale = getEffectiveScale();

  const viewCenter = canvas.stage.pivot;
  const x = viewCenter.x - (photoW * sceneScale) / 2;
  const y = viewCenter.y - (height * sceneScale) / 2;

  const displayName = targetScene.navName || targetScene.name || "Unknown Location";
  const imagePath = targetScene.background?.src || "modules/investigation-board/assets/placeholder.webp";

  const extraFlags = { 
    image: imagePath,
    textColor: game.settings.get(MODULE_ID, "defaultInkColor") || "#000000"
  };

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
  const sceneScale = getEffectiveScale();

  const viewCenter = canvas.stage.pivot;
  const x = viewCenter.x - (handoutW * sceneScale) / 2;
  const y = viewCenter.y - (handoutH * sceneScale) / 2;

  const imagePath = page.src || "modules/investigation-board/assets/newhandout.webp";

  // Attempt to get natural dimensions for better initial sizing
  let finalWidth = handoutW;
  let finalHeight = handoutH;
  try {
    const texture = await PIXI.Assets.load(imagePath);
    if (texture) {
      finalWidth = texture.width;
      finalHeight = texture.height;

      // Apply 500px height cap
      if (finalHeight > 500) {
        const scale = 500 / finalHeight;
        finalWidth = Math.round(finalWidth * scale);
        finalHeight = 500;
      }
      // Apply 500px width cap
      if (finalWidth > 500) {
        const scale = 500 / finalWidth;
        finalHeight = Math.round(finalHeight * scale);
        finalWidth = 500;
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
 * Creates a Photo Note from a PlaylistSound.
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
  const sceneScale = getEffectiveScale();

  const viewCenter = canvas.stage.pivot;
  const x = viewCenter.x - (mediaW * sceneScale) / 2;
  const y = viewCenter.y - (height * sceneScale) / 2;

  const created = await collaborativeCreate({
    type: "r",
    author: game.user.id,
    x, y,
    shape: { width: mediaW, height },
    fillColor: "#000000",
    fillAlpha: 0.001,
    strokeColor: "#000000",
    strokeWidth: 0,
    strokeAlpha: 0,
    locked: false,
    flags: {
      [MODULE_ID]: {
        type: "media",
        text: sound.name,
        image: getRandomCassetteImage(),
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

/**
 * Creates a Photo Note from an Item document.
 * @param {Item} item - The Item document to use
 */
export async function createPhotoNoteFromItem(item) {
  const scene = canvas.scene;
  if (!scene) {
    ui.notifications.error("Cannot create note: No active scene.");
    return;
  }

  const photoW = game.settings.get(MODULE_ID, "photoNoteWidth") || 225;
  const height = Math.round(photoW / (225 / 290));
  const sceneScale = getEffectiveScale();

  const viewCenter = canvas.stage.pivot;
  const x = viewCenter.x - (photoW * sceneScale) / 2;
  const y = viewCenter.y - (height * sceneScale) / 2;

  const displayName = item.name || "Unknown Item";
  const imagePath = item.img || "modules/investigation-board/assets/placeholder.webp";

  const extraFlags = { 
    image: imagePath,
    textColor: game.settings.get(MODULE_ID, "defaultInkColor") || "#000000"
  };

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
        linkedObject: `@UUID[${item.uuid}]{${displayName}}`,
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
 * Imports all documents from a folder as notes (Top level only).
 * @param {Folder} folder - The folder to import
 */
export async function importFolderAsNotes(folder) {
  const type = folder.type; // "Actor", "Item", "Scene", "Playlist"
  
  // Get documents from top level only
  let documents = [];
  if (type === "Playlist") {
    // folder.contents contains Playlist documents, we want the sounds
    for (let playlist of folder.contents) {
      documents.push(...playlist.sounds);
    }
  } else {
    documents.push(...folder.contents);
  }

  if (documents.length === 0) {
    ui.notifications.warn(`Investigation Board: No ${type === "Playlist" ? "sounds" : "items"} found in folder "${folder.name}".`);
    return;
  }

  // Application V2 Dialog for confirmation with optional checkbox for lo-fi
  const isPlaylistFolder = type === "Playlist";
  
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: `Bulk Import: ${folder.name}` },
    content: `
      <p>Do you want to import all <b>${documents.length}</b> ${isPlaylistFolder ? "sounds" : "items"} from the folder "<b>${folder.name}</b>" as investigation notes?</p>
      ${isPlaylistFolder ? `
        <div class="form-group" style="margin-top: 10px;">
          <label class="checkbox">
            <input type="checkbox" name="applyLoFi" checked> Apply lo-fi sound effects to all
          </label>
        </div>
      ` : ""}
      <p>They will be placed in a grid starting from the center of the screen.</p>
    `,
    classes: ["investigation-board-dialog"],
    buttons: [{
      action: "import",
      label: "Import",
      default: true,
      callback: (event, button, dialog) => {
        const applyLoFi = isPlaylistFolder ? dialog.element.querySelector('input[name="applyLoFi"]')?.checked : false;
        return {
          confirmed: true,
          applyLoFi: applyLoFi
        };
      }
    }, {
      action: "cancel",
      label: "Cancel",
      callback: () => ({ confirmed: false })
    }],
    rejectClose: false,
    modal: true
  });

  if (!result || !result.confirmed) return;
  const applyLoFi = result.applyLoFi;

  const photoW = game.settings.get(MODULE_ID, "photoNoteWidth") || 225;
  const photoH = Math.round(photoW / (225 / 290));
  const mediaW = 400;
  const mediaH = Math.round(mediaW * 0.74);
  const sceneScale = getEffectiveScale();

  const viewCenter = canvas.stage.pivot;
  const startX = viewCenter.x - (photoW * sceneScale) / 2;
  const startY = viewCenter.y - (photoH * sceneScale) / 2;

  const cols = Math.ceil(Math.sqrt(documents.length));
  const spacing = 40;

  const createDataArray = [];
  
  // No pre-fetch needed — getRandomCassetteImage() is now synchronous
  const cassetteImages = [];

  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    
    let width = photoW;
    let height = photoH;
    if (type === "Playlist") {
      width = mediaW;
      height = mediaH;
    }

    const x = startX + col * (width + spacing);
    const y = startY + row * (height + spacing);

    let noteData = null;
    const defaultTint = game.settings.get(MODULE_ID, "defaultNoteColor") || "#ffffff";
    const defaultInk = game.settings.get(MODULE_ID, "defaultInkColor") || "#000000";

    if (type === "Actor") {
      const displayName = getActorDisplayName(doc);
      const imagePath = doc.img || "modules/investigation-board/assets/placeholder.webp";
      noteData = {
        type: "photo",
        text: displayName,
        linkedObject: `@UUID[${doc.uuid}]{${displayName}}`,
        image: imagePath,
        textColor: defaultInk,
        tint: "#ffffff"
      };
    } else if (type === "Item") {
      const displayName = doc.name || "Unknown Item";
      const imagePath = doc.img || "modules/investigation-board/assets/placeholder.webp";
      noteData = {
        type: "photo",
        text: displayName,
        linkedObject: `@UUID[${doc.uuid}]{${displayName}}`,
        image: imagePath,
        textColor: defaultInk,
        tint: "#ffffff"
      };
    } else if (type === "Scene") {
      const displayName = doc.navName || doc.name || "Unknown Location";
      const imagePath = doc.background?.src || "modules/investigation-board/assets/placeholder.webp";
      noteData = {
        type: "photo",
        text: displayName,
        linkedObject: `@UUID[${doc.uuid}]{${displayName}}`,
        image: imagePath,
        textColor: defaultInk,
        tint: "#ffffff"
      };
    } else if (type === "Playlist") { // doc is a PlaylistSound
      noteData = {
        type: "media",
        text: doc.name,
        image: getRandomCassetteImage(),
        audioPath: doc.path,
        linkedObject: `@UUID[${doc.uuid}]{${doc.name}}`,
        audioEffectEnabled: applyLoFi,
        textColor: defaultInk
      };
    }

    if (noteData) {
      createDataArray.push({
        type: "r",
        author: game.user.id,
        x, y,
        shape: { width, height },
        fillColor: type === "Playlist" ? "#000000" : "#ffffff",
        fillAlpha: type === "Playlist" ? 0 : 1,
        strokeColor: "#000000",
        strokeWidth: 0,
        strokeAlpha: 0,
        locked: false,
        flags: {
          [MODULE_ID]: noteData,
          core: { sheetClass: "investigation-board.CustomDrawingSheet" }
        },
        ownership: { default: 3 }
      });
    }
  }

  if (createDataArray.length > 0) {
    await collaborativeCreateMany(createDataArray, { skipAutoOpen: true });
    ui.notifications.info(`Investigation Board: Successfully imported ${createDataArray.length} notes.`);
  }
}

/**
 * Imports all sounds from a Playlist document as notes.
 * @param {Playlist} playlist - The playlist to import
 */
export async function importPlaylistAsNotes(playlist) {
  const documents = playlist.sounds.contents;

  if (documents.length === 0) {
    ui.notifications.warn(`Investigation Board: No sounds found in playlist "${playlist.name}".`);
    return;
  }

  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: `Bulk Import: ${playlist.name}` },
    content: `
      <p>Do you want to import all <b>${documents.length}</b> sounds from the playlist "<b>${playlist.name}</b>" as investigation notes?</p>
      <div class="form-group" style="margin-top: 10px;">
        <label class="checkbox">
          <input type="checkbox" name="applyLoFi" checked> Apply lo-fi sound effects to all
        </label>
      </div>
      <p>They will be placed in a grid starting from the center of the screen.</p>
    `,
    classes: ["investigation-board-dialog"],
    buttons: [{
      action: "import",
      label: "Import",
      default: true,
      callback: (event, button, dialog) => {
        return {
          confirmed: true,
          applyLoFi: dialog.element.querySelector('input[name="applyLoFi"]')?.checked
        };
      }
    }, {
      action: "cancel",
      label: "Cancel",
      callback: () => ({ confirmed: false })
    }],
    rejectClose: false,
    modal: true
  });

  if (!result || !result.confirmed) return;
  const applyLoFi = result.applyLoFi;

  const mediaW = 400;
  const mediaH = Math.round(mediaW * 0.74);
  const sceneScale = getEffectiveScale();

  const viewCenter = canvas.stage.pivot;
  const startX = viewCenter.x - (mediaW * sceneScale) / 2;
  const startY = viewCenter.y - (mediaH * sceneScale) / 2;

  const cols = Math.ceil(Math.sqrt(documents.length));
  const spacing = 40;

  const createDataArray = [];
  const defaultInk = game.settings.get(MODULE_ID, "defaultInkColor") || "#000000";

  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    const col = i % cols;
    const row = Math.floor(i / cols);

    const x = startX + col * (mediaW + spacing);
    const y = startY + row * (mediaH + spacing);

    const noteData = {
      type: "media",
      text: doc.name,
      image: getRandomCassetteImage(),
      audioPath: doc.path,
      linkedObject: `@UUID[${doc.uuid}]{${doc.name}}`,
      audioEffectEnabled: applyLoFi,
      textColor: defaultInk
    };

    createDataArray.push({
      type: "r",
      author: game.user.id,
      x, y,
      shape: { width: mediaW, height: mediaH },
      fillColor: "#000000",
      fillAlpha: 0,
      strokeColor: "#000000",
      strokeWidth: 0,
      strokeAlpha: 0,
      locked: false,
      flags: {
        [MODULE_ID]: noteData,
        core: { sheetClass: "investigation-board.CustomDrawingSheet" }
      },
      ownership: { default: 3 }
    });
  }

  if (createDataArray.length > 0) {
    await collaborativeCreateMany(createDataArray, { skipAutoOpen: true });
    ui.notifications.info(`Investigation Board: Successfully imported ${createDataArray.length} notes.`);
  }
}

/**
 * Creates a Handout Note from a raw image path (e.g. uploaded from clipboard or drag-drop).
 * @param {string} imagePath - The path to the uploaded image
 * @param {object} [options]
 * @param {number|null} [options.x] - Canvas world X to center the note on. Defaults to viewport center.
 * @param {number|null} [options.y] - Canvas world Y to center the note on. Defaults to viewport center.
 */
export async function createHandoutNoteFromImage(imagePath, { x: dropX = null, y: dropY = null } = {}) {
  const scene = canvas.scene;
  if (!scene) {
    ui.notifications.error("Cannot create note: No active scene.");
    return;
  }

  const handoutW = game.settings.get(MODULE_ID, "handoutNoteWidth") || 400;
  const handoutH = game.settings.get(MODULE_ID, "handoutNoteHeight") || 400;
  const sceneScale = getEffectiveScale();

  // Attempt to get natural dimensions for better initial sizing
  let finalWidth = handoutW;
  let finalHeight = handoutH;
  try {
    const texture = await PIXI.Assets.load(imagePath);
    if (texture) {
      finalWidth = texture.width;
      finalHeight = texture.height;

      // Apply 500px height cap
      if (finalHeight > 500) {
        const scale = 500 / finalHeight;
        finalWidth = Math.round(finalWidth * scale);
        finalHeight = 500;
      }
      // Apply 500px width cap
      if (finalWidth > 500) {
        const scale = 500 / finalWidth;
        finalHeight = Math.round(finalHeight * scale);
        finalWidth = 500;
      }
    }
  } catch (err) {
    console.error("Investigation Board: Failed to get image dimensions for handout", err);
  }

  // Center the note on the drop point, or fall back to viewport center
  let x, y;
  if (dropX !== null && dropY !== null) {
    x = dropX - (finalWidth * sceneScale) / 2;
    y = dropY - (finalHeight * sceneScale) / 2;
  } else {
    const viewCenter = canvas.stage.pivot;
    x = viewCenter.x - (finalWidth * sceneScale) / 2;
    y = viewCenter.y - (finalHeight * sceneScale) / 2;
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
        linkedObject: "",
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


