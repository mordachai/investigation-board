import { MODULE_ID, CASSETTE_IMAGES, VIDEO_IMAGES, DOC_BACKGROUNDS, FONTS } from "../config.js";
import { InvestigationBoardState } from "../state.js";
import { getActorDisplayName, getEffectiveScale } from "./helpers.js";
import { collaborativeCreate, collaborativeCreateMany } from "./socket-handler.js";

/**
 * Strips HTML tags from journal page content, preserving paragraph breaks.
 * Used for index card notes where plain PIXI.Text is sufficient.
 * @param {string} html
 * @returns {string}
 */
function stripHtml(html) {
  const withBreaks = html
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(h[1-6]|li|div|blockquote|tr)[^>]*>/gi, '\n');
  const div = document.createElement('div');
  div.innerHTML = withBreaks;
  return (div.textContent || div.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Converts journal page HTML into PIXI.HTMLText-safe markup.
 * Keeps bold, italic, underline, strikethrough, paragraph breaks, and text alignment.
 * Converts headings, blockquotes, and list items into supported equivalents.
 * @param {string} html
 * @returns {string}
 */
function sanitizeForPixiHtml(html) {
  if (!html) return "";
  // <p> block elements work correctly when HTMLTextStyle is used — it sets the
  // SVG foreignObject width so block content wraps within the note margin.
  // text-align is preserved on <p> tags for justification support.
  let s = html
    // headings → bold paragraph
    .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, '<p><b>$1</b></p>')
    // blockquotes → italic paragraph
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, '<p><i>$1</i></p>')
    // list items → bullet paragraph
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '<p>• $1</p>')
    // strip list wrappers
    .replace(/<\/?(ul|ol)[^>]*>/gi, '')
    // figure captions → italic paragraph
    .replace(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/gi, '<p><i>$1</i></p>')
    // preserve only text-align from <p> style attributes, strip everything else
    .replace(/<p([^>]*)>/gi, (_, attrs) => {
      const m = attrs.match(/text-align\s*:\s*(left|center|right|justify)/i);
      return m ? `<p style="text-align:${m[1]}">` : '<p>';
    })
    // remove images, figures, links (keep text), table structure
    .replace(/<img[^>]*\/?>/gi, '')
    .replace(/<\/?figure[^>]*>/gi, '')
    .replace(/<a[^>]*>([\s\S]*?)<\/a>/gi, '$1')
    .replace(/<td[^>]*>([\s\S]*?)<\/td>/gi, '$1 ')
    .replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, '<p>$1</p>')
    .replace(/<\/?(?:table|thead|tbody|tfoot|th|caption)[^>]*>/gi, '')
    // strip div/section wrappers
    .replace(/<\/?(div|section|article)[^>]*>/gi, '');

  // Strip non-whitelisted tags; <p> is included so text-align survives
  s = s.replace(/<(?!\/?(?:b|strong|i|em|u|s|strike|br|p|span|font)\b)[^>]+>/gi, '');

  return s.trim();
}

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

/**
 * Single source of truth for a note type's default width/height. Sticky/photo/index/
 * handout widths come from settings (with a hardcoded fallback); media/pin/document
 * have no configurable width setting and are always fixed-size.
 * @param {string} noteType
 * @returns {{width: number, height: number}}
 */
export function getNoteDimensions(noteType) {
  const stickyW  = game.settings.get(MODULE_ID, "stickyNoteWidth") || 200;
  const photoW   = game.settings.get(MODULE_ID, "photoNoteWidth") || 225;
  const indexW   = game.settings.get(MODULE_ID, "indexNoteWidth") || 600;
  const handoutW = game.settings.get(MODULE_ID, "handoutNoteWidth") || 400;
  const handoutH = game.settings.get(MODULE_ID, "handoutNoteHeight") || 400;

  switch (noteType) {
    case "photo":    return { width: photoW,   height: Math.round(photoW / (225 / 290)) };
    case "index":    return { width: indexW,   height: Math.round(indexW / (600 / 400)) };
    case "handout":  return { width: handoutW, height: handoutH };
    case "media":    return { width: 400,      height: Math.round(400 * 0.74) };
    case "pin":      return { width: 40,       height: 40 };
    case "document": return { width: 595,      height: 842 };
    default:         return { width: stickyW,  height: stickyW }; // sticky
  }
}

/**
 * Assembles the Drawing creation payload skeleton shared by every "create a note"
 * helper: author, shape, stroke (always invisible), lock state, and flag wrapping.
 * Callers supply the parts that actually vary between note types/sources.
 * @param {object} opts
 * @param {number} opts.x
 * @param {number} opts.y
 * @param {number} opts.width
 * @param {number} opts.height
 * @param {string} opts.fillColor
 * @param {number} opts.fillAlpha
 * @param {object} opts.flags - Contents of flags[MODULE_ID] (type, text, etc.)
 */
function buildNoteCreateData({ x, y, width, height, fillColor, fillAlpha, flags }) {
  return {
    type: "r",
    author: game.user.id,
    x, y,
    shape: { width, height },
    fillColor,
    fillAlpha,
    strokeColor: "#000000",
    strokeWidth: 0,
    strokeAlpha: 0,
    locked: false,
    flags: {
      [MODULE_ID]: flags,
      core: { sheetClass: "investigation-board.CustomDrawingSheet" }
    },
  };
}

/**
 * After a note is created while Investigation Board mode is active, Foundry's default
 * interactivity settles a beat after render — force it interactive once that settles.
 * @param {Array} created - Result of collaborativeCreate() (array of created docs, or empty)
 */
function postCreateFixup(created) {
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

export async function createNote(noteType, { x = null, y = null } = {}) {
  const scene = canvas.scene;
  if (!scene) {
    console.error("Cannot create note: No active scene.");
    return;
  }

  const sceneScale = getEffectiveScale();

  // Media notes start as audio (cassette) by default; height updates if user sets a videoPath
  const { width, height } = getNoteDimensions(noteType);

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
  const defaultText = (noteType === "handout" || noteType === "pin" || noteType === "document")
                    ? ""
                    : (game.settings.get(MODULE_ID, `${noteType}NoteDefaultText`) || "Notes");

  const extraFlags = {};

  // Apply default colors from settings
  if (noteType !== "handout" && noteType !== "pin") {
    if (noteType !== "document") {
      extraFlags.tint = game.settings.get(MODULE_ID, "defaultNoteColor") || "#ffffff";
    }
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

  // Set default background for document notes
  if (noteType === "document") {
    extraFlags.docBackground = "parchment";
    extraFlags.title = "";
  }

  // Set default image for media notes (audio/cassette default; swaps to VHS when videoPath is set)
  if (noteType === "media") {
    extraFlags.image = getRandomCassetteImage();
    extraFlags.audioPath = "";
    // Pin starts as Auto (audio mode). Switches to "none" when user toggles to video.
  }

  const created = await collaborativeCreate(buildNoteCreateData({
    x: finalX,
    y: finalY,
    width, height,
    fillColor: "#000000",
    fillAlpha: (noteType === "handout" || noteType === "media" || noteType === "pin") ? 0.001 : 1,
    flags: {
      type: noteType,
      text: defaultText,
      linkedObject: "",
      ...extraFlags
    },
  }), { skipAutoOpen: noteType === "pin" });

  postCreateFixup(created);

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

  const { width: photoW, height } = getNoteDimensions("photo");
  const sceneScale = getEffectiveScale();

  const viewCenter = canvas.stage.pivot;
  const x = viewCenter.x - (photoW * sceneScale) / 2;
  const y = viewCenter.y - (height * sceneScale) / 2;

  const created = await collaborativeCreate(buildNoteCreateData({
    x, y,
    width: photoW, height,
    fillColor: "#ffffff",
    fillAlpha: 1,
    flags: {
      type: "photo",
      text: displayName,
      linkedObject: `@UUID[${actor.uuid}]{${displayName}}`,
      ...extraFlags
    },
  }), { skipAutoOpen: true });

  postCreateFixup(created);
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

  const { width: photoW, height } = getNoteDimensions("photo");
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

  const created = await collaborativeCreate(buildNoteCreateData({
    x, y,
    width: photoW, height,
    fillColor: "#ffffff",
    fillAlpha: 1,
    flags: {
      type: "photo",
      text: displayName,
      linkedObject: `@UUID[${targetScene.uuid}]{${displayName}}`,
      ...extraFlags
    },
  }), { skipAutoOpen: true });

  postCreateFixup(created);
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

  const { width: handoutW, height: handoutH } = getNoteDimensions("handout");
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

  const created = await collaborativeCreate(buildNoteCreateData({
    x, y,
    width: finalWidth, height: finalHeight,
    fillColor: "#000000",
    fillAlpha: 0.001,
    flags: {
      type: "handout",
      text: "",
      linkedObject: `@UUID[${page.uuid}]{${page.name}}`,
      image: imagePath
    },
  }), { skipAutoOpen: true });

  postCreateFixup(created);
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

  const { width: mediaW, height } = getNoteDimensions("media");
  const sceneScale = getEffectiveScale();

  const viewCenter = canvas.stage.pivot;
  const x = viewCenter.x - (mediaW * sceneScale) / 2;
  const y = viewCenter.y - (height * sceneScale) / 2;

  const created = await collaborativeCreate(buildNoteCreateData({
    x, y,
    width: mediaW, height,
    fillColor: "#000000",
    fillAlpha: 0.001,
    flags: {
      type: "media",
      text: sound.name,
      image: getRandomCassetteImage(),
      audioPath: sound.path,
      linkedObject: `@UUID[${sound.uuid}]{${sound.name}}`
    },
  }), { skipAutoOpen: true });

  postCreateFixup(created);
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

  const { width: photoW, height } = getNoteDimensions("photo");
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

  const created = await collaborativeCreate(buildNoteCreateData({
    x, y,
    width: photoW, height,
    fillColor: "#ffffff",
    fillAlpha: 1,
    flags: {
      type: "photo",
      text: displayName,
      linkedObject: `@UUID[${item.uuid}]{${displayName}}`,
      ...extraFlags
    },
  }), { skipAutoOpen: true });

  postCreateFixup(created);
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

  const { width: photoW, height: photoH } = getNoteDimensions("photo");
  const { width: mediaW, height: mediaH } = getNoteDimensions("media");
  const sceneScale = getEffectiveScale();

  const viewCenter = canvas.stage.pivot;
  const startX = viewCenter.x - (photoW * sceneScale) / 2;
  const startY = viewCenter.y - (photoH * sceneScale) / 2;

  const cols = Math.ceil(Math.sqrt(documents.length));
  const spacing = 40;

  const createDataArray = [];

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
      createDataArray.push(buildNoteCreateData({
        x, y, width, height,
        fillColor: type === "Playlist" ? "#000000" : "#ffffff",
        fillAlpha: type === "Playlist" ? 0.001 : 1,
        flags: noteData,
      }));
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

  const { width: mediaW, height: mediaH } = getNoteDimensions("media");
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

    createDataArray.push(buildNoteCreateData({
      x, y,
      width: mediaW, height: mediaH,
      fillColor: "#000000",
      fillAlpha: 0.001,
      flags: {
        type: "media",
        text: doc.name,
        image: getRandomCassetteImage(),
        audioPath: doc.path,
        linkedObject: `@UUID[${doc.uuid}]{${doc.name}}`,
        audioEffectEnabled: applyLoFi,
        textColor: defaultInk
      },
    }));
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

  const { width: handoutW, height: handoutH } = getNoteDimensions("handout");
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

  const created = await collaborativeCreate(buildNoteCreateData({
    x, y,
    width: finalWidth, height: finalHeight,
    fillColor: "#000000",
    fillAlpha: 0.001,
    flags: {
      type: "handout",
      text: "",
      linkedObject: "",
      image: imagePath
    },
  }), { skipAutoOpen: true });

  postCreateFixup(created);
}

/**
 * Creates an Index Card note from a text-type Journal Page.
 * Strips HTML and prefixes the page title. Opens the edit dialog so the user
 * can trim/adjust the text before saving.
 * @param {JournalEntryPage} page
 */
export async function createTextIndexFromPage(page) {
  const scene = canvas.scene;
  if (!scene) { ui.notifications.error("Cannot create note: No active scene."); return; }

  const body = stripHtml(page.text?.content || "");
  const text = page.name ? `${page.name}\n\n${body}` : body;

  const { width: indexW, height: indexH } = getNoteDimensions("index");
  const sceneScale = getEffectiveScale();
  const viewCenter = canvas.stage.pivot;

  const created = await collaborativeCreate(buildNoteCreateData({
    x: viewCenter.x - (indexW * sceneScale) / 2,
    y: viewCenter.y - (indexH * sceneScale) / 2,
    width: indexW, height: indexH,
    fillColor: "#ffffff",
    fillAlpha: 1,
    flags: {
      type: "index",
      text,
      fontSize: 9,
      tint: game.settings.get(MODULE_ID, "defaultNoteColor") || "#ffffff",
      textColor: game.settings.get(MODULE_ID, "defaultInkColor") || "#000000",
      linkedObject: `@UUID[${page.uuid}]{${page.name}}`,
    },
  }));

  postCreateFixup(created);
}

// Rock Salt is the font the char-budget below was actually measured against
// (see splitHtmlIntoDocPages docstring) — every other font's width factor is
// expressed relative to it.
const DOC_PAGE_CALIBRATION_FONT = "Rock Salt";

/**
 * Splits sanitized PIXI.HTMLText markup into page-sized chunks.
 *
 * Uses a character-count heuristic. Two distinct bugs were found and fixed here —
 * don't re-introduce either by "recalibrating" against symptoms of the other:
 *
 * 1. PIXI.HTMLText silently clamps its rendered texture to maxWidth/maxHeight
 *    (default 2024px, in resolution-scaled pixels) and drops content beyond that
 *    with no error — on a high-DPI display this could corrupt/cut a page's text
 *    (mid-sentence) regardless of char budget. Fixed on `docBodyText` directly
 *    (maxWidth/maxHeight raised in `_doUpdateSprites`), not here.
 * 2. The char budget itself: the old "~2200 chars/page" figure was measured
 *    against continuous prose and badly overestimates real multi-paragraph
 *    journal content — each `<p>` (including header-derived ones; see
 *    sanitizeForPixiHtml) gets paragraph spacing the raw-character-count model
 *    doesn't account for, so paragraph-dense text runs out of room much earlier.
 *    BASE_CHARS below is calibrated against a real 11-paragraph/1650-char
 *    Rock-Salt-14pt sample, confirmed (after fixing bug 1) to cleanly fit exactly
 *    6 paragraphs / 899 raw chars on a titled first page — no more, no less.
 *
 * Paragraphs too long for a single page are split at sentence then word boundaries.
 *
 * @param {string} sanitizedHtml - Output of sanitizeForPixiHtml()
 * @param {object} opts
 * @param {string} opts.titleStr  - Title (only on page 1 — reduces usable height)
 * @param {number} opts.docW      - Note width in world units (595)
 * @param {number} opts.docH      - Note height in world units (842)
 * @param {number} opts.fontSize  - Body font size in pt (default 14)
 * @param {string} [opts.font]    - Body font family (defaults to the calibration font)
 * @returns {string[]}
 */
function splitHtmlIntoDocPages(sanitizedHtml, { titleStr, docW, docH, fontSize, font }) {
  const MARGIN = Math.round(docW * 0.105);
  const titleFontSize = Math.round((docW / 595) * 28);
  const bodyFontSize = Math.round((docW / 595) * Math.max(8, fontSize || 14));
  const titleAreaHeight = titleFontSize * 3;

  // Usable body heights
  const firstPageBodyH = docH - MARGIN - (titleStr ? titleAreaHeight + 20 : 0) - MARGIN;
  const otherPageBodyH = docH - MARGIN * 2;

  // Calibrated at 16 pt against Rock Salt (widthFactor 0.72) — scale inversely with
  // font size, and inversely with font width relative to the calibration font so a
  // narrower font (e.g. Arial, 0.55) gets proportionally more characters per page.
  const BASE_CHARS = 1000; // → 1000 chars/page at 16pt Rock Salt (800 on a titled first page);
                           // → 1143 chars/page at 14pt Rock Salt (914 on a titled first page)
  const calibrationFactor = FONTS.find(f => f.name === DOC_PAGE_CALIBRATION_FONT)?.widthFactor ?? 0.72;
  const fontFactor = FONTS.find(f => f.name === font)?.widthFactor ?? calibrationFactor;
  const widthAdjust = calibrationFactor / fontFactor;
  const scale = (16 / bodyFontSize) * widthAdjust;
  const charsPerPage   = Math.round(BASE_CHARS * scale);
  // First page: title adds visual weight at the top — use 80% to leave breathing room
  // at the bottom rather than the bare height ratio (~85.5%).
  const charsFirstPage = titleStr
    ? Math.round(charsPerPage * 0.80)
    : charsPerPage;

  // Extract <p>…</p> blocks as atomic chunks
  const rawChunks = [];
  const pRegex = /<p[^>]*>[\s\S]*?<\/p>/gi;
  let lastIdx = 0, pm;
  while ((pm = pRegex.exec(sanitizedHtml)) !== null) {
    const before = sanitizedHtml.slice(lastIdx, pm.index).trim();
    if (before) rawChunks.push(before);
    rawChunks.push(pm[0]);
    lastIdx = pm.index + pm[0].length;
  }
  const tail = sanitizedHtml.slice(lastIdx).trim();
  if (tail) rawChunks.push(tail);
  if (rawChunks.length === 0) return [sanitizedHtml];

  // Split a paragraph whose char count alone exceeds maxChars.
  // Splits at sentence boundaries (". Capital") first, then at words.
  function splitPara(paraHtml, maxChars) {
    const match = paraHtml.match(/^(<p[^>]*>)([\s\S]*?)(<\/p>)$/i);
    if (!match) return [paraHtml];
    const [, open, inner, close] = match;

    const bySentence = inner.split(/(?<=[.!?])\s+(?=[A-Z"'<(])/);
    const parts = bySentence.length > 1 ? bySentence : inner.split(/\s+/);
    if (parts.length <= 1) return [paraHtml];

    const result = [];
    let current = [];
    for (const part of parts) {
      current.push(part);
      if ((open + current.join(' ') + close).length > maxChars && current.length > 1) {
        current.pop();
        result.push(open + current.join(' ') + close);
        current = [part];
      }
    }
    if (current.length > 0) result.push(open + current.join(' ') + close);
    return result.length > 0 ? result : [paraHtml];
  }

  // Pre-expand any paragraph that alone exceeds a full page
  const chunks = [];
  for (const chunk of rawChunks) {
    if (chunk.length > charsPerPage) {
      chunks.push(...splitPara(chunk, charsPerPage));
    } else {
      chunks.push(chunk);
    }
  }

  // Fill pages — split mid-paragraph when a chunk straddles a page boundary
  const pages = [];
  let pageStart = 0;
  let isFirst = true;

  while (pageStart < chunks.length) {
    const limit = isFirst ? charsFirstPage : charsPerPage;
    let i = pageStart;
    let running = 0;

    while (i < chunks.length) {
      const chunkLen = chunks[i].length;
      if (running + chunkLen > limit) {
        // This chunk straddles the boundary. Try to split it so the fitting
        // portion stays on this page and the overflow goes to the next.
        const remaining = limit - running;
        if (remaining > 100 && chunks[i].match(/^<p/i)) {
          const sub = splitPara(chunks[i], remaining);
          if (sub.length > 1) {
            // Replace the chunk in-place: first sub goes on this page, rest next
            chunks.splice(i, 1, ...sub);
            // Include the first sub-chunk on this page
            running += chunks[i].length;
            i++;
          }
        }
        break;
      }
      running += chunkLen;
      i++;
    }

    if (i === pageStart) i = pageStart + 1; // always at least one chunk per page
    pages.push(chunks.slice(pageStart, i).join(''));
    pageStart = i;
    isFirst = false;
  }

  return pages.length > 0 ? pages : [sanitizedHtml];
}

/**
 * Creates a Document Note from a text-type Journal Page.
 * Title comes from the page name; body preserves bold/italic/alignment as PIXI.HTMLText markup.
 * If the text is too long for one page, multiple notes are created in a horizontal row.
 * @param {JournalEntryPage} page
 * @param {"parchment"|"oldpaper"|"whitepaper"} [background]
 */
export async function createDocNoteFromPage(page, background = "parchment") {
  const scene = canvas.scene;
  if (!scene) { ui.notifications.error("Cannot create note: No active scene."); return; }

  const body = sanitizeForPixiHtml(page.text?.content || "");
  const sceneScale = getEffectiveScale();
  const viewCenter = canvas.stage.pivot;
  const { width: docW, height: docH } = getNoteDimensions("document");
  const fontSize = 14;
  const titleStr = page.name || "";
  const textColor = game.settings.get(MODULE_ID, "defaultInkColor") || "#000000";
  // Notes created here don't set a per-note font override, so they render with
  // whatever the global default is — the pagination budget needs to match that.
  const font = game.settings.get(MODULE_ID, "font");

  const pageTexts = splitHtmlIntoDocPages(body, { titleStr, docW, docH, fontSize, font });

  if (pageTexts.length <= 1) {
    // Single page — original behaviour, opens edit dialog
    const created = await collaborativeCreate(buildNoteCreateData({
      x: viewCenter.x - (docW * sceneScale) / 2,
      y: viewCenter.y - (docH * sceneScale) / 2,
      width: docW, height: docH,
      fillColor: "#000000",
      fillAlpha: 1,
      flags: {
        type: "document",
        title: titleStr,
        text: body,
        docBackground: background,
        textColor,
        fontSize,
        linkedObject: `@UUID[${page.uuid}]{${page.name}}`,
      },
    }), { skipAutoOpen: false });

    postCreateFixup(created);
    return;
  }

  // Multiple pages — lay them out in a horizontal row centred on the viewport
  const spacing = 40;
  const totalWidth = docW * pageTexts.length + spacing * (pageTexts.length - 1);
  const startX = viewCenter.x - (totalWidth * sceneScale) / 2;
  const startY = viewCenter.y - (docH * sceneScale) / 2;

  const createDataArray = pageTexts.map((pageText, idx) => buildNoteCreateData({
    x: startX + idx * (docW + spacing),
    y: startY,
    width: docW, height: docH,
    fillColor: "#000000",
    fillAlpha: 1,
    flags: {
      type: "document",
      title: idx === 0 ? titleStr : "",
      text: pageText,
      docBackground: background,
      textColor,
      fontSize,
      linkedObject: `@UUID[${page.uuid}]{${page.name}}`,
    },
  }));

  await collaborativeCreateMany(createDataArray, { skipAutoOpen: true });
  ui.notifications.info(
    `Investigation Board: Created ${pageTexts.length} document pages from "${page.name}".`
  );
}


