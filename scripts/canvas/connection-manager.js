import { MODULE_ID, DEFAULT_CONNECTION_LINE_WIDTH } from "../config.js";
import { InvestigationBoardState } from "../state.js";
import { collaborativeUpdate } from "../utils/socket-handler.js";
import { getEffectiveScale } from "../utils/helpers.js";

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

// Pin drag state
let pinDragState = null; // { drawing, startMouseX, startMouseY, startNoteX, startNoteY, noteWidth, noteHeight, isDragging, currentX, currentY }
const PIN_DRAG_THRESHOLD = 5; // pixels of movement before drag mode activates

// Flag: true for the synchronous tick after connection mode starts.
// Prevents the PIXI-synthesized click (from the same pointerdown→pointerup cycle that
// started connection mode) from immediately firing onCanvasClick and creating a pin.
let _connectionModeJustStarted = false;

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
  const sceneScale = getEffectiveScale();
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
  const wobble = (stableSeed % 100 / 100) * (20 * sceneScale) - (10 * sceneScale);
  const controlPointX = ctrlX + wobble;
  const controlPointY = ctrlY;

  // --- DRAW SHADOW LINE FIRST ---
  const shadowOffset = 3 * sceneScale;
  graphics.lineStyle(width + (2 * sceneScale), 0x000000, 0.25); // Slightly thicker, black, low alpha
  graphics.moveTo(x1 + shadowOffset, y1 + shadowOffset);
  graphics.quadraticCurveTo(controlPointX + shadowOffset, controlPointY + shadowOffset, x2 + shadowOffset, y2 + shadowOffset);

  if (animated) {
    // Draw HIGHLY VISIBLE animated dashed line with marching effect (Marching Ants)
    const dashLength = 30 * sceneScale;
    const gapLength = 20 * sceneScale;

    // Calculate points along the curve for dashed effect
    const steps = Math.min(100, Math.max(20, Math.floor(distance / (5 * sceneScale))));
    const points = getQuadraticBezierPoints(x1, y1, controlPointX, controlPointY, x2, y2, steps);

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
    const segments = Math.max(20, Math.floor(distance / (5 * sceneScale)));
    const points = getQuadraticBezierPoints(x1, y1, controlPointX, controlPointY, x2, y2, segments);
    
    // 1. Draw solid thick base line
    graphics.lineStyle(width, color, 1);
    graphics.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      graphics.lineTo(points[i].x, points[i].y);
    }

    // 2. Draw "Twisted" diagonal texture (Deterministic)
    const stepSize = Math.max(2 * sceneScale, width * 1.2);
    let currentDist = 0;
    
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      const segDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const numSubSteps = Math.ceil(segDist / (2 * sceneScale)); 
      
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
          const randThick = Math.max(1 * sceneScale, (width / 2) * (0.8 + pseudoRandom(twistSeed) * 0.4));
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
    const highlightWidth = Math.max(1 * sceneScale, width / 3);
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

    graphics.lineStyle(Math.max(1 * sceneScale, (width / 2) * (0.8 + pseudoRandom(endSeed + 2) * 0.4)), 0x000000, 0.4);
    graphics.moveTo(x, y);
    graphics.lineTo(ex, ey);
    
    graphics.lineStyle(Math.max(1 * sceneScale, width / 3), 0xFFFFFF, 0.2);
    graphics.moveTo(x, y);
    graphics.lineTo(ex, ey);
  };

  drawDanglingEnd(x1, y1, true);
  drawDanglingEnd(x2, y2, false);
}

// Convert any color value (Color object, CSS string, or number) to a plain integer
// suitable for PIXI lineStyle, with a subtle darkening for yarn texture feel.
function toYarnColorNum(colorInput) {
  // Step 1: get a raw integer from whatever form colorInput is in
  let raw;
  if (typeof colorInput === "string") {
    raw = parseInt(colorInput.replace("#", ""), 16);
  } else {
    // Handles plain numbers AND Color-extends-Number objects — Number() calls valueOf()
    raw = Number(colorInput);
  }
  if (!Number.isFinite(raw) || raw < 0 || raw > 0xFFFFFF) return 0xFF0000;

  // Step 2: darken slightly using the static method (plain numbers in, plain number out)
  // Light/white colors: 25% darker; everything else: 15% darker.
  const isLight = ((raw >> 16 & 0xFF) > 178) && ((raw >> 8 & 0xFF) > 178) && ((raw & 0xFF) > 178);
  return foundry.utils.Color.multiplyScalar(raw, isLight ? 0.75 : 0.85);
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
      drawing.zIndex = 0;

      // Sprite size: the pin type IS the note (arbitrary size); every other type gets
      // a fixed 40x40 pin icon. Position: _getPinPosition() is the single source of
      // truth for the pin's center — offset by half the sprite size for its top-left.
      const noteWidth = drawing.document.shape.width || 200;
      const noteHeight = drawing.document.shape.height || 200;
      const pinW = noteData.type === "pin" ? noteWidth : 40;
      const pinH = noteData.type === "pin" ? noteHeight : 40;
      const center = drawing._getPinPosition ? drawing._getPinPosition() : { x: drawing.document.x + pinW / 2, y: drawing.document.y + pinH / 2 };
      const pinX = center.x - pinW / 2;
      const pinY = center.y - pinH / 2;

      drawing.pinSprite.width = pinW;
      drawing.pinSprite.height = pinH;
      drawing.pinSprite.x = pinX;
      drawing.pinSprite.y = pinY;
      drawing.pinSprite.eventMode = 'static';
      drawing.pinSprite.cursor = 'pointer';
      // Register the pointerdown listener once per sprite lifetime instead of tearing
      // down and re-adding it on every redraw (including every ticker frame during
      // connection animation). The handler reads noteData fresh from the document on
      // each call, so it stays correct even if the note's type changes later.
      if (!drawing.pinSprite._ibPointerDownBound) {
        drawing.pinSprite._ibPointerDownBound = true;
        drawing.pinSprite.on('pointerdown', (event) => {
          const liveNoteData = drawing.document.flags[MODULE_ID];
          if (event.button === 2 && InvestigationBoardState.isActive && liveNoteData?.type === "pin") {
            // Right-click on a standalone pin: open the context menu.
            // _showContextMenu synchronously cancels connection mode (resetPinConnectionState)
            // before its first await, which removes the stage-level onCanvasRightClick listener
            // before pointerup/rightclick can fire it. The Create-note menu never appears.
            event.stopPropagation();
            drawing._showContextMenu(event);
            return;
          }
          onPinPointerDown(event, drawing);
        });
      }
      drawing.pinSprite.visible = !drawing.document.hidden || game.user.isGM;
      drawing.pinSprite.alpha = (game.user.isGM && drawing.document.hidden) ? 0.4 : 1;

      pinsContainer.addChild(drawing.pinSprite);
    }
  });
}

// Coalesces bursts of updatePins()+drawAllConnectionLines() calls (e.g. N notes each
// calling draw()/refresh() during canvasReady or a bulk import) into a single pass on
// the next animation frame, instead of running the full O(N) global redraw N times.
let _globalRedrawScheduled = false;
export function requestGlobalRedraw() {
  if (_globalRedrawScheduled) return;
  _globalRedrawScheduled = true;
  requestAnimationFrame(() => {
    _globalRedrawScheduled = false;
    updatePins();
    drawAllConnectionLines();
  });
}

/**
 * Redraw all connection lines.
 * @param {number} animationOffset - Current offset for marching ants effect
 */
export function drawAllConnectionLines(animationOffset = 0) {
  if (!canvas || !canvas.ready || !canvas.drawings) return;
  const sceneScale = getEffectiveScale();

  // Reposition pins if containers are missing or count mismatch (safety check).
  // Only count notes that actually have a pinSprite — pinColor:"none" notes and
  // video-media notes have none, so comparing against all IB notes caused a permanent
  // mismatch that ran updatePins() (listener churn) on every redraw, including every
  // ticker frame while an edit dialog is open.
  const expectedPinCount = canvas.drawings.placeables.filter(d => d.document.flags[MODULE_ID] && d.pinSprite).length;
  if (!pinsContainer || pinsContainer.destroyed || pinsContainer.children.length !== expectedPinCount) {
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

      let lineColor = conn.color || "#FF0000";
      const lineWidth = (conn.width || game.settings.get(MODULE_ID, "connectionLineWidth") || DEFAULT_CONNECTION_LINE_WIDTH) * sceneScale;
      const colorNum = toYarnColorNum(lineColor);
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
  const sceneScale = getEffectiveScale();
  animationTickerId = () => {
    offset += (4 * sceneScale);
    if (offset > (50 * sceneScale)) offset = 0;
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
  const sceneScale = getEffectiveScale();

  connections.forEach((conn, index) => {
    const targetDrawing = canvas.drawings.get(conn.targetId);
    if (!targetDrawing) return;

    const noteData = targetDrawing.document.flags[MODULE_ID];
    if (!noteData) return;

    // shape.width/height are the authoritative world-space size for the actual
    // rendered note (any type, any resize) — never multiply by sceneScale.
    const width = targetDrawing.document.shape.width || 200;
    const height = targetDrawing.document.shape.height || 200;

    const numberText = new PIXI.Text(String(index + 1), {
      fontFamily: "Arial",
      fontSize: Math.max(48 * sceneScale, width / 4),
      fontWeight: "bold",
      fill: "#FFFFFF",
      stroke: "#000000",
      strokeThickness: 6 * sceneScale,
      dropShadow: true,
      dropShadowDistance: 3 * sceneScale,
      dropShadowBlur: 4 * sceneScale,
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

  const playerColor = game.user.color || "#FF0000";
  const sceneScale = getEffectiveScale();
  const width = (game.settings.get(MODULE_ID, "connectionLineWidth") || DEFAULT_CONNECTION_LINE_WIDTH) * sceneScale;

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

/**
 * Finds all notes (other than targetId itself) whose connections array has an entry
 * pointing at targetId. Connections are stored one-directionally in the source note,
 * so "incoming" connections to a note can only be found by scanning every other note.
 * @param {string} targetId
 * @returns {CustomDrawing[]}
 */
function findNotesWithIncomingConnections(targetId) {
  return canvas.drawings.placeables.filter(d => {
    if (d.document.id === targetId) return false;
    return d.document.flags[MODULE_ID]?.connections?.some(c => c.targetId === targetId);
  });
}

/**
 * Rewrites every connection pointing at targetId across all other notes, via mapFn.
 * Return a replacement connection object to remap it (e.g. a new targetId), or a
 * falsy value to drop it (e.g. for "remove all connections"). Fires all the resulting
 * updates concurrently and resolves once they've all been requested.
 * @param {string} targetId
 * @param {(conn: object) => object|null|undefined} mapFn
 */
export async function updateIncomingConnections(targetId, mapFn) {
  const notes = findNotesWithIncomingConnections(targetId);
  await Promise.all(notes.map(note => {
    const updated = note.document.flags[MODULE_ID].connections
      .map(c => (c.targetId === targetId ? mapFn(c) : c))
      .filter(Boolean);
    return collaborativeUpdate(note.document.id, { [`flags.${MODULE_ID}.connections`]: updated });
  }));
}

async function createConnection(sourceDrawing, targetDrawing) {
  const connections = sourceDrawing.document.flags[MODULE_ID]?.connections || [];

  const isDuplicate = connections.some(conn => conn.targetId === targetDrawing.document.id);
  // Connections are stored one-directionally in the source note only, so also check the
  // target's own connections for the reverse edge — otherwise B→A can be created when
  // A→B already exists, drawing two overlapping yarns.
  const targetConnections = targetDrawing.document.flags[MODULE_ID]?.connections || [];
  const isReverseDuplicate = targetConnections.some(conn => conn.targetId === sourceDrawing.document.id);
  if (isDuplicate || isReverseDuplicate) {
    return;
  }

  // Convert Color object to a plain CSS string so Foundry's mergeObject doesn't mangle it.
  // Color extends Number, and mergeObject spreads enumerable own props → {}, losing the value.
  const playerColor = game.user.color?.css ?? "#FF0000";
  const width = game.settings.get(MODULE_ID, "connectionLineWidth") || DEFAULT_CONNECTION_LINE_WIDTH;

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

// Pin pointer-down: decides between drag and click (connection)
function onPinPointerDown(event, drawing) {
  event.stopPropagation();

  if (!InvestigationBoardState.isActive) return;

  const noteData = drawing.document.flags[MODULE_ID];
  if (!noteData) return;

  // If already in connection mode, complete or reject the connection immediately
  if (pinConnectionFirstNote) {
    if (drawing === pinConnectionFirstNote) {
      ui.notifications.error("Cannot connect a note to itself.");
      return;
    }
    createConnection(pinConnectionFirstNote, drawing);
    resetPinConnectionState();
    return;
  }

  // Start drag tracking — will resolve to drag or click on pointerup
  const worldPos = event.getLocalPosition(canvas.stage);
  pinDragState = {
    drawing,
    startMouseX: worldPos.x,
    startMouseY: worldPos.y,
    startNoteX: drawing.document.x,
    startNoteY: drawing.document.y,
    noteWidth: drawing.document.shape.width || 40,
    noteHeight: drawing.document.shape.height || 40,
    isDragging: false,
    currentX: drawing.document.x,
    currentY: drawing.document.y,
  };

  canvas.stage.on('pointermove', onPinDragMove);
  canvas.stage.once('pointerup', onPinPointerUp);
}

function onPinDragMove(event) {
  if (!pinDragState) return;
  // Locked notes may still be pin-clicked to start a connection (handled on pointerup
  // when isDragging never flips true), just not repositioned by dragging the pin.
  if (pinDragState.drawing.document.locked) return;

  const worldPos = event.getLocalPosition(canvas.stage);
  const dx = worldPos.x - pinDragState.startMouseX;
  const dy = worldPos.y - pinDragState.startMouseY;

  if (!pinDragState.isDragging && Math.sqrt(dx * dx + dy * dy) > PIN_DRAG_THRESHOLD) {
    pinDragState.isDragging = true;
    document.body.style.cursor = 'grabbing';
  }

  if (pinDragState.isDragging) {
    const newX = pinDragState.startNoteX + dx;
    const newY = pinDragState.startNoteY + dy;
    pinDragState.currentX = newX;
    pinDragState.currentY = newY;

    const { drawing, noteWidth, noteHeight } = pinDragState;

    // Move note body visually (shape is positioned at center with pivot at center)
    if (drawing.shape && !drawing.shape.destroyed) {
      drawing.shape.position.set(newX + noteWidth / 2, newY + noteHeight / 2);
    }

    // Move pin sprite visually (it lives in pinsContainer at world coords).
    // _getPinPosition(newX, newY) previews the center at the not-yet-committed drag
    // position — same formula updatePins() uses once the position is saved.
    if (drawing.pinSprite && !drawing.pinSprite.destroyed && drawing._getPinPosition) {
      const noteData = drawing.document.flags[MODULE_ID];
      const pinW = noteData?.type === "pin" ? noteWidth : 40;
      const pinH = noteData?.type === "pin" ? noteHeight : 40;
      const center = drawing._getPinPosition(newX, newY);
      drawing.pinSprite.x = center.x - pinW / 2;
      drawing.pinSprite.y = center.y - pinH / 2;
    }
  }
}

async function onPinPointerUp(event) {
  canvas.stage.off('pointermove', onPinDragMove);
  document.body.style.cursor = '';

  if (!pinDragState) return;

  const state = pinDragState;
  pinDragState = null;

  if (state.isDragging) {
    // Commit new position — hooks will redraw connections and reposition pins
    await collaborativeUpdate(state.drawing.document.id, {
      x: state.currentX,
      y: state.currentY,
    });
  } else {
    // Was a plain click — start connection mode
    _startConnectionMode(state.drawing);
  }
}

// Starts the yarn-connection mode from a pin click
function _startConnectionMode(drawing) {
  pinConnectionFirstNote = drawing;

  if (pinConnectionHighlight) {
    if (pinConnectionHighlight.parent) pinConnectionHighlight.parent.removeChild(pinConnectionHighlight);
    pinConnectionHighlight.destroy();
  }

  const sceneScale = getEffectiveScale();
  pinConnectionHighlight = new PIXI.Graphics();
  pinConnectionHighlight.lineStyle(4 * sceneScale, 0x00ff00, 1);

  // shape.width/height are already world-space — never multiply by sceneScale.
  const highlightW = drawing.document.shape.width || 40;
  const highlightH = drawing.document.shape.height || 40;

  pinConnectionHighlight.drawRect(
    drawing.document.x,
    drawing.document.y,
    highlightW,
    highlightH
  );
  canvas.controls.addChild(pinConnectionHighlight);

  startConnectionPreview(drawing);

  // Guard against the PIXI-synthesized click that fires in the same synchronous task as
  // the pointerup that triggered _startConnectionMode. Without this, onCanvasClick would
  // fire immediately and create a pin right under the cursor.
  _connectionModeJustStarted = true;
  setTimeout(() => { _connectionModeJustStarted = false; }, 0);

  canvas.stage.once('click', onCanvasClick);
  canvas.stage.once('rightclick', onCanvasRightClick);
}

/**
 * Handle left click on canvas background while dragging yarn
 */
async function onCanvasClick(event) {
  // Skip the bubbled synthetic click produced by PIXI from the same pointerdown→pointerup
  // cycle that started connection mode. Re-arm the listener for the next real canvas click.
  if (_connectionModeJustStarted) {
    _connectionModeJustStarted = false;
    canvas.stage.once('click', onCanvasClick);
    return;
  }

  // If connection was cancelled or already finished, do nothing
  if (!pinConnectionFirstNote) return;

  // Prevent this from firing if we clicked another pin (onPinPointerDown handles that
  // and should stop propagation, but just in case, we check if the target is a pin or
  // investigation board note)
  const target = event.target;
  if (target && (target.document?.flags?.[MODULE_ID] || target.parent?.document?.flags?.[MODULE_ID])) {
    return;
  }

  const worldPos = event.getLocalPosition(canvas.stage);

  // Create a new pin note at this location
  // We need to center it on the mouse, so we subtract half its width.
  // pinW is a world-space size (matches the 40x40 shape createNote() gives a pin) —
  // no sceneScale factor, per the module's shape-vs-sceneScale coordinate rule.
  const pinW = 40;
  const pinX = worldPos.x - pinW / 2;
  const pinY = worldPos.y - pinW / 2;

  import("../utils/creation-utils.js").then(async (m) => {
    const newNote = await m.createNote("pin", { x: pinX, y: pinY });
    
    if (newNote) {
      // Inherit pin color from the first note if it has one
      const firstNoteData = pinConnectionFirstNote.document.flags[MODULE_ID];
      if (firstNoteData.pinColor) {
        await collaborativeUpdate(newNote.id, { [`flags.${MODULE_ID}.pinColor`]: firstNoteData.pinColor });
      }

      // Wait a bit for the drawing to be registered in canvas.drawings
      setTimeout(() => {
        const targetDrawing = canvas.drawings.get(newNote.id);
        if (targetDrawing) {
          createConnection(pinConnectionFirstNote, targetDrawing);
          resetPinConnectionState();
        }
      }, 100);
    } else {
      resetPinConnectionState();
    }
  });
}

/**
 * Handle right click on canvas background while dragging yarn
 */
function onCanvasRightClick(event) {
  if (!pinConnectionFirstNote) return;

  const screenPos = event.data.global;

  // Remove any existing custom context menus
  document.querySelectorAll('.ib-context-menu').forEach(el => el.remove());

  const menu = document.createElement('div');
  menu.classList.add('ib-context-menu');
  menu.style.position = 'fixed';
  menu.style.top = `${screenPos.y}px`;
  menu.style.left = `${screenPos.x}px`;
  menu.style.zIndex = '10000';

  const noteTypes = [
    { id: 'sticky', label: 'Sticky Note', icon: 'fas fa-sticky-note' },
    { id: 'photo', label: 'Photo Note', icon: 'fa-solid fa-camera-polaroid' },
    { id: 'index', label: 'Index Card', icon: 'fa-regular fa-subtitles' },
    { id: 'media', label: 'Media Note', icon: 'fas fa-cassette-tape' },
  ];

  noteTypes.forEach(type => {
    const item = document.createElement('div');
    item.classList.add('ib-context-menu-item');
    item.innerHTML = `<i class="${type.icon}"></i> Create ${type.label}`;
    item.onclick = async (e) => {
      e.stopPropagation();
      menu.remove();
      
      // Read dimensions from the same single source createNote() uses
      const { getNoteDimensions } = await import("../utils/creation-utils.js");
      const { width: noteWidth, height: noteHeight } = getNoteDimensions(type.id);

      // Place the new note clear of the source. shape.width/height are world-space
      // sizes (the raw stored values, not multiplied by sceneScale), so all distance
      // math here is in plain world units with no sceneScale factor.
      const srcDoc = pinConnectionFirstNote.document;
      const srcW = srcDoc.shape.width || 200;
      const srcH = srcDoc.shape.height || 200;
      const srcCenterX = srcDoc.x + srcW / 2;
      const srcCenterY = srcDoc.y + srcH / 2;

      // Direction: push outward from the viewport center so notes spread naturally.
      // Use a 30° (right-down) fallback when the note sits very close to center.
      const viewCenter = canvas.stage.pivot;
      const outDx = srcCenterX - viewCenter.x;
      const outDy = srcCenterY - viewCenter.y;
      const outDist = Math.sqrt(outDx * outDx + outDy * outDy);
      const angle = outDist < 10 ? Math.PI / 6 : Math.atan2(outDy, outDx);

      // Minimum gap: sum of both half-diagonals + 40 world units.
      const srcHalfDiag = Math.sqrt(srcW * srcW + srcH * srcH) / 2;
      const tgtHalfDiag = Math.sqrt(noteWidth * noteWidth + noteHeight * noteHeight) / 2;
      const minDist = srcHalfDiag + tgtHalfDiag + 40;

      const targetCenterX = srcCenterX + Math.cos(angle) * minDist;
      const targetCenterY = srcCenterY + Math.sin(angle) * minDist;

      const posX = targetCenterX - noteWidth / 2;
      const posY = targetCenterY - noteHeight / 2;

      import("../utils/creation-utils.js").then(async (m) => {
        const newNote = await m.createNote(type.id, { x: posX, y: posY });
        if (newNote) {
          setTimeout(() => {
            const targetDrawing = canvas.drawings.get(newNote.id);
            if (targetDrawing) {
              createConnection(pinConnectionFirstNote, targetDrawing);
              resetPinConnectionState();
            }
          }, 100);
        } else {
          resetPinConnectionState();
        }
      });
    };
    menu.appendChild(item);
  });

  document.body.appendChild(menu);

  const closeMenu = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener('mousedown', closeMenu);
      // Dismissing without picking a type would otherwise leave connection mode stuck:
      // the preview line keeps following the cursor but neither click nor right-click
      // does anything until Escape or another pin is clicked.
      resetPinConnectionState();
    }
  };
  setTimeout(() => { document.addEventListener('mousedown', closeMenu); }, 100);
  
  // Stop the connection preview from being weird during menu
  // (stage.once is already consumed by the right click, but we need to cancel the left click listener too)
  canvas.stage.off('click', onCanvasClick);
}

export function resetPinConnectionState() {
  // Clean up any in-progress drag
  if (pinDragState) {
    canvas.stage.off('pointermove', onPinDragMove);
    canvas.stage.off('pointerup', onPinPointerUp);
    document.body.style.cursor = '';
    pinDragState = null;
  }
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
  // Cleanup stage listeners
  canvas.stage.off('click', onCanvasClick);
  canvas.stage.off('rightclick', onCanvasRightClick);
}

/**
 * Returns true when a yarn connection is currently being drawn (first pin selected).
 * Used by the keybinding handler to decide whether to consume the Escape key.
 */
export function isInConnectionMode() {
  return pinConnectionFirstNote !== null;
}

/**
 * Start connection-creation mode from a given drawing programmatically —
 * equivalent to a user clicking that note's pin.  Safe to call from context menus.
 * @param {CustomDrawing} drawing
 */
export function beginConnectionFrom(drawing) {
  if (!InvestigationBoardState.isActive) return;
  _startConnectionMode(drawing);
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