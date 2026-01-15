import { MODULE_ID, SOCKET_NAME } from "./config.js";
import { InvestigationBoardState } from "./state.js";
import { registerSettings } from "./settings.js";
import { CustomDrawing } from "./canvas/custom-drawing.js";
import { CustomDrawingSheet } from "./apps/drawing-sheet.js";
import { 
  drawAllConnectionLines, 
  cleanupConnectionLines, 
  resetPinConnectionState, 
  clearConnectionNumbers,
  clearConnectionPreview
} from "./canvas/connection-manager.js";
import { initSocket, socket, collaborativeUpdate } from "./utils/socket-handler.js";
import { 
  createNote, 
  createPhotoNoteFromActor, 
  createPhotoNoteFromScene, 
  createHandoutNoteFromPage, 
  createMediaNoteFromSound 
} from "./utils/creation-utils.js";

// v13 namespaced imports
const DocumentSheetConfig = foundry.applications.apps.DocumentSheetConfig;
const DrawingDocument = foundry.documents.DrawingDocument;

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
  initSocket();

  // Show setup warning to GM if enabled
  if (game.user.isGM && game.settings.get(MODULE_ID, "showSetupWarning")) {
    const drawingPerm = game.permissions.DRAWING_CREATE.includes(1); // PLAYER role
    const filePerm = game.permissions.FILES_BROWSE.includes(1); // PLAYER role
    
    if (!drawingPerm || !filePerm) {
      const { DialogV2 } = foundry.applications.api;
      new DialogV2({
        window: { title: "Investigation Board: Setup Recommended" },
        content: `
          <p>To allow <strong>Players</strong> to fully use the Investigation Board, consider updating these World Permissions in <b>Game Settings >> User Management >> Configure Permissions</b>:</p>
          <ul>
            <li><strong>Use Drawing Tools</strong>: ${drawingPerm ? "✅ Enabled" : "❌ Disabled (Needed to create/manipulate notes and connections)"}</li>
            <li><strong>Upload Files</strong>: ${filePerm ? "✅ Enabled" : "❌ Disabled (Needed to create Photo and Handout notes with images)"}</li>
          </ul>
          <p style="color: #882222; font-style: italic;"><strong>Security Note:</strong> Enabling 'Upload Files' for players gives them access to your server's file system through the File Picker. Be careful with who you let access your files!</p>
          <hr>
        `,
        buttons: [
          {
            action: "ok",
            label: "Understood",
            icon: "fas fa-check"
          },
          {
            action: "disable",
            label: "Don't show again",
            icon: "fas fa-times",
            callback: (event, button, dialog) => game.settings.set(MODULE_ID, "showSetupWarning", false)
          }
        ]
      }).render(true);
    }
  }
});

// Hook to ensure newly created notes are interactive in Investigation Board mode
Hooks.on("createDrawing", (drawing, options, userId) => {
  // Check if this is an investigation board note
  const noteData = drawing.flags[MODULE_ID];
  if (!noteData) return;

  // If this is the user who created the note, open the edit dialog
  if (userId === game.user.id && !options.skipAutoOpen) {
    setTimeout(() => {
      drawing.sheet.render(true);
    }, 150);
  }

  // If we're in Investigation Board mode, refresh interactivity after the drawing is rendered
  if (InvestigationBoardState.isActive) {
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
    
    // Also re-render open NotePreviewer for this drawing
    const appId = `note-preview-${drawing.id}`;
    const app = foundry.applications.instances.get(appId);
    if (app) app.render();
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
  entryOptions.push(
    {
      name: "Photo Note from Actor",
      icon: '<i class="fa-solid fa-camera-polaroid"></i>',
      callback: async (li) => {
        const el = li instanceof HTMLElement ? li : li[0];
        const actorId = el?.dataset?.documentId || el?.dataset?.entryId || el?.getAttribute?.("data-document-id") || el?.getAttribute?.("data-entry-id");
        const actor = game.actors.get(actorId);
        if (actor) await createPhotoNoteFromActor(actor, false);
      }
    },
    {
      name: "Unknown Photo Note from Actor",
      icon: '<i class="fa-solid fa-camera-polaroid"></i>',
      callback: async (li) => {
        const el = li instanceof HTMLElement ? li : li[0];
        const actorId = el?.dataset?.documentId || el?.dataset?.entryId || el?.getAttribute?.("data-document-id") || el?.getAttribute?.("data-entry-id");
        const actor = game.actors.get(actorId);
        if (actor) await createPhotoNoteFromActor(actor, true);
      }
    }
  );
});

// Context menu hook for Scene directory
Hooks.on("getSceneContextOptions", (html, entryOptions) => {
  entryOptions.push({
    name: "Photo Note from Scene",
    icon: '<i class="fa-solid fa-camera-polaroid"></i>',
    callback: async (li) => {
      const el = li instanceof HTMLElement ? li : li[0];
      const sceneId = el?.dataset?.documentId || el?.dataset?.entryId || el?.getAttribute?.("data-document-id") || el?.getAttribute?.("data-entry-id");
      const scene = game.scenes.get(sceneId);
      if (scene) await createPhotoNoteFromScene(scene);
    }
  });
});

// Also add hook for Scene Navigation at the top
Hooks.on("getSceneNavigationContext", (html, entryOptions) => {
  entryOptions.push({
    name: "Photo Note from Scene",
    icon: '<i class="fa-solid fa-camera-polaroid"></i>',
    callback: async (li) => {
      const el = li instanceof HTMLElement ? li : li[0];
      const sceneId = el?.dataset?.documentId || el?.getAttribute?.("data-document-id") || (typeof li.data === "function" ? li.data("sceneId") : null);
      const scene = game.scenes.get(sceneId);
      if (scene) await createPhotoNoteFromScene(scene);
    }
  });
});

// Context menu hook for Journal pages
Hooks.on("getJournalEntryPageContextOptions", (html, entryOptions) => {
  entryOptions.push({
    name: "Create Handout Note",
    icon: '<i class="fas fa-file-image"></i>',
    callback: async (li) => {
      const page = _getJournalPageFromLi(li);
      if (page?.type === "image") {
        await createHandoutNoteFromPage(page);
      } else {
        ui.notifications.warn("Only image-type journal pages can be turned into handouts.");
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
    name: "Create Media Note",
    icon: '<i class="fas fa-cassette-tape"></i>',
    callback: async (li) => {
      const sound = _getPlaylistSoundFromLi(li);
      if (sound) {
        await createMediaNoteFromSound(sound);
      }
    }
  });
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
    drawAllConnectionLines();
  }, 100);
});
