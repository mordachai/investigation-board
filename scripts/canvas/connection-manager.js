import { MODULE_ID, DEFAULT_CONNECTION_LINE_WIDTH, DEFAULT_CONNECTION_LINE_STYLE } from "../config.js";
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

// ---------------------------------------------------------------------------
// 4-anchor connectors (circuit/sci-fi line style only). Classic/yarn mode never
// touches any of this — it's a fully separate interaction path from pinDragState/
// pinConnectionFirstNote above, gated everywhere on connectionLineStyle === "circuit".
// ---------------------------------------------------------------------------
const ANCHOR_SIDES = ["top", "right", "bottom", "left"];
const ANCHOR_HIT_RADIUS = 12; // world units at scale 1 — click/hitArea radius per anchor dot
const LINE_HIT_TOLERANCE = 10; // world units at scale 1 — shift+click-on-line tolerance

// New-connection drag from an anchor dot: { sourceDrawing, sourceAnchor, onMove, onUp }
let anchorDragState = null;
// Rewire drag after shift+clicking an existing line's near end:
// { fixedDrawing, fixedAnchor, movingEnd, color, width, originalConn, originalSourceDrawing, onMove, onUp }
let rewireDragState = null;

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

// ---------------------------------------------------------------------------
// Circuit-style connection line (sci-fi theme) — a glowing orthogonal-routed
// "PCB trace" look, replacing the yarn's sag/twisted-fiber rendering entirely.
// ---------------------------------------------------------------------------

// Convert any color value to a plain integer for circuit-style lineStyle — no
// darkening (unlike toYarnColorNum): sci-fi wants bright saturated neon, not a
// muted string tone.
function toCircuitColorNum(colorInput) {
  let raw;
  if (typeof colorInput === "string") {
    raw = parseInt(colorInput.replace("#", ""), 16);
  } else {
    raw = Number(colorInput);
  }
  if (!Number.isFinite(raw) || raw < 0 || raw > 0xFFFFFF) return 0x00FFF2;
  return raw;
}

// Outward normal / axis per anchor side — drives the perpendicular "stub" every route
// leaves/enters on, so a line always exits a note straight out from whichever edge it's
// pinned to instead of cutting back across the note body toward wherever the other end
// happens to sit.
const ANCHOR_DIR = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const ANCHOR_AXIS = { top: "v", bottom: "v", left: "h", right: "h" };

// Builds an orthogonal (Manhattan) route between two anchored points, honoring each
// side's exit direction so top/bottom connections always leave vertically and
// left/right ones always leave horizontally — this is what keeps same-side connections
// parallel to each other instead of criss-crossing at different angles depending on
// where the other note happens to be.
//
// Each end first steps out `stubLen` along its own anchor normal (the "stub"). Then:
//   - same side on both ends (bottom↔bottom, top↔top, left↔left, right↔right) → U-shape,
//     bent at whichever stub reaches farthest in the shared exit direction (not an
//     average) — both stubs point the SAME way, so the far note usually still has more
//     of itself beyond the near note's stub; averaging would cut the bend straight
//     through it. Going all the way past the farther one is what actually clears both.
//   - opposite sides, same axis (top↔bottom, left↔right) → Z-shape, bent on the shared
//     midline average between the two stub points — there's real clearance between them.
//   - different axis (e.g. right↔top) → a single-bend L/C shape, corner placed so each
//     leg keeps its forced exit axis.
// `side2` may be omitted for a live in-progress drag (endpoint is the free cursor, not
// a real anchor) — the route still leaves `side1` straight, then bends once toward the
// raw point with no forced arrival axis or stub-in.
function getCircuitRoutePoints(x1, y1, side1, x2, y2, side2, stubLen) {
  const d1 = ANCHOR_DIR[side1] || ANCHOR_DIR.top;
  const axis1 = ANCHOR_AXIS[side1] || "v";
  const e1 = { x: x1 + d1.x * stubLen, y: y1 + d1.y * stubLen };

  if (!side2) {
    const bend = axis1 === "v" ? { x: e1.x, y: y2 } : { x: x2, y: e1.y };
    return [{ x: x1, y: y1 }, e1, bend, { x: x2, y: y2 }];
  }

  const d2 = ANCHOR_DIR[side2] || ANCHOR_DIR.top;
  const axis2 = ANCHOR_AXIS[side2] || "v";
  const e2 = { x: x2 + d2.x * stubLen, y: y2 + d2.y * stubLen };

  let mids;
  if (axis1 !== axis2) {
    const corner = axis1 === "v" ? { x: e1.x, y: e2.y } : { x: e2.x, y: e1.y };
    mids = [corner];
  } else if (side1 === side2) {
    if (axis1 === "v") {
      const midY = d1.y > 0 ? Math.max(e1.y, e2.y) : Math.min(e1.y, e2.y);
      mids = [{ x: e1.x, y: midY }, { x: e2.x, y: midY }];
    } else {
      const midX = d1.x > 0 ? Math.max(e1.x, e2.x) : Math.min(e1.x, e2.x);
      mids = [{ x: midX, y: e1.y }, { x: midX, y: e2.y }];
    }
  } else if (axis1 === "v") {
    const midY = (e1.y + e2.y) / 2;
    mids = [{ x: e1.x, y: midY }, { x: e2.x, y: midY }];
  } else {
    const midX = (e1.x + e2.x) / 2;
    mids = [{ x: midX, y: e1.y }, { x: midX, y: e2.y }];
  }

  return [{ x: x1, y: y1 }, e1, ...mids, e2, { x: x2, y: y2 }];
}

function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

// Walks `points` and returns the coordinate `dist` world units along the polyline.
function pointAtDistance(points, dist) {
  let remaining = dist;
  for (let i = 1; i < points.length; i++) {
    const segLen = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    if (remaining <= segLen || i === points.length - 1) {
      const t = segLen === 0 ? 0 : Math.min(remaining / segLen, 1);
      return {
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * t,
      };
    }
    remaining -= segLen;
  }
  return points[points.length - 1];
}

function strokePolyline(graphics, points, lineWidth, color, alpha) {
  graphics.lineStyle(lineWidth, color, alpha);
  graphics.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) graphics.lineTo(points[i].x, points[i].y);
}

// Cuts each interior corner of a polyline down to a 45°-ish diagonal segment —
// the classic PCB-trace look (schematic routing tools chamfer their right-angle
// bends instead of leaving them square). Each corner is clipped back along both
// adjacent segments by `size` (capped at half that segment's own length so short
// hops near the endpoints don't produce a self-overlapping chamfer).
function chamferCorners(points, size) {
  if (points.length < 3) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1], cur = points[i], next = points[i + 1];
    const d1 = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const d2 = Math.hypot(next.x - cur.x, next.y - cur.y);
    const s = Math.min(size, d1 * 0.5, d2 * 0.5);
    if (s < 1) { out.push(cur); continue; }
    out.push({ x: cur.x - (cur.x - prev.x) * (s / d1), y: cur.y - (cur.y - prev.y) * (s / d1) });
    out.push({ x: cur.x + (next.x - cur.x) * (s / d2), y: cur.y + (next.y - cur.y) * (s / d2) });
  }
  out.push(points[points.length - 1]);
  return out;
}

// Small glowing node dot — bright/larger at a connection's true endpoints, smaller
// at route bend corners — matching the schematic-diagram reference (thin glowing
// traces with round junction dots), replacing the yarn's frayed dangling tail.
function drawCircuitDot(graphics, x, y, color, width, isEndpoint) {
  const size = isEndpoint ? Math.max(width * 1.4, 4) : Math.max(width * 0.9, 2.5);
  graphics.lineStyle(0);
  graphics.beginFill(color, 0.18);
  graphics.drawCircle(x, y, size * 2.4);
  graphics.endFill();
  graphics.beginFill(0xFFFFFF, 0.95);
  graphics.drawCircle(x, y, size);
  graphics.endFill();
}

// Helper function to draw a circuit-style connection line
function drawCircuitLine(graphics, x1, y1, side1, x2, y2, side2, color, width, animated = false, animationOffset = 0) {
  const sceneScale = getEffectiveScale();
  const chamferSize = Math.max(width * 3, 16 * sceneScale);
  const stubLen = Math.max(width * 4, 28 * sceneScale);
  const routeCorners = getCircuitRoutePoints(x1, y1, side1, x2, y2, side2, stubLen);
  const points = chamferCorners(routeCorners, chamferSize);

  // Layered glow passes fake a bloom effect without a PIXI filter dependency —
  // same "multiple stroke passes" technique drawYarnLine uses for its shadow/highlight.
  // Thinner than the yarn's own layering, matching a schematic trace's finer line weight.
  strokePolyline(graphics, points, width * 3, color, 0.10);
  strokePolyline(graphics, points, width * 1.6, color, 0.3);
  strokePolyline(graphics, points, Math.max(width * 0.6, 1), 0xFFFFFF, 0.9);

  drawCircuitDot(graphics, x1, y1, color, width, true);
  drawCircuitDot(graphics, x2, y2, color, width, true);
  // Bend markers sit at every interior route point (pre-chamfer) — the route's point
  // count now varies (1 corner for an L-shape, 2 for a Z/U-shape), unlike the old
  // always-4-point route.
  for (let i = 1; i < routeCorners.length - 1; i++) {
    drawCircuitDot(graphics, routeCorners[i].x, routeCorners[i].y, color, width, false);
  }

  if (animated) {
    // Reuses the yarn ticker's 0..(50*sceneScale) sawtooth offset as a 0..1 phase,
    // so a bright pulse travels the full route once per cycle instead of dashes marching.
    const total = pathLength(points);
    if (total > 0) {
      const cycle = 50 * sceneScale;
      const phase = (animationOffset % cycle) / cycle;
      const pulsePos = pointAtDistance(points, phase * total);
      const pulseSize = Math.max(width * 1.4, 3);
      graphics.lineStyle(0);
      graphics.beginFill(0xFFFFFF, 0.25);
      graphics.drawCircle(pulsePos.x, pulsePos.y, pulseSize * 2.5);
      graphics.endFill();
      graphics.beginFill(0xFFFFFF, 1);
      graphics.drawCircle(pulsePos.x, pulsePos.y, pulseSize);
      graphics.endFill();
    }
  }
}

// Dispatches to the yarn or circuit renderer based on the connectionLineStyle world
// setting, and applies the matching color-conversion function for that style.
// side1/side2 ("top"|"right"|"bottom"|"left") are anchor sides, circuit-mode only —
// side2 may be omitted for a live drag preview (free-floating endpoint). Yarn mode
// ignores both; its curve is a pure function of the two points.
function drawConnectionLine(graphics, x1, y1, side1, x2, y2, side2, colorInput, width, animated = false, animationOffset = 0) {
  const style = game.settings.get(MODULE_ID, "connectionLineStyle") || DEFAULT_CONNECTION_LINE_STYLE;
  if (style === "circuit") {
    drawCircuitLine(graphics, x1, y1, side1, x2, y2, side2, toCircuitColorNum(colorInput), width, animated, animationOffset);
  } else {
    drawYarnLine(graphics, x1, y1, x2, y2, toYarnColorNum(colorInput), width, animated, animationOffset);
  }
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

  const lineStyle = game.settings.get(MODULE_ID, "connectionLineStyle") || DEFAULT_CONNECTION_LINE_STYLE;

  canvas.drawings.placeables.forEach(drawing => {
    const noteData = drawing.document.flags[MODULE_ID];
    if (noteData && drawing.pinSprite) {
      drawing.zIndex = 0;

      const hiddenFromViewer = !!(drawing.document.hidden && !game.user.isGM);
      const hiddenAlpha = (game.user.isGM && drawing.document.hidden) ? 0.4 : 1;

      // Circuit/sci-fi style gets 4 draggable edge anchors instead of the single top pin
      // — "pin"-type notes are excluded (already just a dot, 4 sides add nothing —
      // see _getAnchorPosition's own pin special-case for the render/hit-test side of this).
      const useAnchors = lineStyle === "circuit" && noteData.type !== "pin";

      if (useAnchors) {
        drawing.pinSprite.visible = false;
        _updateAnchorSprites(drawing, hiddenFromViewer, hiddenAlpha);
      } else {
        if (drawing._anchorSprites) _destroyAnchorSprites(drawing);

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
        drawing.pinSprite.visible = !hiddenFromViewer;
        drawing.pinSprite.alpha = hiddenAlpha;

        pinsContainer.addChild(drawing.pinSprite);
      }
    }
  });
}

// Builds/repositions the 4 small glowing edge-anchor dots for one note (circuit style
// only). Lazily created once per drawing on drawing._anchorSprites, same reuse pattern
// as drawing.pinSprite — cheap PIXI.Graphics circles, no texture loading needed.
function _updateAnchorSprites(drawing, hidden, alpha) {
  if (!drawing._anchorSprites) drawing._anchorSprites = {};
  const sceneScale = getEffectiveScale();
  const dotColor = 0x39e6ff;

  ANCHOR_SIDES.forEach(side => {
    let spr = drawing._anchorSprites[side];
    if (!spr || spr.destroyed) {
      spr = new PIXI.Graphics();
      drawing._anchorSprites[side] = spr;
    }

    const size = Math.max(5, 6 * sceneScale);
    spr.clear();
    spr.lineStyle(0);
    spr.beginFill(dotColor, 0.18);
    spr.drawCircle(0, 0, size * 2.2);
    spr.endFill();
    spr.beginFill(0xFFFFFF, 0.95);
    spr.drawCircle(0, 0, size);
    spr.endFill();

    const pos = drawing._getAnchorPosition(side);
    spr.position.set(pos.x, pos.y);
    spr.eventMode = 'static';
    spr.cursor = 'pointer';
    spr.hitArea = new PIXI.Circle(0, 0, ANCHOR_HIT_RADIUS * sceneScale);
    spr.visible = !hidden;
    spr.alpha = alpha;

    if (!spr._ibAnchorBound) {
      spr._ibAnchorBound = true;
      spr.on('pointerdown', (event) => {
        if (event.button !== 0) return;
        if (event.shiftKey) return; // shift+click-to-rewire is handled globally, on the line itself
        onAnchorPointerDown(event, drawing, side);
      });
    }

    pinsContainer.addChild(spr);
  });
}

function _destroyAnchorSprites(drawing) {
  if (!drawing._anchorSprites) return;
  for (const side of ANCHOR_SIDES) {
    const spr = drawing._anchorSprites[side];
    if (spr && !spr.destroyed) {
      if (spr.parent) spr.parent.removeChild(spr);
      spr.destroy();
    }
  }
  drawing._anchorSprites = null;
}

// Finds the closest connectable anchor point to (worldX, worldY) across every note
// except excludeDrawing, within ANCHOR_HIT_RADIUS (scaled, with drop-tolerance slack).
// "pin"-type notes contribute a single candidate (their center — see
// _getAnchorPosition's pin special-case); every other note contributes its 4 sides.
// Notes with no pinSprite (pinColor:"none") are excluded — same "No Pins disables
// connections" rule the rest of the module already follows.
function findNearestAnchor(worldX, worldY, excludeDrawing) {
  const sceneScale = getEffectiveScale();
  const radius = ANCHOR_HIT_RADIUS * sceneScale * 1.6;
  let best = null;
  let bestDist = radius;

  canvas.drawings.placeables.forEach(d => {
    if (d === excludeDrawing) return;
    const noteData = d.document.flags[MODULE_ID];
    if (!noteData || !d.pinSprite) return;

    const candidates = noteData.type === "pin" ? ["top"] : ANCHOR_SIDES;
    for (const side of candidates) {
      const pos = d._getAnchorPosition(side);
      const dist = Math.hypot(pos.x - worldX, pos.y - worldY);
      if (dist < bestDist) {
        bestDist = dist;
        best = { drawing: d, anchor: side };
      }
    }
  });

  return best;
}

// Anchor pointerdown: always means "drag out a new connection" (never note-repositioning
// — note-body dragging is stock Foundry Drawing drag, unaffected by any of this). No
// click-to-arm step like the classic pin flow: dropping without a real drag lands back
// on/near the source note's own anchors, which are excluded from the hit-test below, so
// a plain click is naturally a no-op.
function onAnchorPointerDown(event, drawing, side) {
  event.stopPropagation();
  if (!InvestigationBoardState.isActive) return;
  if (anchorDragState || rewireDragState) return;

  const startPos = drawing._getAnchorPosition(side);

  if (!connectionPreviewLine) {
    connectionPreviewLine = new PIXI.Graphics();
    connectionPreviewLine.zIndex = 15;
    canvas.drawings.sortableChildren = true;
    canvas.drawings.addChild(connectionPreviewLine);
  }

  const onMove = (moveEvent) => {
    const worldPos = moveEvent.getLocalPosition(canvas.stage);
    connectionPreviewLine.clear();
    const playerColor = game.user.color || "#FF0000";
    const sceneScale = getEffectiveScale();
    const width = (game.settings.get(MODULE_ID, "connectionLineWidth") || DEFAULT_CONNECTION_LINE_WIDTH) * sceneScale;
    drawConnectionLine(connectionPreviewLine, startPos.x, startPos.y, side, worldPos.x, worldPos.y, null, playerColor, width, false, 0);
  };

  const onUp = (upEvent) => {
    canvas.stage.off('pointermove', onMove);
    clearConnectionPreview();
    const dropPos = upEvent.getLocalPosition(canvas.stage);
    const hit = findNearestAnchor(dropPos.x, dropPos.y, drawing);
    anchorDragState = null;
    if (hit) {
      createConnection(drawing, hit.drawing, { sourceAnchor: side, targetAnchor: hit.anchor });
    }
    // No hit (empty canvas) → cancel, nothing happens — confirmed scope decision.
  };

  anchorDragState = { sourceDrawing: drawing, sourceAnchor: side, onMove, onUp };
  canvas.stage.on('pointermove', onMove);
  canvas.stage.once('pointerup', onUp);
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

  const useAnchors = (game.settings.get(MODULE_ID, "connectionLineStyle") || DEFAULT_CONNECTION_LINE_STYLE) === "circuit";

  canvas.drawings.placeables.forEach(drawing => {
    const noteData = drawing.document.flags[MODULE_ID];
    if (!noteData) return;

    const connections = noteData.connections || [];
    if (connections.length === 0) return;

    const shouldAnimate = activeEditingDrawingId === drawing.document.id;

    // In circuit mode each connection can use a different sourceAnchor, so this can't be
    // hoisted above the per-connection loop the way the single classic pin position was.
    connections.forEach(conn => {
      const targetDrawing = canvas.drawings.get(conn.targetId);
      if (!targetDrawing) return;

      const sourcePin = useAnchors && drawing._getAnchorPosition
        ? drawing._getAnchorPosition(conn.sourceAnchor || "top")
        : (drawing._getPinPosition ? drawing._getPinPosition() : { x: drawing.document.x, y: drawing.document.y });
      const targetPin = useAnchors && targetDrawing._getAnchorPosition
        ? targetDrawing._getAnchorPosition(conn.targetAnchor || "top")
        : (targetDrawing._getPinPosition ? targetDrawing._getPinPosition() : { x: targetDrawing.document.x, y: targetDrawing.document.y });

      let lineColor = conn.color || "#FF0000";
      const lineWidth = (conn.width || game.settings.get(MODULE_ID, "connectionLineWidth") || DEFAULT_CONNECTION_LINE_WIDTH) * sceneScale;
      drawConnectionLine(
        connectionLinesContainer,
        sourcePin.x,
        sourcePin.y,
        conn.sourceAnchor || "top",
        targetPin.x,
        targetPin.y,
        conn.targetAnchor || "top",
        lineColor,
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

  drawConnectionLine(connectionPreviewLine, firstPin.x, firstPin.y, "top", worldPos.x, worldPos.y, null, playerColor, width, false, 0);
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

// sourceAnchor/targetAnchor: circuit-mode anchor sides ("top" default, ignored by yarn
// rendering). color/width: pass to preserve an existing connection's look (e.g. a rewire
// drop) instead of stamping the current player's pen — null/omitted falls back to that.
async function createConnection(sourceDrawing, targetDrawing, { sourceAnchor = "top", targetAnchor = "top", color = null, width = null } = {}) {
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
  const playerColor = color || game.user.color?.css || "#FF0000";
  const lineWidth = width || game.settings.get(MODULE_ID, "connectionLineWidth") || DEFAULT_CONNECTION_LINE_WIDTH;

  connections.push({
    targetId: targetDrawing.document.id,
    color: playerColor,
    width: lineWidth,
    sourceAnchor,
    targetAnchor,
  });

  await collaborativeUpdate(sourceDrawing.document.id, {
    [`flags.${MODULE_ID}.connections`]: connections
  });

  drawAllConnectionLines();
}

// Closest point on segment (x1,y1)-(x2,y2) to (px,py). t is the 0..1 position along
// the segment, used by findConnectionNearPoint to figure out which half of the route
// (and therefore which end) a hit falls closer to.
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return { dist: Math.hypot(px - cx, py - cy), t };
}

// Shift+click-on-a-line hit-test (circuit mode only). Rebuilds each connection's actual
// rendered route via the same geometry drawCircuitLine() uses (getCircuitRoutePoints +
// chamferCorners) — there's no retained per-connection geometry to reuse, everything is
// redrawn from scratch every frame, so this recomputes it independently against the
// click point. Returns the closest hit under `tolerance`, with nearEnd ("source" or
// "target") decided by which half of the cumulative path length it falls in.
function findConnectionNearPoint(worldX, worldY, tolerance) {
  const sceneScale = getEffectiveScale();
  let best = null;
  let bestDist = tolerance;

  canvas.drawings.placeables.forEach(sourceDrawing => {
    const noteData = sourceDrawing.document.flags[MODULE_ID];
    if (!noteData) return;
    const connections = noteData.connections || [];

    connections.forEach((conn, connIndex) => {
      const targetDrawing = canvas.drawings.get(conn.targetId);
      if (!targetDrawing) return;

      const sourceSide = conn.sourceAnchor || "top";
      const targetSide = conn.targetAnchor || "top";
      const sourcePin = sourceDrawing._getAnchorPosition(sourceSide);
      const targetPin = targetDrawing._getAnchorPosition(targetSide);
      const lineWidth = (conn.width || game.settings.get(MODULE_ID, "connectionLineWidth") || DEFAULT_CONNECTION_LINE_WIDTH) * sceneScale;
      const chamferSize = Math.max(lineWidth * 3, 16 * sceneScale);
      const stubLen = Math.max(lineWidth * 4, 28 * sceneScale);
      const routeCorners = getCircuitRoutePoints(sourcePin.x, sourcePin.y, sourceSide, targetPin.x, targetPin.y, targetSide, stubLen);
      const points = chamferCorners(routeCorners, chamferSize);
      const total = pathLength(points);

      let cumulative = 0;
      for (let i = 1; i < points.length; i++) {
        const segLen = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
        const { dist, t } = distToSegment(worldX, worldY, points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
        if (dist < bestDist) {
          bestDist = dist;
          const distAlong = cumulative + t * segLen;
          best = {
            sourceDrawing, connIndex, targetDrawing, conn,
            nearEnd: (total > 0 && distAlong / total < 0.5) ? "source" : "target",
          };
        }
        cumulative += segLen;
      }
    });
  });

  return best;
}

// Shift+click grabs the nearer end of the connection under the cursor, detaches it
// immediately (optimistic — matches the "grabs the nearest end" framing), and lets the
// user drag that end to a new anchor (reconnect) or drop on empty canvas (stays removed).
async function beginRewireDrag(hit) {
  const { sourceDrawing, connIndex, targetDrawing, nearEnd } = hit;

  const connections = (sourceDrawing.document.flags[MODULE_ID]?.connections || []).slice();
  const removedConn = connections[connIndex];
  if (!removedConn) return;
  connections.splice(connIndex, 1);
  await collaborativeUpdate(sourceDrawing.document.id, { [`flags.${MODULE_ID}.connections`]: connections });
  drawAllConnectionLines();

  const fixedDrawing = nearEnd === "target" ? sourceDrawing : targetDrawing;
  const fixedAnchor = nearEnd === "target" ? (removedConn.sourceAnchor || "top") : (removedConn.targetAnchor || "top");
  const fixedPos = fixedDrawing._getAnchorPosition(fixedAnchor);

  if (!connectionPreviewLine) {
    connectionPreviewLine = new PIXI.Graphics();
    connectionPreviewLine.zIndex = 15;
    canvas.drawings.sortableChildren = true;
    canvas.drawings.addChild(connectionPreviewLine);
  }

  const onMove = (moveEvent) => {
    const worldPos = moveEvent.getLocalPosition(canvas.stage);
    connectionPreviewLine.clear();
    const sceneScale = getEffectiveScale();
    const width = (rewireDragState.width || game.settings.get(MODULE_ID, "connectionLineWidth") || DEFAULT_CONNECTION_LINE_WIDTH) * sceneScale;
    drawConnectionLine(connectionPreviewLine, fixedPos.x, fixedPos.y, fixedAnchor, worldPos.x, worldPos.y, null, rewireDragState.color, width, false, 0);
  };

  const onUp = (upEvent) => {
    canvas.stage.off('pointermove', onMove);
    clearConnectionPreview();
    const dropPos = upEvent.getLocalPosition(canvas.stage);
    const dropHit = findNearestAnchor(dropPos.x, dropPos.y, fixedDrawing);
    const state = rewireDragState;
    rewireDragState = null;

    if (dropHit) {
      // Preserve the original connection's color/width — a rewire keeps the same
      // connection, just re-anchored, not a brand-new one stamped with the current pen.
      if (state.movingEnd === "target") {
        createConnection(state.fixedDrawing, dropHit.drawing, {
          sourceAnchor: state.fixedAnchor, targetAnchor: dropHit.anchor,
          color: state.color, width: state.width,
        });
      } else {
        createConnection(dropHit.drawing, state.fixedDrawing, {
          sourceAnchor: dropHit.anchor, targetAnchor: state.fixedAnchor,
          color: state.color, width: state.width,
        });
      }
    }
    // No hit (empty canvas) → already detached above; this is the "goes away" behavior.
  };

  rewireDragState = {
    fixedDrawing, fixedAnchor, movingEnd: nearEnd,
    color: removedConn.color, width: removedConn.width,
    originalConn: removedConn, originalSourceDrawing: sourceDrawing,
    onMove, onUp,
  };

  canvas.stage.on('pointermove', onMove);
  canvas.stage.once('pointerup', onUp);
}

// Persistent shift+click listener that checks whether the click landed on a rendered
// connection line (circuit mode only) and, if so, starts the rewire drag instead of
// letting the click fall through to whatever else might handle a canvas click (e.g.
// Foundry's own shift+click multi-select).
function onStagePointerDownForRewire(event) {
  if (event.button !== 0) return;
  if (!event.shiftKey) return;
  if (!InvestigationBoardState.isActive) return;
  if (anchorDragState || rewireDragState || pinConnectionFirstNote) return;
  const style = game.settings.get(MODULE_ID, "connectionLineStyle") || DEFAULT_CONNECTION_LINE_STYLE;
  if (style !== "circuit") return;

  const worldPos = event.getLocalPosition(canvas.stage);
  const sceneScale = getEffectiveScale();
  const hit = findConnectionNearPoint(worldPos.x, worldPos.y, LINE_HIT_TOLERANCE * sceneScale);
  if (!hit) return;

  event.stopPropagation();
  beginRewireDrag(hit);
}

// canvas.stage is a fresh PIXI object every canvasReady (new scene load), so this needs
// re-binding each time rather than once at module load — call from the canvasReady hook.
export function bindGlobalConnectionInteractions() {
  if (!canvas?.stage) return;
  canvas.stage.on('pointerdown', onStagePointerDownForRewire);
}

/**
 * True while a new-connection anchor-drag or a line-rewire drag is in progress.
 * Used by the Escape keybinding alongside isInConnectionMode() (the classic click-arm
 * flow) to decide whether Escape should cancel and consume the keypress.
 */
export function isInAnchorOrRewireDrag() {
  return anchorDragState !== null || rewireDragState !== null;
}

/**
 * Cancels an in-progress anchor-drag or line-rewire drag. A rewire cancel restores the
 * original connection (re-pushes the object that was optimistically spliced out at
 * drag-start) — Escape is a true cancel, not a confirm-delete.
 */
export function cancelAnchorOrRewireDrag() {
  if (anchorDragState) {
    canvas.stage.off('pointermove', anchorDragState.onMove);
    canvas.stage.off('pointerup', anchorDragState.onUp);
    anchorDragState = null;
  }
  if (rewireDragState) {
    canvas.stage.off('pointermove', rewireDragState.onMove);
    canvas.stage.off('pointerup', rewireDragState.onUp);
    const { originalSourceDrawing, originalConn } = rewireDragState;
    const connections = (originalSourceDrawing.document.flags[MODULE_ID]?.connections || []).slice();
    connections.push(originalConn);
    collaborativeUpdate(originalSourceDrawing.document.id, { [`flags.${MODULE_ID}.connections`]: connections })
      .then(() => drawAllConnectionLines());
    rewireDragState = null;
  }
  clearConnectionPreview();
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