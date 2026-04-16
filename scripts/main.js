import { MODULE_ID, SOCKET_NAME } from "./config.js";
import { InvestigationBoardState } from "./state.js";
import { registerSettings } from "./settings.js";
import { CustomDrawing } from "./canvas/custom-drawing.js";
import { CustomDrawingSheet } from "./apps/drawing-sheet.js";
import { 
  drawAllConnectionLines, 
  updatePins,
  cleanupConnectionLines, 
  resetPinConnectionState, 
  clearConnectionNumbers,
  clearConnectionPreview
} from "./canvas/connection-manager.js";
import { initSocket, socket, collaborativeUpdate } from "./utils/socket-handler.js";
import { SetupWarningDialog } from "./apps/setup-warning.js";
import { 
  createNote, 
  createPhotoNoteFromActor, 
  createPhotoNoteFromScene, 
  createPhotoNoteFromItem,
  createHandoutNoteFromPage, 
  createMediaNoteFromSound,
  createHandoutNoteFromImage,
  importFolderAsNotes,
  importPlaylistAsNotes
} from "./utils/creation-utils.js";

// v13 namespaced imports
const DocumentSheetConfig = foundry.applications.apps.DocumentSheetConfig;
const DrawingDocument = foundry.documents.DrawingDocument;
const FilePicker = foundry.applications.apps.FilePicker.implementation;

/**
 * Helper function to refresh interactive properties of all drawings
 */
function refreshDrawingsInteractivity() {
  if (!canvas.drawings) return;

  canvas.drawings.placeables.forEach(drawing => {
    const isInvestigationNote = drawing.document.flags[MODULE_ID];
    if (isInvestigationNote) {
      // Ensure investigation notes are interactive and selectable.
      // Use 'static' to ensure it receives events even if it's not "owned".
      drawing.eventMode = 'static';
      drawing.interactiveChildren = true;
      drawing.cursor = 'pointer';
    }
    // Non-IB drawings are left at their default Foundry state so they remain
    // selectable in draw mode. Forcing them to 'none' breaks the ability to
    // select or manipulate regular drawings while IB mode is active.
  });
}

/**
 * Activates Investigation Board mode - filters interactions to only investigation board notes
 */
function activateInvestigationBoardMode() {
  if (InvestigationBoardState.isActive) return;
  if (!canvas.drawings) {
    console.error("Investigation Board: drawings layer not available");
    return;
  }

  InvestigationBoardState.isActive = true;

  // Filter visible placeables using helper function
  refreshDrawingsInteractivity();

  // Add CSS class for visual styling
  document.body.classList.add("investigation-board-mode");
}

/**
 * Deactivates Investigation Board mode - restores normal drawing interactions
 */
function deactivateInvestigationBoardMode() {
  if (!InvestigationBoardState.isActive) return;

  InvestigationBoardState.isActive = false;

  // Clear pin connection state
  resetPinConnectionState();

  // Clear connection numbers
  clearConnectionNumbers();

  // Restore IB notes to default interactivity (non-IB drawings were never modified)
  if (canvas.drawings) {
    canvas.drawings.placeables.forEach(drawing => {
      const isInvestigationNote = drawing.document.flags[MODULE_ID];
      if (isInvestigationNote) {
        drawing.eventMode = 'auto';
        drawing.interactiveChildren = true;
        drawing.cursor = null;
      }
    });
  }

  // Remove CSS class
  document.body.classList.remove("investigation-board-mode");
}

/**
 * Robust helper to find a page and its journal from the context menu element
 */
function _getJournalPageFromLi(li) {
  const el = li instanceof HTMLElement ? li : li[0];
  if (!el) return null;

  // Try every possible ID attribute used in Foundry lists
  const pageId = el.dataset?.pageId || 
                 el.dataset?.documentId || 
                 el.dataset?.entryId || 
                 el.dataset?.id ||
                 el.getAttribute?.("data-page-id") ||
                 el.getAttribute?.("data-document-id") ||
                 el.getAttribute?.("data-id");
                 
  if (!pageId) return null;

  // Search through all journal entries for this page - most reliable way
  const journal = game.journal.find(j => j.pages.has(pageId));
  if (!journal) return null;

  return journal.pages.get(pageId);
}

/**
 * Robust helper to find a playlist sound from the context menu element
 */
function _getPlaylistSoundFromLi(li) {
  const el = li instanceof HTMLElement ? li : li[0];
  if (!el) return null;

  // Try various ID attributes used in v13
  const soundId = el.dataset.soundId || el.dataset.documentId || el.dataset.entryId || el.getAttribute("data-sound-id");
  
  if (!soundId) return null;

  // Search through all playlists to find the sound with this ID
  for (let playlist of game.playlists) {
    const sound = playlist.sounds.get(soundId);
    if (sound) return sound;
  }
  
  return null;
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

    controls.drawings.tools.createMediaNote = {
      name: "createMediaNote",
      title: "Create Media Note",
      icon: "fas fa-cassette-tape",
      onChange: () => createNote("media"),
      button: true
    };

    controls.drawings.tools.createPinOnly = {
      name: "createPinOnly",
      title: "Create Pin Only",
      icon: "fas fa-thumbtack",
      onChange: () => createNote("pin"),
      button: true
    };
  }
});

// Hook to handle Investigation Board mode activation/deactivation
Hooks.on("renderSceneControls", (controls, html) => {
  const activeControl = controls.control?.name;

  if (activeControl === "drawings") {
    activateInvestigationBoardMode();
  } else if (InvestigationBoardState.isActive) {
    deactivateInvestigationBoardMode();
  }
});

// Hook to handle dragging objects onto notes directly
Hooks.on("dropCanvasData", (canvas, data) => {
  if (!InvestigationBoardState.isActive) return true;
  if (!data.uuid) return true;

  // Find if we dropped on a drawing
  const drawingsLayer = canvas.drawings;
  const result = drawingsLayer.placeables.find(d => {
    const isInvestigationNote = d.document.flags[MODULE_ID];
    if (!isInvestigationNote) return false;

    const b = d.bounds;
    return (data.x >= b.x) && (data.x <= b.x + b.width) && (data.y >= b.y) && (data.y <= b.y + b.height);
  });

  if (result) {
    (async () => {
      const doc = await fromUuid(data.uuid);
      const link = doc ? `@UUID[${doc.uuid}]{${doc.name}}` : `@UUID[${data.uuid}]`;
      
      await collaborativeUpdate(result.document.id, {
        [`flags.${MODULE_ID}.linkedObject`]: link
      });
      ui.notifications.info(`Linked ${doc?.name || "object"} to note.`);
    })();
    return false; // Prevent default drop behavior
  }
  return true;
});

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
    if (event.key === "Escape") {
      resetPinConnectionState();
    }
  });

});

// Hook to initialize socket for collaborative editing
Hooks.once("ready", async () => {
  // Force-load module fonts so PIXI.Text can use them before the canvas renders.
  // CSS @font-face fonts load asynchronously — without this, PIXI falls back to
  // a system font if it tries to render text before the font download completes.
  const moduleFonts = ["Rock Salt", "Caveat", "Typewriter Condensed", "IB Special Elite"];
  await Promise.all(moduleFonts.map(f => document.fonts.load(`16px "${f}"`).catch(() => {})));

  initSocket();

  // Show setup warning to GM if enabled
  if (game.user.isGM && game.settings.get(MODULE_ID, "showSetupWarning")) {
    const users = game.users.filter(u => !u.isGM);
    const playerRoles = [...new Set(users.map(u => u.role))];
    if (playerRoles.length === 0) playerRoles.push(1);

    const drawingPerm = playerRoles.every(role => game.permissions.DRAWING_CREATE.includes(role));
    const browsePerm = playerRoles.every(role => game.permissions.FILES_BROWSE.includes(role));
    const uploadPerm = playerRoles.every(role => game.permissions.FILES_UPLOAD.includes(role));
    
    if (!drawingPerm || !browsePerm || !uploadPerm) {
      new SetupWarningDialog().render(true);
    }
  }

  // Paste Listener for Handout Notes
  document.addEventListener("paste", async (e) => {
    if (!InvestigationBoardState.isActive) return;

    // Ignore if focus is on an input element
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable) {
      return;
    }

    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.indexOf("image") !== -1) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;

        ui.notifications.info("Investigation Board: Processing clipboard image...");
        try {
          const path = await _uploadImageHandout(file, "pasted");
          if (path) {
            await createHandoutNoteFromImage(path);
            ui.notifications.info("Investigation Board: Created handout from clipboard.");
          }
        } catch (err) {
          console.error("Investigation Board: Paste failed", err);
          ui.notifications.warn("Investigation Board: Failed to upload pasted image. Check console for details.");
        }

        // Only handle the first image
        return;
      }
    }
  });

  // Drag-and-drop image listener — creates a handout note at the drop position.
  // Handles file drops (WhatsApp, Google Images, desktop) and URL-only drops (Discord web).
  // Attached to document (like the paste listener) so it works regardless of canvas init timing.
  document.addEventListener("dragover", (e) => {
    if (!InvestigationBoardState.isActive) return;
    if (e.target?.id !== "board") return; // only intercept drags over the game canvas
    if (!game.permissions.DRAWING_CREATE.includes(game.user.role)) return;

    const hasImageFile = [...e.dataTransfer.items].some(i => i.kind === "file" && i.type.startsWith("image/"));
    const hasUriList = e.dataTransfer.types.includes("text/uri-list");
    if (hasImageFile || hasUriList) e.preventDefault();
  });

  document.addEventListener("drop", async (e) => {
    if (!InvestigationBoardState.isActive) return;
    if (e.target?.id !== "board") return; // only intercept drags over the game canvas
    if (!game.permissions.DRAWING_CREATE.includes(game.user.role)) return;

    // Convert screen coordinates to canvas world coordinates
    const boardEl = e.target;
    const rect = boardEl.getBoundingClientRect();
    const worldPos = canvas.stage.toLocal(new PIXI.Point(e.clientX - rect.left, e.clientY - rect.top));

    // Priority 1: actual image file(s) in the drop (WhatsApp, Google Images, desktop)
    const imageFiles = [...e.dataTransfer.files].filter(f => f.type.startsWith("image/"));
    if (imageFiles.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      ui.notifications.info("Investigation Board: Processing dropped image...");
      try {
        const path = await _uploadImageHandout(imageFiles[0], "dropped");
        if (path) await createHandoutNoteFromImage(path, { x: worldPos.x, y: worldPos.y });
      } catch (err) {
        console.error("Investigation Board: Drop failed", err);
        ui.notifications.warn("Investigation Board: Failed to upload dropped image. Check console for details.");
      }
      return;
    }

    // Priority 2: URL-only drop (Discord web, links from browser tabs)
    const uriList = e.dataTransfer.getData("text/uri-list");
    if (!uriList) return;

    const url = uriList.split("\n").map(u => u.trim()).find(u => u && !u.startsWith("#"));
    if (!url) return;

    // Only treat it as an image if the URL path ends with a known image extension
    const imageExtPattern = /\.(png|jpe?g|gif|webp|avif|svg|bmp|tiff?)(\?.*)?$/i;
    if (!imageExtPattern.test(url)) return;

    e.preventDefault();
    e.stopPropagation();
    ui.notifications.info("Investigation Board: Fetching dropped image URL...");
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const ext = (blob.type.split("/")[1] || "png").replace("jpeg", "jpg");
      const file = new File([blob], `dropped.${ext}`, { type: blob.type });
      const path = await _uploadImageHandout(file, "dropped");
      if (path) await createHandoutNoteFromImage(path, { x: worldPos.x, y: worldPos.y });
    } catch (err) {
      console.error("Investigation Board: Could not fetch image URL", err);
      ui.notifications.warn("Investigation Board: Couldn't download that image — try right-clicking it → Copy Image, then paste (Ctrl+V) instead.");
    }
  });
});

/**
 * Uploads an image File to assets/ib-handouts/ and returns the server path.
 * @param {File} file
 * @param {string} [prefix] - Filename prefix, e.g. "pasted" or "dropped"
 * @returns {Promise<string|null>}
 */
async function _uploadImageHandout(file, prefix = "handout") {
  const folderPath = "assets/ib-handouts";

  try { await FilePicker.browse("data", "assets"); }
  catch { await FilePicker.createDirectory("data", "assets"); }

  try { await FilePicker.browse("data", folderPath); }
  catch { await FilePicker.createDirectory("data", folderPath); }

  const timestamp = Date.now();
  const uniqueId = foundry.utils.randomID();
  let ext = "png";
  if (file.name && file.name.includes(".")) {
    ext = file.name.split(".").pop();
  } else if (file.type) {
    ext = (file.type.split("/")[1] || "png").replace("jpeg", "jpg");
  }
  const newFileName = `${prefix}_handout_${timestamp}_${uniqueId}.${ext}`;
  const renamedFile = new File([file], newFileName, { type: file.type });
  const response = await FilePicker.upload("data", folderPath, renamedFile, { fileName: newFileName });
  return response.path || null;
}

// Hook to intercept drawing creation to handle Copy/Paste logic
Hooks.on("preCreateDrawing", (drawing, data, options, userId) => {
  // Only affect Investigation Board notes
  if (!drawing.flags[MODULE_ID]) return;

  // If the creation does NOT have an ID (meaning it's a new unique creation, like Paste or New Tool)
  // AND it does NOT have our tool's signature flag...
  // Then it must be a manual Paste or Duplicate operation.
  if (!data._id && !options.ibCreation) {
    // 1. Clear connections so the new note doesn't point to old targets
    drawing.updateSource({ [`flags.${MODULE_ID}.connections`]: [] });

    // 2. Suppress the auto-open sheet behavior
    options.skipAutoOpen = true;
  }
});


// Hook to ensure newly created notes are interactive in Investigation Board mode
Hooks.on("createDrawing", (drawing, options, userId) => {
  // Check if this is an investigation board note
  const noteData = drawing.flags[MODULE_ID];
  if (!noteData) return;

  // Determine who should see the sheet: either the direct userId or the original requester via socket
  const requesterId = options.ibRequestingUser || userId;

  // If this is the user who created the note, open the edit dialog
  if (requesterId === game.user.id && !options.skipAutoOpen) {
    setTimeout(() => {
      // Calculate screen position to place dialog below the note
      const drawingObject = canvas.drawings.get(drawing.id);
      if (drawingObject) {
        const bounds = drawingObject.getBounds();
        // bounds are in screen coordinates (pixels)
        const top = bounds.bottom + 20; // 20px padding below the note
        const left = bounds.left + (bounds.width / 2) - 200; // Center horizontally (sheet width is 400)
        
        drawing.sheet.render(true, {
          position: {
            top: Math.max(0, top),
            left: Math.max(0, left)
          }
        });
      } else {
        drawing.sheet.render(true);
      }
    }, 250);
  }

  // If we're in Investigation Board mode, refresh interactivity after the drawing is rendered
  if (InvestigationBoardState.isActive) {
    // Wait for the drawing to be fully rendered on canvas
    setTimeout(() => {
      updatePins();
      refreshDrawingsInteractivity();
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
  }

  // Return false to prevent the normal update (socket will handle it)
  return false;
});

// Hook to prevent bulk deletion of investigation board notes
Hooks.on("preDeleteDrawing", (drawing, options, userId) => {
  // Check if this is an investigation board note
  const noteData = drawing.flags?.[MODULE_ID];
  if (!noteData?.type) return true;

  // Allow deletion if:
  // 1. The special ibDelete option is present (from our custom menus)
  // 2. The note is currently selected/controlled (from keyboard Delete key)
  const placeable = drawing.object || canvas.drawings.get(drawing.id);
  if (options.ibDelete || placeable?.controlled) return true;

  return false;
});

// Hook to redraw lines and refresh visuals when notes change
Hooks.on("updateDrawing", async (drawing, changes, options, userId) => {
  // Check if this is an investigation board note
  const noteData = drawing.flags[MODULE_ID];
  if (!noteData) return;

  const placeable = canvas.drawings.get(drawing.id);

  const flagsChanged = changes.flags?.[MODULE_ID] !== undefined;
  const shapeChanged = changes.shape !== undefined;

  // Refresh sprites when content or dimensions change.
  // For non-pin notes: check flags, explicit shape change, AND a sprite/document
  // dimension mismatch — the mismatch check is a reliable fallback in case
  // Foundry packages scale handle commits in a way that doesn't set changes.shape.
  if (placeable && noteData.type !== "pin") {
    let needsRefresh = flagsChanged || shapeChanged;

    if (!needsRefresh) {
      const docW = drawing.shape.width;
      const docH = drawing.shape.height;
      // bgSprite covers sticky/photo/index; photoImageSprite covers handout/media
      const sprite = placeable.bgSprite ?? placeable.photoImageSprite;
      if (sprite && (Math.abs(sprite.width - docW) > 5 || Math.abs(sprite.height - docH) > 5)) {
        needsRefresh = true;
      }
    }

    if (needsRefresh) {
      await placeable.refresh();

      // Re-render open NotePreviewer or VideoPlayer when note content changes
      if (flagsChanged) {
        const previewApp = foundry.applications.instances.get(`note-preview-${drawing.id}`);
        if (previewApp) previewApp.render();

        const videoApp = foundry.applications.instances.get(`video-player-${drawing.id}`);
        if (videoApp) videoApp.render();
      }
    }
  }

  // Redraw connection lines when position, shape, or connections change
  // Also refresh pins when hidden state changes (pins live in pinsContainer, outside the placeable hierarchy)
  if (changes.x !== undefined || changes.y !== undefined || flagsChanged || shapeChanged || changes.hidden !== undefined) {
    updatePins();
    drawAllConnectionLines();
  }
});

// Hook to redraw lines when notes are deleted
Hooks.on("deleteDrawing", (drawing, options, userId) => {
  // Check if this is an investigation board note
  const noteData = drawing.flags[MODULE_ID];
  if (!noteData) return;

  // Redraw pins and all connection lines to remove orphaned connections
  updatePins();
  drawAllConnectionLines();
});

/**
 * Robust helper to resolve a document from a context menu element
 */
async function _resolveDocumentFromLi(li, collection) {
  const el = li instanceof HTMLElement ? li : li[0];
  if (!el) return null;

  // v13 resolution is much more varied
  const target = el.closest(".directory-item") || el.closest(".document") || el.closest(".playlist") || el;
  
  // 1. Try UUID directly (most reliable in v13)
  const uuid = target.dataset.uuid || target.getAttribute("data-uuid");
  if (uuid) {
    return await fromUuid(uuid);
  }

  // 2. Try ID and Pack
  // v13 uses entryId or documentId often. Playlists sometimes use playlistId.
  const docId = target.dataset.documentId || 
                target.dataset.entryId || 
                target.dataset.id || 
                target.dataset.playlistId ||
                target.getAttribute("data-document-id") ||
                target.getAttribute("data-entry-id") ||
                target.getAttribute("data-id") ||
                target.getAttribute("data-playlist-id");

  const packName = target.closest("[data-pack]")?.dataset.pack || target.closest(".compendium")?.dataset.pack;

  if (docId) {
    // If we have a pack name, use it
    if (packName) {
      return await fromUuid(`Compendium.${packName}.${docId}`);
    }
    
    // Check local collection
    const localDoc = collection.get(docId);
    if (localDoc) return localDoc;

    // 3. Fallback: Search all relevant compendiums for this ID
    const type = collection.documentName;
    for (let pack of game.packs.filter(p => p.documentName === type)) {
      if (pack.index.has(docId)) {
        return await pack.getDocument(docId);
      }
    }
  }

  return null;
}

// Context menu hook for Actor directory
Hooks.on("getActorContextOptions", (app, entryOptions) => {
  entryOptions.push(
    {
      label: "Photo Note from Actor",
      icon: "fa-solid fa-camera-polaroid",
      onClick: async (event, li) => {
        const actor = await _resolveDocumentFromLi(li, game.actors);
        if (actor) await createPhotoNoteFromActor(actor, false);
        else ui.notifications.warn("Investigation Board: Could not resolve Actor.");
      }
    },
    {
      label: "Unknown Photo Note from Actor",
      icon: "fa-solid fa-camera-polaroid",
      onClick: async (event, li) => {
        const actor = await _resolveDocumentFromLi(li, game.actors);
        if (actor) await createPhotoNoteFromActor(actor, true);
        else ui.notifications.warn("Investigation Board: Could not resolve Actor.");
      }
    }
  );
});

// Context menu hook for Item directory
Hooks.on("getItemContextOptions", (app, entryOptions) => {
  entryOptions.push({
    label: "Photo Note from Item",
    icon: "fa-solid fa-camera-polaroid",
    onClick: async (event, li) => {
      const item = await _resolveDocumentFromLi(li, game.items);
      if (item) await createPhotoNoteFromItem(item);
      else ui.notifications.warn("Investigation Board: Could not resolve Item.");
    }
  });
});

// Context menu hook for Scene directory and Scene Navigation (both fire getSceneContextOptions in v14)
Hooks.on("getSceneContextOptions", (app, entryOptions) => {
  entryOptions.push({
    label: "Photo Note from Scene",
    icon: "fa-solid fa-camera-polaroid",
    onClick: async (event, li) => {
      const scene = await _resolveDocumentFromLi(li, game.scenes);
      if (scene) await createPhotoNoteFromScene(scene);
      else ui.notifications.warn("Investigation Board: Could not resolve Scene.");
    }
  });
});

// Context menu hook for Journal pages
Hooks.on("getJournalEntryPageContextOptions", (app, entryOptions) => {
  entryOptions.push({
    label: "Create Handout Note",
    icon: "fas fa-file-image",
    onClick: async (event, li) => {
      const page = _getJournalPageFromLi(li);
      if (page?.type === "image") {
        await createHandoutNoteFromPage(page);
      } else {
        ui.notifications.warn("Only image-type journal pages can be turned into handouts.");
      }
    },
    visible: (li) => {
      const page = _getJournalPageFromLi(li);
      return page?.type === "image";
    }
  });
});

// Context menu hook for Playlist sounds
Hooks.on("getPlaylistSoundContextOptions", (app, entryOptions) => {
  entryOptions.push({
    label: "Create Media Note",
    icon: "fas fa-cassette-tape",
    onClick: async (event, li) => {
      const sound = _getPlaylistSoundFromLi(li);
      if (sound) {
        await createMediaNoteFromSound(sound);
      }
    }
  });
});

// Context menu hook for Playlist entries
Hooks.on("getPlaylistContextOptions", (app, entryOptions) => {
  entryOptions.push({
    label: "Import Playlist as Notes",
    icon: "fas fa-cassette-tape",
    onClick: async (event, li) => {
      const playlist = await _resolveDocumentFromLi(li, game.playlists);
      if (playlist) {
        await importPlaylistAsNotes(playlist);
      } else {
        ui.notifications.warn("Investigation Board: Could not resolve Playlist.");
      }
    },
    visible: () => game.user.isGM
  });
});

/**
 * Shared callback for folder context menu to import content
 */
async function _onImportFolderAsNotes(li) {
  // li might be the jQuery element or the raw element from our manual hook
  const el = (li instanceof HTMLElement) ? li : (li[0] || li);
  
  // v13 resolution is much more varied
  const folderId = el.dataset.id || 
                   el.dataset.folderId || 
                   el.getAttribute("data-id") || 
                   el.getAttribute("data-folder-id") ||
                   el.closest(".folder")?.dataset.folderId ||
                   el.closest(".folder")?.dataset.id ||
                   el.closest("[data-folder-id]")?.dataset.folderId;

  if (!folderId) {
    console.warn("Investigation Board: Could not find folder ID on element", el);
    return;
  }

  const folder = game.folders.get(folderId);
  if (folder) {
    await importFolderAsNotes(folder);
  } else {
    console.warn("Investigation Board: Could not find folder with ID", folderId);
  }
}

// Folder Context Hook — v14 fires getFolderContextOptions for all directory types
Hooks.on("getFolderContextOptions", (app, entryOptions) => {
  // Avoid duplicate entries
  if (entryOptions.find(e => e.label === "Import Folder as Notes")) return;

  entryOptions.push({
    label: "Import Folder as Notes",
    icon: "fa-solid fa-camera-polaroid",
    onClick: (event, li) => _onImportFolderAsNotes(li),
    visible: () => game.user.isGM
  });
});


// Hook to deactivate connect mode on scene change and initialize connection lines
Hooks.on("canvasReady", async () => {
  // Migrate legacy IB notes that have fillAlpha: 0 — Foundry v13 rejects any drawing update
  // where the stored document has no visible fill, stroke, or text. We fix this in the database
  // once so subsequent updates (drag/release, etc.) don't trigger the validation error.
  if (game.user.isGM && canvas.scene) {
    const toMigrate = canvas.scene.drawings.filter(d =>
      d.flags?.[MODULE_ID]?.type &&
      d.fillAlpha === 0 &&
      d.strokeWidth === 0
    );
    if (toMigrate.length) {
      const updates = toMigrate.map(d => ({ _id: d.id, fillAlpha: 0.001 }));
      await canvas.scene.updateEmbeddedDocuments("Drawing", updates);
    }
  }

  // Properly destroy and remove old containers before clearing references
  cleanupConnectionLines();

  // Clear pin connection state on scene change
  resetPinConnectionState();

  // Clear connection numbers on canvas change
  clearConnectionNumbers();

  // Reapply Investigation Board mode if it was active before canvas recreation
  if (InvestigationBoardState.isActive) {
    // Force reset then reactivate to be safe
    InvestigationBoardState.isActive = false;
    activateInvestigationBoardMode();
  }

  // Draw all connection lines and pins after a short delay to ensure all drawings are loaded
  setTimeout(() => {
    updatePins();
    drawAllConnectionLines();
  }, 100);
});

// Adds "Create Handout Note" to the Image Popout header controls dropdown (v14 AppV2 approach).
// getHeaderControlsImagePopout fires when Foundry builds the ellipsis-menu controls list.
Hooks.on("getHeaderControlsImagePopout", (app, controls) => {
  if (!game.user.isGM) return;
  controls.push({
    action: "createHandoutNote",
    icon: "fa-solid fa-file-image",
    label: "Create Handout Note",
    onClick: () => {
      const src = app.options.src;
      if (src) {
        createHandoutNoteFromImage(src);
      } else {
        ui.notifications.warn("Investigation Board: Could not resolve image source from popout.");
      }
    }
  });
});