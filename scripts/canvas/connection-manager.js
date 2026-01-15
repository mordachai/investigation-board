import { MODULE_ID } from "../config.js";
import { InvestigationBoardState } from "../state.js";
import { collaborativeUpdate } from "../utils/socket-handler.js";

// Pin-click connection state variables
export let pinConnectionFirstNote = null;
export let pinConnectionHighlight = null; // PIXI.Graphics for border
export let connectionPreviewLine = null; // PIXI.Graphics for live preview line
export let connectionLinesContainer = null; // Global container for all connection lines
export let pinsContainer = null; // Global container for all pins (to render on top)

// Connection animation state
export let activeEditingDrawingId = null; // Which drawing's edit dialog is open
export let animationTickerId = null; // Ticker for animating connection lines

// Connection number overlays
export let connectionNumberOverlays = []; // Array of PIXI.Text objects showing connection numbers

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

  // --- DRAW SHADOW LINE FIRST ---
  const shadowOffset = 3;
  graphics.lineStyle(width + 1, 0x000000, 0.25); // Slightly thicker, black, low alpha
  graphics.moveTo(x1 + shadowOffset, y1 + shadowOffset);
  graphics.quadraticCurveTo(ctrlX + wobble + shadowOffset, ctrlY + shadowOffset, x2 + shadowOffset, y2 + shadowOffset);

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

// Global function to draw all connection lines and pins
export function drawAllConnectionLines(animationOffset = 0) {
  if (!canvas || !canvas.ready || !canvas.drawings) return;

  // Enable sortable children on the drawings layer for z-index control
  canvas.drawings.sortableChildren = true;

  // Initialize or validate connection lines container
  if (!connectionLinesContainer || connectionLinesContainer.destroyed) {
    connectionLinesContainer = new PIXI.Graphics();
    connectionLinesContainer.zIndex = 10; // Yarn in the middle
    canvas.drawings.addChild(connectionLinesContainer);
  } else {
    try {
      connectionLinesContainer.clear();
    } catch (err) {
      console.warn("Investigation Board: Failed to clear lines container, recreating...", err);
      if (connectionLinesContainer.parent) connectionLinesContainer.parent.removeChild(connectionLinesContainer);
      connectionLinesContainer.destroy({children: true});
      connectionLinesContainer = new PIXI.Graphics();
      connectionLinesContainer.zIndex = 10;
      canvas.drawings.addChild(connectionLinesContainer);
    }
  }

  // Initialize or validate pins container
  if (!pinsContainer || pinsContainer.destroyed) {
    pinsContainer = new PIXI.Container();
    pinsContainer.zIndex = 20; // Pins on top
    canvas.drawings.addChild(pinsContainer);
  } else {
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
        const isHandout = noteData.type === "handout";
        const isMedia = noteData.type === "media";
        const isPhoto = noteData.type === "photo";
        const isIndex = noteData.type === "index";

        let width, pinY;
        if (isHandout) {
          // Handout notes use dynamic positioning based on drawing dimensions
          width = drawing.document.shape.width || 400;
          const height = drawing.document.shape.height || 400;
          pinY = drawing.document.y + (height * 0.05);
        } else if (isMedia) {
          // Media notes (cassettes) center horizontally based on actual width
          width = drawing.document.shape.width || 400;
          pinY = drawing.document.y + 3;
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

    // Get source pin position (Using the drawing's method, assuming drawing is a CustomDrawing)
    const sourcePin = drawing._getPinPosition ? drawing._getPinPosition() : { x: drawing.document.x, y: drawing.document.y };

    // Draw each connection
    connections.forEach(conn => {
      const targetDrawing = canvas.drawings.get(conn.targetId);
      if (!targetDrawing) return;

      const targetNoteData = targetDrawing.document.flags[MODULE_ID];
      if (!targetNoteData) return;

      const targetPin = targetDrawing._getPinPosition ? targetDrawing._getPinPosition() : { x: targetDrawing.document.x, y: targetDrawing.document.y };

      // Get line style
      let lineColor = conn.color || game.settings.get(MODULE_ID, "connectionLineColor") || "#FF0000";
      const lineWidth = conn.width || game.settings.get(MODULE_ID, "connectionLineWidth") || 6;
      
      // Safely convert to color number (handling strings, numbers, or Color objects)
      let colorNum;
      if (typeof lineColor === "string") {
        colorNum = parseInt(lineColor.replace("#", ""), 16);
      } else if (typeof lineColor === "number") {
        colorNum = lineColor;
      } else if (lineColor?.hex !== undefined) {
        colorNum = lineColor.hex;
      } else {
        colorNum = 0xFF0000; // Fallback
      }

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

// Start animating connection lines for a specific drawing
export function startConnectionAnimation(drawingId) {
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
export function stopConnectionAnimation() {
  activeEditingDrawingId = null;

  if (animationTickerId) {
    canvas.app.ticker.remove(animationTickerId);
    animationTickerId = null;
  }

  // Redraw without animation
  drawAllConnectionLines();
}

// Show connection numbers on connected notes
export function showConnectionNumbers(sourceDrawingId) {
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
export function clearConnectionNumbers() {
  connectionNumberOverlays.forEach(overlay => {
    if (overlay.parent) {
      overlay.parent.removeChild(overlay);
    }
    overlay.destroy();
  });
  connectionNumberOverlays = [];
}

// Mouse move handler for connection preview
function onMouseMovePreview(event) {
  if (!pinConnectionFirstNote || !connectionPreviewLine) {
    return;
  }

  // Get mouse position in world coordinates from the event
  const worldPos = event.getLocalPosition(canvas.stage);

  // Get the first pin position
  const firstPin = pinConnectionFirstNote._getPinPosition ? pinConnectionFirstNote._getPinPosition() : { x: pinConnectionFirstNote.document.x, y: pinConnectionFirstNote.document.y };

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
  }

  // Add mouse move listener to canvas
  canvas.stage.on('pointermove', onMouseMovePreview);
}

// Clear connection preview
export function clearConnectionPreview() {
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

async function createConnection(sourceDrawing, targetDrawing) {
  const connections = sourceDrawing.document.flags[MODULE_ID]?.connections || [];

  // Check for duplicate
  const isDuplicate = connections.some(conn => conn.targetId === targetDrawing.document.id);
  if (isDuplicate) {
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
}

// Pin-Click Connection Function
export function onPinClick(event, drawing) {
  event.stopPropagation(); // Prevent selection of the drawing itself

  // Only allow connections when in Investigation Board mode
  if (!InvestigationBoardState.isActive) return;

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
  resetPinConnectionState();
}

export function resetPinConnectionState() {
  pinConnectionFirstNote = null;
  if (pinConnectionHighlight) {
    canvas.controls.removeChild(pinConnectionHighlight);
    pinConnectionHighlight.destroy();
    pinConnectionHighlight = null;
  }
  clearConnectionPreview();
}

export function cleanupConnectionLines() {
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
}
