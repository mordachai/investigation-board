import { MODULE_ID, SOCKET_NAME } from "../config.js";
import { applyTapeEffectToSound } from "./audio-utils.js";

export let socket = null;
export let activeGlobalSounds = new Map(); // Track sounds played via socket

/**
 * Updates a drawing document, using socket communication if the user doesn't have permission.
 * This enables collaborative editing where any user can modify any investigation board note.
 * @param {string} drawingId - The ID of the drawing to update
 * @param {object} updateData - The update data to apply
 * @param {string} sceneId - Optional scene ID (defaults to current scene)
 * @returns {Promise<void>}
 */
export async function collaborativeUpdate(drawingId, updateData, sceneId = null) {
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
 * Creates a drawing document, using socket communication if the user doesn't have permission.
 * @param {object} createData - The data for the new drawing
 * @param {object} options - Options for the creation
 * @param {string} sceneId - Optional scene ID (defaults to current scene)
 * @returns {Promise<Document[]>}
 */
export async function collaborativeCreate(createData, options = {}, sceneId = null) {
  const scene = sceneId ? game.scenes.get(sceneId) : canvas.scene;
  if (!scene) return [];

  // If user is GM or has permission to create drawings in the scene, create directly
  if (game.user.isGM || scene.canUserModify(game.user, "create")) {
    return await scene.createEmbeddedDocuments("Drawing", [createData], options);
  }

  // Otherwise, request creation via socket
  if (socket) {
    socket.emit(SOCKET_NAME, {
      action: "createDrawing",
      sceneId: scene.id,
      createData: createData,
      options: options,
      requestingUser: game.user.id
    });
    console.log("Investigation Board: Sent socket request to create drawing");
  } else {
    console.error("Investigation Board: Socket not available for collaborative creation");
  }
  return [];
}

/**
 * Deletes a drawing document, using socket communication if the user doesn't have permission.
 */
export async function collaborativeDelete(drawingId, sceneId = null) {
  const scene = sceneId ? game.scenes.get(sceneId) : canvas.scene;
  if (!scene) return;

  const drawing = scene.drawings.get(drawingId);
  if (!drawing) return;

  // If user is GM or has owner permission, delete directly
  if (game.user.isGM || drawing.testUserPermission(game.user, "OWNER")) {
    await drawing.delete();
    return;
  }

  // Otherwise, request deletion via socket
  if (socket) {
    socket.emit(SOCKET_NAME, {
      action: "deleteDrawing",
      sceneId: scene.id,
      drawingId: drawingId,
      requestingUser: game.user.id
    });
  }
}

/**
 * Handles incoming socket messages for collaborative updates and global audio.
 */
export function handleSocketMessage(data) {
  // Global actions for all users
  if (data.action === "playAudio") {
    if (data.audioPath) {
      // DO NOT play if already playing this specific audio via global broadcast
      const existing = activeGlobalSounds.get(data.audioPath);
      if (existing && existing.playing) return;

      console.log("Investigation Board: Playing global audio", data.audioPath);
      (async () => {
        const sound = await game.audio.play(data.audioPath, { volume: 0.8 });
        if (sound) {
          activeGlobalSounds.set(data.audioPath, sound);
          
          if (data.applyEffect) {
            applyTapeEffectToSound(sound);
          }

          // Clean up reference when sound ends
          setTimeout(() => {
            if (activeGlobalSounds.get(data.audioPath) === sound && !sound.playing) {
              activeGlobalSounds.delete(data.audioPath);
            }
          }, (sound.duration * 1000) + 1000 || 5000);
        }
      })();
    }
    return;
  }

  if (data.action === "stopAudio") {
    if (data.audioPath) {
      const sound = activeGlobalSounds.get(data.audioPath);
      if (sound) {
        sound.stop();
        activeGlobalSounds.delete(data.audioPath);
        console.log("Investigation Board: Stopped global audio", data.audioPath);
      }
    }
    return;
  }

  // Admin actions - only GM processes socket requests
  if (!game.user.isGM) return;

  if (data.action === "createDrawing") {
    const scene = game.scenes.get(data.sceneId);
    if (!scene) return;
    
    console.log("Investigation Board: GM processing socket creation requested by", data.requestingUser);
    
    // Pass along the original requesting userId so we can filter the sheet opening
    const options = { ...data.options, ibRequestingUser: data.requestingUser };
    scene.createEmbeddedDocuments("Drawing", [data.createData], options);
  }

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

  if (data.action === "deleteDrawing") {
    const scene = game.scenes.get(data.sceneId);
    if (!scene) return;
    const drawing = scene.drawings.get(data.drawingId);
    if (!drawing) return;

    console.log("Investigation Board: GM processing socket deletion for drawing", data.drawingId);
    drawing.delete();
  }
}

export function initSocket() {
    socket = game.socket;
    socket.on(SOCKET_NAME, handleSocketMessage);
    console.log("Investigation Board: Socket listener registered for collaborative editing.");
}
