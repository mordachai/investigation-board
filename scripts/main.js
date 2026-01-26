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
    if (!isInvestigationNote) {
      drawing.eventMode = 'none';
      drawing.interactiveChildren = false;
    } else {
      // Ensure investigation notes are interactive and selectable
      // Use 'static' to ensure it receives events even if it's not "owned"
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
  if (InvestigationBoardState.isActive) return;
  if (!canvas.drawings) {
    console.error("Investigation Board: drawings layer not available");
    return;
  }

  console.log("Investigation Board: Activating mode...");
  InvestigationBoardState.isActive = true;

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
  if (!InvestigationBoardState.isActive) return;

  console.log("Investigation Board: Deactivating mode...");
  InvestigationBoardState.isActive = false;

  // Clear pin connection state
  resetPinConnectionState();

  // Clear connection numbers
  clearConnectionNumbers();

  // Restore default interactivity to all drawings
  if (canvas.drawings) {
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
      title: game.i18n.localize("investigation-board.createStickyNote"),
      icon: "fas fa-sticky-note",
      onChange: () => createNote("sticky"),
      button: true
    };

    controls.drawings.tools.createPhotoNote = {
      name: "createPhotoNote",
      title: game.i18n.localize("investigation-board.createPhotoNote"),
      icon: "fa-solid fa-camera-polaroid",
      onChange: () => createNote("photo"),
      button: true
    };

    controls.drawings.tools.createIndexCard = {
      name: "createIndexCard",
      title: game.i18n.localize("investigation-board.createIndexCard"),
      icon: "fa-regular fa-subtitles",
      onChange: () => createNote("index"),
      button: true
    };

    controls.drawings.tools.createHandout = {
      name: "createHandout",
      title: game.i18n.localize("investigation-board.createHandout"),
      icon: "fas fa-file-image",
      onChange: () => createNote("handout"),
      button: true
    };

    controls.drawings.tools.createMediaNote = {
      name: "createMediaNote",
      title: game.i18n.localize("investigation-board.createMediaNote"),
      icon: "fas fa-cassette-tape",
      onChange: () => createNote("media"),
      button: true
    };

    controls.drawings.tools.createPinOnly = {
      name: "createPinOnly",
      title: game.i18n.localize("investigation-board.createPinOnly"),
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

  console.log("Investigation Board module initialized.");
});

// Hook to initialize socket for collaborative editing
Hooks.once("ready", () => {
  console.log("Investigation Board: Ready hook fired. v13 detected.");
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

        ui.notifications.info(game.i18n.localize("Info.IB:PCI")); // Investigation Board: Processing clipboard image...

        const folderPath = "assets/ib-handouts";

        try {
          // 1. Ensure directories exist (assets -> assets/ib-handouts)
          try {
            await FilePicker.browse("data", "assets");
          } catch {
            await FilePicker.createDirectory("data", "assets");
          }
          
          try {
            await FilePicker.browse("data", folderPath);
          } catch {
            await FilePicker.createDirectory("data", folderPath);
          }

          // 2. Upload file
          const timestamp = Date.now();
          const uniqueId = foundry.utils.randomID();
          
          // Use original name extension if available, defaulting to png
          let ext = "png";
          if (file.name) {
             const parts = file.name.split(".");
             if (parts.length > 1) ext = parts.pop();
          }
          const newFileName = `pasted_handout_${timestamp}_${uniqueId}.${ext}`;
          
          // Create a new File object with the correct name to ensure it's respected
          const renamedFile = new File([file], newFileName, { type: file.type });
          
          const response = await FilePicker.upload("data", folderPath, renamedFile, { fileName: newFileName });
          
          // 3. Create Note
          if (response.path) {
            await createHandoutNoteFromImage(response.path);
            ui.notifications.info(game.i18n.localize("info.IB:CHFCB")); // Investigation Board: Created handout from clipboard
          }
          
        } catch (err) {
          console.error("Investigation Board: Paste failed", err);
          ui.notifications.warn(game.i18n.localize("warn.IB:FTUPI")); // Investigation Board: Failed to upload pasted image. Check console for details.");
        }

        // Only handle the first image
        return;
      }
    }
  });
});

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
    
    console.log("Investigation Board: Detected pasted/duplicated note. Cleared connections and suppressed sheet.");
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
      console.log("Investigation Board: Refreshed interactivity and pins for new note", drawing.id);
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

  // Skip this drawing for bulk deletion (like "Clear Drawings" button)
  console.log(`Investigation Board: Protected note "${drawing.id}" from bulk deletion.`);
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
    
    // Also re-render open NotePreviewer for this drawing
    const appId = `note-preview-${drawing.id}`;
    const app = foundry.applications.instances.get(appId);
    if (app) app.render();
  }

  // Redraw connection lines when position OR connections change
  if (changes.x !== undefined || changes.y !== undefined || flagsChanged) {
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
  
  console.log("Investigation Board DEBUG: Resolving document from element", target);
  console.log("Investigation Board DEBUG: Target dataset:", JSON.stringify(target.dataset));

  // 1. Try UUID directly (most reliable in v13)
  const uuid = target.dataset.uuid || target.getAttribute("data-uuid");
  if (uuid) {
    console.log("Investigation Board DEBUG: Found UUID:", uuid);
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

  console.log("Investigation Board DEBUG: Resolved docId:", docId);

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
Hooks.on("getActorContextOptions", (html, entryOptions) => {
  entryOptions.push(
    {
      name: game.i18n.localize("investigation-board.photoNoteFromActor"), // Photo Note from Actor
      icon: '<i class="fa-solid fa-camera-polaroid"></i>',
      callback: async (li) => {
        const actor = await _resolveDocumentFromLi(li, game.actors);
        if (actor) await createPhotoNoteFromActor(actor, false);
        else ui.notifications.warn(game.i18n.localize("investigation-board.warn.IB:CNRA")); // Investigation Board: Could not resolve Actor.
      }
    },
    {
      name: game.i18n.localize("investigation-board.unknownPhotoNoteFromActor"), // Unknown Photo Note from Actor
      icon: '<i class="fa-solid fa-camera-polaroid"></i>',
      callback: async (li) => {
        const actor = await _resolveDocumentFromLi(li, game.actors);
        if (actor) await createPhotoNoteFromActor(actor, true);
        else ui.notifications.warn(game.i18n.localize("investigation-board.warn.IB:CNRA")); // Investigation Board: Could not resolve Actor.
      }
    }
  );
});

// Context menu hook for Item directory
Hooks.on("getItemContextOptions", (html, entryOptions) => {
  entryOptions.push({
    name: game.i18n.localize("investigation-board.photoNoteFromItem"), // Photo Note from Item
    icon: '<i class="fa-solid fa-camera-polaroid"></i>',
    callback: async (li) => {
      const item = await _resolveDocumentFromLi(li, game.items);
      if (item) await createPhotoNoteFromItem(item);
      else ui.notifications.warn(game.i18n.localize("investigation-board.warn.IB:CNRI")); // Investigation Board: Could not resolve Item.
    }
  });
});

// Context menu hook for Scene directory
Hooks.on("getSceneContextOptions", (html, entryOptions) => {
  entryOptions.push({
    name: game.i18n.localize("investigation-board.photoNoteFromScene"), // Photo Note from Scene
    icon: '<i class="fa-solid fa-camera-polaroid"></i>',
    callback: async (li) => {
      const scene = await _resolveDocumentFromLi(li, game.scenes);
      if (scene) await createPhotoNoteFromScene(scene);
      else ui.notifications.warn(game.i18n.localize("investigation-board.warn.IB:CNRS")); // Investigation Board: Could not resolve Scene.
    }
  });
});

// Also add hook for Scene Navigation at the top
Hooks.on("getSceneNavigationContext", (html, entryOptions) => {
  entryOptions.push({
    name: game.i18n.localize("investigation-board.photoNoteFromScene"), // Photo Note from Scene
    icon: '<i class="fa-solid fa-camera-polaroid"></i>',
    callback: async (li) => {
      const scene = await _resolveDocumentFromLi(li, game.scenes);
      if (scene) await createPhotoNoteFromScene(scene);
      else ui.notifications.warn(game.i18n.localize("investigation-board.warn.IB:CNRS")); // Investigation Board: Could not resolve Scene.
    }
  });
});

// Context menu hook for Journal pages
Hooks.on("getJournalEntryPageContextOptions", (html, entryOptions) => {
  entryOptions.push({
    name: game.i18n.localize("investigation-board.createHandout"), // Create Handout Note
    icon: '<i class="fas fa-file-image"></i>',
    callback: async (li) => {
      const page = _getJournalPageFromLi(li);
      if (page?.type === "image") {
        await createHandoutNoteFromPage(page);
      } else {
        ui.notifications.warn(game.i18n.localize("investigation-board.warn.OITJP2H")); // Only image-type journal pages can be turned into handouts.
      }
    },
    condition: (li) => {
      const page = _getJournalPageFromLi(li);
      return page?.type === "image";
    }
  });
});

// Context menu hook for Playlist sounds
Hooks.on("getPlaylistSoundContextOptions", (html, entryOptions) => {
  entryOptions.push({
    name: game.i18n.localize("investigation-board.createMediaNote"), // Create Media Note
    icon: '<i class="fas fa-cassette-tape"></i>',
    callback: async (li) => {
      const sound = _getPlaylistSoundFromLi(li);
      if (sound) {
        await createMediaNoteFromSound(sound);
      }
    }
  });
});

// Context menu hook for Playlist entries
Hooks.on("getPlaylistContextOptions", (html, entryOptions) => {
  console.log("Investigation Board: getPlaylistContextOptions fired");
  entryOptions.push({
    name: game.i18n.localize("investigation-board.importPlaylistAsNotes"), // Import Playlist as Notes
    icon: '<i class="fas fa-cassette-tape"></i>',
    callback: async (li) => {
      const playlist = await _resolveDocumentFromLi(li, game.playlists);
      if (playlist) {
        await importPlaylistAsNotes(playlist);
      } else {
        ui.notifications.warn(game.i18n.localize("investigation-board.warn.IB:CNRPL")); // Investigation Board: Could not resolve Playlist.
      }
    },
    condition: () => game.user.isGM
  });
});

Hooks.on("getPlaylistDirectoryEntryContext", (html, entryOptions) => {
  // Keeping this as a secondary variation for compatibility
  if (entryOptions.find(e => e.name === game.i18n.localize("investigation-board.importPlaylistAsNotes"))) return;
  entryOptions.push({
    name: game.i18n.localize("investigation-board.importPlaylistAsNotes"), // Import Playlist as Notes
    icon: '<i class="fas fa-cassette-tape"></i>',
    callback: async (li) => {
      const playlist = await _resolveDocumentFromLi(li, game.playlists);
      if (playlist) {
        await importPlaylistAsNotes(playlist);
      } else {
        ui.notifications.warn(game.i18n.localize("investigation-board.warn.IB:CNRPL")); // Investigation Board: Could not resolve Playlist.
      }
    },
    condition: () => game.user.isGM
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
    console.warn(game.i18n.localize("investigation-board.warn.IB:CNFFIDOE"), el); // Investigation Board: Could not find folder ID on element.
    return;
  }

  const folder = game.folders.get(folderId);
  if (folder) {
    await importFolderAsNotes(folder);
  } else {
    console.warn(game.i18n.localize("investigation-board.warn.IB:CNFFWID"), folderId); // Investigation Board: Could not find folder with ID.
  }
}

const _folderHookCallback = (html, entryOptions) => {
  // Avoid duplicate entries
if (entryOptions.find(e => e.name === game.i18n.localize("investigation-board.importFolderAsNotes"))) return;


  entryOptions.push({
    name: game.i18n.localize("investigation-board.importFolderAsNotes"), // Import Folder as Notes
    icon: '<i class="fa-solid fa-camera-polaroid"></i>',
    callback: (li) => _onImportFolderAsNotes(li),
    condition: () => game.user.isGM
  });
};

// Folder Context Hooks - using multiple variations for v13 compatibility
Hooks.on("getDirectoryFolderContext", _folderHookCallback);
Hooks.on("getActorDirectoryFolderContext", _folderHookCallback);
Hooks.on("getItemDirectoryFolderContext", _folderHookCallback);
Hooks.on("getSceneDirectoryFolderContext", _folderHookCallback);
Hooks.on("getPlaylistDirectoryFolderContext", _folderHookCallback);
Hooks.on("getFolderContextOptions", _folderHookCallback);

// Some v13 sidebars might trigger EntryContext for folders
Hooks.on("getActorDirectoryEntryContext", (html, entryOptions) => {
    if (html[0]?.classList.contains("folder") || html[0]?.closest(".folder")) {
        _folderHookCallback(html, entryOptions);
    }
});
Hooks.on("getItemDirectoryEntryContext", (html, entryOptions) => {
    if (html[0]?.classList.contains("folder") || html[0]?.closest(".folder")) {
        _folderHookCallback(html, entryOptions);
    }
});
Hooks.on("getSceneDirectoryEntryContext", (html, entryOptions) => {
    if (html[0]?.classList.contains("folder") || html[0]?.closest(".folder")) {
        _folderHookCallback(html, entryOptions);
    }
});
Hooks.on("getPlaylistDirectoryEntryContext", (html, entryOptions) => {
    if (html[0]?.classList.contains("folder") || html[0]?.closest(".folder")) {
        _folderHookCallback(html, entryOptions);
    }
});


// Hook to deactivate connect mode on scene change and initialize connection lines
Hooks.on("canvasReady", () => {
  // Properly destroy and remove old containers before clearing references
  cleanupConnectionLines();

  // Clear pin connection state on scene change
  resetPinConnectionState();

  // Clear connection numbers on canvas change
  clearConnectionNumbers();

  // Reapply Investigation Board mode if it was active before canvas recreation
  if (InvestigationBoardState.isActive) {
    console.log("Investigation Board: Canvas recreated, reapplying mode...");
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

/**
 * Adds "Create Handout Note" to the existing context menu of images in Journal Sheets.
 * Modifies the existing ContextMenu instance found in the app.
 */
function _addJournalImageContext(app, html, data) {
  if (!game.user.isGM) return;

  // Wait for the next tick to ensure context menus are fully registered by the sheet
  setTimeout(() => {
    if (!app.contextMenus) return;

    // Find the menu that has "Show to Players"
    const menu = app.contextMenus.find(m => m.menuItems.some(i => i.name === "Show to Players" || i.name === "OWNERSHIP.ShowAll"));
    
    if (menu) {
      // Avoid duplicates
      if (menu.menuItems.find(i => i.name === game.i18n.localize("investigation-board.createHandout"))) return;

      menu.menuItems.push({
        name: game.i18n.localize("investigation-board.createHandout"), // Create Handout Note
        icon: '<i class="fas fa-file-image"></i>',
        callback: (li) => {
          const el = li[0] || li;
          // The target might be the img itself or a wrapper depending on Foundry version/sheet
          const img = el.tagName === "IMG" ? el : el.querySelector("img");
          const src = img?.getAttribute("src") || img?.src;
          
          if (src) {
             createHandoutNoteFromImage(src);
          } else {
             ui.notifications.warn(game.i18n.localize("investigation-board.warn.IB:CNFIS")); // Investigation Board: Could not find image source.
          }
        },
        condition: (li) => {
          const el = li[0] || li;
          const img = el.tagName === "IMG" ? el : el.querySelector("img");
          return !!img;
        }
      });
    }
  }, 100);
}

// Hooks to attach the context menu to Journals
Hooks.on("renderJournalSheet", _addJournalImageContext);
Hooks.on("renderJournalPageSheet", _addJournalImageContext);

/**
 * Adds "Create Handout Note" to the Image Popout header menu (the ellipsis/3-dots menu).
 */
Hooks.on("renderImagePopout", (app, html, data) => {
  if (!game.user.isGM) return;

  const element = html[0] || html;
  const menu = element.querySelector("menu.controls-dropdown");
  if (!menu) return;

  // Avoid duplicates
  if (menu.querySelector('[data-action="createHandoutNote"]')) return;

  const li = document.createElement("li");
  li.classList.add("header-control");
  li.setAttribute("data-action", "createHandoutNote");
  li.innerHTML = `
    <button type="button" class="control">
      <i class="control-icon fa-fw fa-solid fa-file-image"></i>
      <span class="control-label">`+game.i18n.localize("investigation-board.createHandout")+`</span>
    </button>
  `;

  // Insert the new option
  menu.appendChild(li);

  // Add click listener
  li.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    
    // Find the image source within the popout
    const img = element.querySelector("section.window-content img") || element.querySelector("img");
    const src = img?.getAttribute("src") || img?.src;
    
    if (src) {
      createHandoutNoteFromImage(src);
      // Optional: close the dropdown after clicking
      menu.classList.remove("expanded");
    } else {
      ui.notifications.warn(game.i18n.localize("investigation-board.warn.IB:CNRISFP")); // Investigation Board: Could not resolve image source from popout.
    }
  });
});