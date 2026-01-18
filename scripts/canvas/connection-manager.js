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

// Helper function to calculate points along a quadratic bezier curve
function getQuadraticBezierPoints(x0, y0, cx, cy, x1, y1, segments) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const invT = 1 - t;
    const x = invT * invT * x0 + 2 * invT * t * cx + t * t * x1;
    const y = invT * invT * y0 + 2 * invT * t * cy + t * t * y1;
    pts.push({ x, y });
  }
  return pts;
}

// Stable pseudo-random function based on a seed
function pseudoRandom(seed) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
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
  
  // Use a stable seed based on coordinates to stop flickering
  const stableSeed = Math.floor((Math.abs(x1) + Math.abs(y1) + Math.abs(x2) + Math.abs(y2)) * 100) % 10000;
  const wobble = (stableSeed % 100 / 100) * 20 - 10;
  const controlPointX = ctrlX + wobble;
  const controlPointY = ctrlY;

  // --- DRAW SHADOW LINE FIRST ---
  const shadowOffset = 3;
  graphics.lineStyle(width + 2, 0x000000, 0.25); // Slightly thicker, black, low alpha
  graphics.moveTo(x1 + shadowOffset, y1 + shadowOffset);
  graphics.quadraticCurveTo(controlPointX + shadowOffset, controlPointY + shadowOffset, x2 + shadowOffset, y2 + shadowOffset);

  if (animated) {
    // Draw HIGHLY VISIBLE animated dashed line with marching effect (Marching Ants)
    const dashLength = 30;
    const gapLength = 20;

    // Calculate points along the curve for dashed effect
    const steps = Math.min(100, Math.max(20, Math.floor(distance / 5)));
    const points = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * controlPointX + t * t * x2;
      const y = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * controlPointY + t * t * y2;
      points.push({ x, y });
    }

    // Draw background solid line first (dimmed original)
    graphics.lineStyle(width, color, 0.3);
    graphics.moveTo(x1, y1);
    graphics.quadraticCurveTo(controlPointX, controlPointY, x2, y2);

    // Draw bright animated dashes on top
    let currentDistance = -animationOffset;
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      const segmentLength = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));

      const startDist = currentDistance;
      const endDist = currentDistance + segmentLength;

      const dashCycle = dashLength + gapLength;
      const startMod = ((startDist % dashCycle) + dashCycle) % dashCycle;
      const endMod = ((endDist % dashCycle) + dashCycle) % dashCycle;

      if (startMod < dashLength || endMod < dashLength || startMod > endMod) {
        graphics.lineStyle(width * 2.5, 0xFFFFFF, 0.8); // White glow
        graphics.moveTo(p1.x, p1.y);
        graphics.lineTo(p2.x, p2.y);

        graphics.lineStyle(width * 2, color, 1); // Full opacity, thicker
        graphics.moveTo(p1.x, p1.y);
        graphics.lineTo(p2.x, p2.y);
      }
      currentDistance = endDist;
    }
  } else {
    // Realistic static yarn line
    const segments = Math.max(20, Math.floor(distance / 5));
    const points = getQuadraticBezierPoints(x1, y1, controlPointX, controlPointY, x2, y2, segments);
    
    // 1. Draw solid thick base line
    graphics.lineStyle(width, color, 1);
    graphics.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      graphics.lineTo(points[i].x, points[i].y);
    }

    // 2. Draw "Twisted" diagonal texture (Deterministic)
    const stepSize = Math.max(2, width * 1.2);
    let currentDist = 0;
    
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      const segDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const numSubSteps = Math.ceil(segDist / 2); 
      
      for (let j = 0; j < numSubSteps; j++) {
        currentDist += segDist / numSubSteps;
        if (currentDist >= stepSize) {
          currentDist = 0;
          const t = j / numSubSteps;
          const px = p1.x + (p2.x - p1.x) * t;
          const py = p1.y + (p2.y - p1.y) * t;
          const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
          
          const twistSeed = stableSeed + i * 10 + j;
          const twistAngle = angle + (Math.PI / 4) + (pseudoRandom(twistSeed) * 0.2 - 0.1);
          const randThick = Math.max(1, (width / 2) * (0.8 + pseudoRandom(twistSeed + 1) * 0.4));
          const randLen = width * (1.0 + pseudoRandom(twistSeed + 2) * 0.4);
          
          graphics.lineStyle(randThick, 0x000000, 0.4);
          
          const sx = px - Math.cos(twistAngle) * (randLen / 2);
          const sy = py - Math.sin(twistAngle) * (randLen / 2);
          const ex = px + Math.cos(twistAngle) * (randLen / 2);
          const ey = py + Math.sin(twistAngle) * (randLen / 2);
          graphics.moveTo(sx, sy);
          graphics.lineTo(ex, ey);
        }
      }
    }

    // 3. Draw a "Fibrous" highlight (Deterministic)
    const highlightWidth = Math.max(1, width / 3);
    for (let i = 0; i < points.length - 1; i++) {
      const highlightSeed = stableSeed + i * 7;
      if ((i % 2 === 0) || pseudoRandom(highlightSeed) > 0.5) {
        const jitterAlpha = 0.1 + (pseudoRandom(highlightSeed + 1) * 0.2);
        graphics.lineStyle(highlightWidth, 0xFFFFFF, jitterAlpha);
        graphics.moveTo(points[i].x, points[i].y);
        graphics.lineTo(points[i + 1].x, points[i + 1].y);
      }
    }
  }

  // 4. Draw dangling ends (Deterministic and Static)
  const drawDanglingEnd = (x, y, isStart) => {
    const endSeed = stableSeed + (isStart ? 123 : 456);
    const angle = (Math.PI / 2) + (pseudoRandom(endSeed) * 2.0 - 1.0); 
    const dangleLen = width * (3.0 + pseudoRandom(endSeed + 1) * 3.0);
    
    graphics.lineStyle(width, color, 1);
    const ex = x + Math.cos(angle) * dangleLen;
    const ey = y + Math.sin(angle) * dangleLen;
    graphics.moveTo(x, y);
    graphics.lineTo(ex, ey);

    graphics.lineStyle(Math.max(1, (width / 2) * (0.8 + pseudoRandom(endSeed + 2) * 0.4)), 0x000000, 0.4);
    graphics.moveTo(x, y);
    graphics.lineTo(ex, ey);
    
    graphics.lineStyle(Math.max(1, width / 3), 0xFFFFFF, 0.2);
    graphics.moveTo(x, y);
    graphics.lineTo(ex, ey);
  };

  drawDanglingEnd(x1, y1, true);
  drawDanglingEnd(x2, y2, false);
}

// Helper to get a realistic yarn color from a hex color
function getRealisticYarnColor(colorInput) {
  if (typeof foundry !== "undefined" && foundry.utils && foundry.utils.Color) {
    try {
      const c = foundry.utils.Color.from(colorInput);
      let hsl = c.hsl; 
      
      if (hsl[2] > 0.6) {
        hsl[2] *= 0.5;
      } else if (hsl[2] > 0.2) {
        hsl[2] *= 0.7;
      } else {
        hsl[2] = Math.max(hsl[2], 0.15);
      }
      
      if (hsl[1] > 0.1) {
         hsl[1] = Math.min(1, hsl[1] * 1.2);
      }

      let finalColor = c;
      if (c.r > 0.6 && c.g > 0.6 && c.b > 0.6) {
         finalColor = c.multiply(0.5); 
      } else {
         finalColor = c.multiply(0.7);
      }
      
      if (finalColor.r < 0.1 && finalColor.g < 0.1 && finalColor.b < 0.1) {
        finalColor = finalColor.add(foundry.utils.Color.from(0x222222)); 
      }

      return finalColor; 
    } catch (e) {
      console.warn("Error adjusting yarn color", e);
      return colorInput;
    }
  }
  return colorInput;
}

/**
 * Update pin positions and listeners. Call only when drawings change or canvas is ready.
 */
export function updatePins() {
  if (!canvas || !canvas.ready || !canvas.drawings) return;

  if (!pinsContainer || pinsContainer.destroyed) {
    pinsContainer = new PIXI.Container();
    pinsContainer.zIndex = 20;
    canvas.drawings.addChild(pinsContainer);
  } else {
    pinsContainer.removeChildren();
  }

  canvas.drawings.placeables.forEach(drawing => {
    const noteData = drawing.document.flags[MODULE_ID];
    if (noteData && drawing.pinSprite) {
      // Special handling for "Only Pin" notes: Keep sprite on drawing, do not move to global container
      if (noteData.type === "pin") {
        if (drawing.pinSprite.parent !== drawing) {
          drawing.addChild(drawing.pinSprite);
        }
        drawing.pinSprite.eventMode = 'static';
        drawing.pinSprite.cursor = 'pointer';
        drawing.pinSprite.removeAllListeners();
        // Determine width/height for centering (should be small, e.g. 50)
        const width = drawing.document.shape.width || 50;
        const height = drawing.document.shape.height || 50;
        drawing.pinSprite.width = width;
        drawing.pinSprite.height = height;
        drawing.pinSprite.position.set(0, 0); // Local to drawing

        drawing.pinSprite.on('click', (event) => onPinClick(event, drawing));
        return; // Skip the rest for this drawing
      }

      drawing.zIndex = 0;
      
      if (drawing.pinSprite.parent === drawing) {
        drawing.removeChild(drawing.pinSprite);
      }

      const isHandout = noteData.type === "handout";
      const isMedia = noteData.type === "media";
      const isPhoto = noteData.type === "photo";
      const isIndex = noteData.type === "index";

      let width, pinY;
      if (isHandout) {
        width = drawing.document.shape.width || 400;
        const height = drawing.document.shape.height || 400;
        pinY = drawing.document.y + (height * 0.05);
      } else if (isMedia) {
        width = drawing.document.shape.width || 400;
        pinY = drawing.document.y + 3;
      } else {
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
      drawing.pinSprite.eventMode = 'static';
      drawing.pinSprite.cursor = 'pointer';
      drawing.pinSprite.removeAllListeners();
      drawing.pinSprite.on('click', (event) => onPinClick(event, drawing));

      pinsContainer.addChild(drawing.pinSprite);
    }
  });
}

/**
 * Redraw all connection lines.
 * @param {number} animationOffset - Current offset for marching ants effect
 */
export function drawAllConnectionLines(animationOffset = 0) {
  if (!canvas || !canvas.ready || !canvas.drawings) return;

  // Reposition pins if containers are missing or count mismatch (safety check)
  const investigationNotes = canvas.drawings.placeables.filter(d => d.document.flags[MODULE_ID]);
  if (!pinsContainer || pinsContainer.destroyed || pinsContainer.children.length !== investigationNotes.length) {
    updatePins();
  }

  canvas.drawings.sortableChildren = true;

  if (!connectionLinesContainer || connectionLinesContainer.destroyed) {
    connectionLinesContainer = new PIXI.Graphics();
    connectionLinesContainer.zIndex = 10;
    canvas.drawings.addChild(connectionLinesContainer);
  } else {
    connectionLinesContainer.clear();
  }

  canvas.drawings.placeables.forEach(drawing => {
    const noteData = drawing.document.flags[MODULE_ID];
    if (!noteData) return;

    const connections = noteData.connections || [];
    if (connections.length === 0) return;

    const shouldAnimate = activeEditingDrawingId === drawing.document.id;
    const sourcePin = drawing._getPinPosition ? drawing._getPinPosition() : { x: drawing.document.x, y: drawing.document.y };

    connections.forEach(conn => {
      const targetDrawing = canvas.drawings.get(conn.targetId);
      if (!targetDrawing) return;

      const targetPin = targetDrawing._getPinPosition ? targetDrawing._getPinPosition() : { x: targetDrawing.document.x, y: targetDrawing.document.y };

      let lineColor = conn.color || game.settings.get(MODULE_ID, "connectionLineColor") || "#FF0000";
      const lineWidth = conn.width || game.settings.get(MODULE_ID, "connectionLineWidth") || 6;
      
      let colorNum;
      const realisticColor = getRealisticYarnColor(lineColor);
      
      if (typeof realisticColor === "number") {
          colorNum = realisticColor;
      } else if (realisticColor instanceof foundry.utils.Color) {
          colorNum = realisticColor.valueOf();
      } else if (typeof realisticColor === "string") {
        colorNum = parseInt(realisticColor.replace("#", ""), 16);
      } else {
         colorNum = 0xFF0000;
      }

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
    offset += 4;
    if (offset > 50) offset = 0;
    // Only redraw lines, not pins
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

  drawAllConnectionLines();
}

// Show connection numbers on connected notes
export function showConnectionNumbers(sourceDrawingId) {
  clearConnectionNumbers();

  const sourceDrawing = canvas.drawings.get(sourceDrawingId);
  if (!sourceDrawing) return;

  const connections = sourceDrawing.document.flags[MODULE_ID]?.connections || [];

  connections.forEach((conn, index) => {
    const targetDrawing = canvas.drawings.get(conn.targetId);
    if (!targetDrawing) return;

    const noteData = targetDrawing.document.flags[MODULE_ID];
    if (!noteData) return;

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
    numberText.zIndex = 100;

    canvas.drawings.addChild(numberText);
    connectionNumberOverlays.push(numberText);
  });
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

  const worldPos = event.getLocalPosition(canvas.stage);
  const firstPin = pinConnectionFirstNote._getPinPosition ? pinConnectionFirstNote._getPinPosition() : { x: pinConnectionFirstNote.document.x, y: pinConnectionFirstNote.document.y };

  connectionPreviewLine.clear();

  const playerColor = game.user.color || game.settings.get(MODULE_ID, "connectionLineColor") || "#FF0000";
  const width = game.settings.get(MODULE_ID, "connectionLineWidth") || 3;

  drawYarnLine(connectionPreviewLine, firstPin.x, firstPin.y, worldPos.x, worldPos.y, playerColor, width, false, 0);
}

// Start connection preview
function startConnectionPreview(drawing) {
  if (!connectionPreviewLine) {
    connectionPreviewLine = new PIXI.Graphics();
    connectionPreviewLine.zIndex = 15;
    canvas.drawings.sortableChildren = true;
    canvas.drawings.addChild(connectionPreviewLine);
  }

  canvas.stage.on('pointermove', onMouseMovePreview);
}

// Clear connection preview
export function clearConnectionPreview() {
  canvas.stage.off('pointermove', onMouseMovePreview);

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

  const isDuplicate = connections.some(conn => conn.targetId === targetDrawing.document.id);
  if (isDuplicate) {
    return;
  }

  const playerColor = game.user.color || game.settings.get(MODULE_ID, "connectionLineColor") || "#FF0000";
  const width = game.settings.get(MODULE_ID, "connectionLineWidth") || 6;

  connections.push({
    targetId: targetDrawing.document.id,
    color: playerColor,
    width: width
  });

  await collaborativeUpdate(sourceDrawing.document.id, {
    [`flags.${MODULE_ID}.connections`]: connections
  });

  drawAllConnectionLines();
}

// Pin-Click Connection Function
export function onPinClick(event, drawing) {
  event.stopPropagation();

  if (!InvestigationBoardState.isActive) return;

  const noteData = drawing.document.flags[MODULE_ID];
  if (!noteData) return;

  if (!pinConnectionFirstNote) {
    pinConnectionFirstNote = drawing;

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

    startConnectionPreview(drawing);

    return;
  }

  if (drawing === pinConnectionFirstNote) {
    ui.notifications.error("Cannot connect a note to itself.");
    return;
  }

  createConnection(pinConnectionFirstNote, drawing);
  resetPinConnectionState();
}

export function resetPinConnectionState() {
  pinConnectionFirstNote = null;
  if (pinConnectionHighlight) {
    try {
      if (!pinConnectionHighlight.destroyed) {
        if (pinConnectionHighlight.parent) pinConnectionHighlight.parent.removeChild(pinConnectionHighlight);
        pinConnectionHighlight.destroy();
      }
    } catch (err) {
      console.warn("Investigation Board: Error destroying pin highlight", err);
    }
    pinConnectionHighlight = null;
  }
  clearConnectionPreview();
}

export function cleanupConnectionLines() {
  if (connectionLinesContainer) {
    try {
      if (!connectionLinesContainer.destroyed) {
        if (connectionLinesContainer.parent) connectionLinesContainer.parent.removeChild(connectionLinesContainer);
        connectionLinesContainer.destroy({children: true, texture: false, baseTexture: false});
      }
    } catch (err) {
      console.warn("Investigation Board: Error destroying lines container", err);
    }
    connectionLinesContainer = null;
  }

  if (pinsContainer) {
    try {
      if (!pinsContainer.destroyed) {
        if (pinsContainer.parent) pinsContainer.parent.removeChild(pinsContainer);
        pinsContainer.destroy({children: true});
      }
    } catch (err) {
      console.warn("Investigation Board: Error destroying pins container", err);
    }
    pinsContainer = null;
  }
}