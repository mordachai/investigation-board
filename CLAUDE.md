# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Investigation Board is a Foundry VTT v13 module that enables collaborative investigation gameplay by allowing all users to create, edit, and move sticky notes, photo notes, and index cards on the scene canvas. These notes are implemented as Foundry Drawing objects with custom rendering using PIXI.js sprites.

**Key Features:**
- Four note types (sticky notes, photo notes, index cards, handout notes)
- Visual connection lines between notes (yarn-like strings)
- Collaborative editing with full permissions for all users
- Multiple visual themes (modern, futuristic, custom)
- Pins that render on top of connections
- Resizable handout notes with auto-resize on image selection

## Architecture

### Core Components

**Module Entry Points:**
- `scripts/investigation-board.js` - Main module logic, custom classes, and Foundry hooks
- `scripts/settings.js` - Module settings registration and configuration

**Custom Classes:**
- `CustomDrawing` (extends `Drawing`) - Handles PIXI.js sprite rendering for notes with backgrounds, pins, text, and photo images
- `CustomDrawingSheet` (extends `DrawingConfig`) - Configuration dialog for editing note content and properties

### Note Types and Rendering

The module supports four note types stored in drawing flags:
- **Sticky Notes** - Square notes with text content (200x200, default font size from global setting)
- **Photo Notes** - Polaroid-style notes with an image and caption (225x290, default font size from global setting)
- **Index Cards** - Wide rectangular notes for longer text (600x400, **default font size 9**)
- **Handout Notes** - Image-only notes with transparent background (400x400 default, resizable via handles or auto-resize on image selection)

Each note type has:
- Different default dimensions and font sizes
- Per-note font and font size customization (overrides global defaults, not applicable to handouts)
- Dynamic text truncation based on font size and note type (not applicable to handouts)
- Configurable background images based on board mode (modern/futuristic/custom, handouts use transparent background)

### Connection Lines Feature

**Overview:**
Visual yarn-like connection lines link notes together to show relationships in an investigation. Lines connect pin-to-pin and dynamically update when notes are moved.

**User Workflow:**
1. **Creating Connections** - Pin-click system (no toggle needed)
   - In Investigation Board mode, click any note's pin
   - Green border appears around selected note
   - **Live preview line** follows cursor showing where connection will go
   - Click second note's pin to complete connection
   - Connection uses player's color by default
   - Press ESC to cancel connection at any time
   - Cursor shows `alias` icon during connection workflow

2. **Managing Connections** - Double-click note to open edit dialog
   - **Connections list** shows all outgoing connections with numbers (e.g., "1: Photo Note", "2: Index Card")
   - **Visual number overlays** appear on connected notes on canvas (large floating numbers in center)
   - Numbers only visible while editing, making it easy to identify which connection corresponds to which note
   - **Animated marching lights** flow along connection lines to show direction (from source to target)
   - Change yarn color with color picker for each connection
   - Remove individual connections with unlink button
   - All changes apply immediately

3. **Connection Visualization**
   - Numbered list in edit dialog (flexbox layout, 4 items per row)
   - Big floating numbers on connected notes (white text, black stroke, drop shadow, zIndex 100)
   - Animated dashed lines show flow direction while editing
   - All visual aids disappear when dialog closes

**Connection Data Storage:**
Connections are stored one-directionally in the source note's flags:
```javascript
{
  connections: [
    {
      targetId: "drawingDocumentId",  // ID of target note
      color: "#FF0000",               // Line color (from settings or default)
      width: 3                        // Line width in pixels
    }
  ]
}
```

**Visual Design:**
- Yarn-like appearance with quadratic bezier curves
- Natural downward sag effect (simulates gravity, 15% of distance)
- Triple-line rendering for thread texture (main line + 2 offset lines with lower opacity)
- Deterministic wobble based on position (same connection always looks the same)
- Lines automatically follow notes when moved

**Z-Index Layering (front to back):**
1. **Connection number overlays** (zIndex 100) - Most front, only visible during editing
2. **Pins** (zIndex 20) - Always visible on top of connections
3. **Preview line** (zIndex 15) - Live connection preview during creation
4. **Yarn lines** (zIndex 10) - Permanent connections between notes
5. **Note backgrounds** (zIndex 0) - Base layer

This ensures number overlays are always readable, pins are clickable, and preview line is visible during creation.

**Technical Implementation:**
- Global canvas layer architecture (not per-drawing children)
- `connectionLinesContainer` (PIXI.Graphics) - Holds all yarn lines at zIndex 10
- `connectionPreviewLine` (PIXI.Graphics) - Live preview line at zIndex 15, follows cursor
- `pinsContainer` (PIXI.Container) - Holds all pins at zIndex 20, repositioned in world coordinates
- `connectionNumberOverlays` (Array of PIXI.Text) - Floating numbers at zIndex 100, shown during editing
- `drawAllConnectionLines()` - Redraws all connections and repositions all pins
- `showConnectionNumbers()` - Displays numbered overlays on connected notes
- `clearConnectionNumbers()` - Removes all number overlays
- `startConnectionPreview()` - Begins live preview with cursor tracking
- `clearConnectionPreview()` - Removes preview line
- Called on: note creation, note refresh, note movement, connection changes, canvas ready, dialog open/close

**Pin Repositioning:**
Pins are moved from individual drawing children to the global `pinsContainer` to achieve proper z-ordering. On each redraw:
1. Pin sprites removed from their parent drawings
2. Positioned in world coordinates: `(drawing.x + width/2 - 20, drawing.y + 3)`
3. Added to global `pinsContainer` at zIndex 20

**Coordinate System:**
- Connection lines use world coordinates directly (no local transformations)
- Pin positions calculated using `_getPinPosition()`: `(drawing.x + width/2, drawing.y + 23)`
- Yarn sag control point: `(midX + horizontalOffset, midY + sagAmount)`

**Settings:**
- `connectionLineColor` - Hex color string (default: "#FF0000")
- `connectionLineWidth` - Pixels (default: 3)
- Changes trigger `refreshAllDrawings()` to update all lines immediately

**Orphaned Connection Handling:**
- Connections to deleted notes are automatically skipped during rendering
- No active cleanup required (self-healing on render)
- Can be manually removed via the "Remove Connections" dialog

### Board Modes

Three visual themes affect background sprites:
- **Modern** (default) - Standard note aesthetics
- **Futuristic** - Alternative styling with special photo note layout (horizontal with separate identity name field)
- **Custom** - User-provided custom background images

**Key architectural difference:** Futuristic photo notes use a unique horizontal layout with the photo on the left and text fields on the right, while other modes use a vertical polaroid layout.

### Drawing Flag Structure

Notes store data in `drawing.flags['investigation-board']`:
```javascript
{
  type: "sticky" | "photo" | "index" | "handout",
  text: "note content",          // not used for handout notes
  image: "path/to/image.webp",   // photo notes and handout notes only
  pinColor: "redPin.webp",       // assigned randomly or by setting
  identityName: "Character Name", // futuristic photo notes only
  font: "Arial",                 // per-note font (optional, falls back to global setting, not used for handouts)
  fontSize: 16,                  // per-note font size (optional, index cards default to 9, others use global, not used for handouts)
  connections: [                 // outgoing connections (optional)
    {
      targetId: "drawingId",
      color: "#FF0000",          // player color by default, customizable per connection
      width: 3
    }
  ]
}
```

**Handout-Specific Behavior:**
- Handout notes have `fillAlpha: 0` (transparent background) to show only the image and pin
- Dimensions stored in `drawing.shape.width` and `drawing.shape.height` (resizable)
- Auto-resize feature: When image selected via FilePicker, dimensions update to match image (capped at 1000px height, 2000px width, maintaining aspect ratio)
- Pin positioned at 5% from top edge (dynamic based on current height)

### Scene Control Integration

The module integrates into Foundry's **Drawing Tools** control (left sidebar) via the `getSceneControlButtons` hook. All Investigation Board tools appear alongside default drawing tools.

**Creation Tools:**
- **Create Sticky Note** (fas fa-sticky-note) - Creates a 200x200 square note with global font settings
- **Create Photo Note** (fa-solid fa-camera-polaroid) - Creates a 225x290 polaroid-style note with global font settings
- **Create Index Card** (fa-regular fa-subtitles) - Creates a 600x400 wide note with **font size 9** by default
- **Create Handout Note** (fas fa-file-image) - Creates a 400x400 transparent image-only note (resizable)

All creation buttons call `createNote(noteType)` which creates a Drawing document at canvas center with default ownership level 3 (full permissions for all users) and sets `flags.core.sheetClass` to "investigation-board.CustomDrawingSheet". After creation, the Select tool is automatically activated so users can immediately move the note.

**Important:** Investigation Board tools are integrated into the existing Drawing control, NOT a separate control. This allows users to access both Investigation Board notes and standard Foundry drawing tools from the same control panel.

## Key Implementation Details

### Note Edit Dialog

Double-clicking any investigation note opens the `CustomDrawingSheet` dialog with these features:

**Content Editing:**
- Text area for note content (with dynamic character limits based on font size) - **hidden for handout notes**
- Font selector (Rock Salt, Courier New, Times New Roman, Signika, Arial) - **hidden for handout notes**
- Font size input (8-48px, per-note setting that overrides global default) - **hidden for handout notes**
- Image path picker for photo notes and handout notes (with Browse button using FilePicker)
  - FilePicker starts at root directory (empty path) for easy access to world assets
  - Image updates immediately when selected (no need to click Save first)
  - For handouts: Auto-resizes drawing to match image dimensions (capped at 1000px height, 2000px width)
- Identity Name field for futuristic photo notes

**Connection Management:**
- **Connections section** displays when note has outgoing connections
- Numbered list format: "1: Photo Note", "2: Index Card" (no arrow)
- Flexbox layout showing 4 connections per row before wrapping
- Each connection has:
  - Color picker to change yarn color
  - Unlink button to remove connection
- Changes apply immediately, dialog re-renders after removal

**Visual Feedback While Dialog is Open:**
- **Animated marching lights** on all connection lines from this note (shows direction of flow)
- **Big floating numbers** appear on all connected notes (white text, black stroke, drop shadow)
- Numbers correspond to list: "1" appears on first connected note, "2" on second, etc.
- All visual aids disappear when dialog closes

**Dialog Controls:**
- **Save button** - Saves all changes and closes dialog
- **Cancel button** - Closes dialog without saving (same as ESC key)
- Both buttons on same line with equal width

### PIXI.js Sprite Management

`CustomDrawing._updateSprites()` rebuilds sprites on draw/refresh:
1. Background sprite (note paper texture) - **not rendered for handout notes**
2. Photo image sprite (for photo notes and handout notes, positioned with offsets)
   - For handouts: Scaled to fit drawing bounds while maintaining aspect ratio, centered within bounds
3. Pin sprite (optional, positioned at top center, with click handler for connections)
   - For handouts: Positioned at 5% from top edge (dynamic based on current height)
4. Text sprites (PIXI.Text with word wrapping and truncation, using per-note font/fontSize) - **hidden for handout notes**

**Font Handling:**
- Text rendering uses `noteData.font` and `noteData.fontSize` if set
- Falls back to global settings if note-specific values not present
- Index cards specifically default to fontSize 9 (not global setting)
- Font and fontSize scale the text, which affects character truncation limits
- Not applicable to handout notes (no text)

**Important Rendering Order:**
1. Check for handout type FIRST in `_updateSprites()` - handouts use completely different sprite layout (transparent background, image-only)
2. Then check for futuristic photo notes - use different sprite layout than other note types
3. All other note types use shared layout logic

### Text Truncation System

Dynamic character limits scale inversely with font size:
- Base limits stored per font in settings (`baseCharacterLimits`)
- Calculated limits adjust using `scaleFactor = BASE_FONT_SIZE / currentFontSize`
- Longer text gets "..." appended when truncated
- Different limits for each note type (sticky: ~90-250, photo: ~20-30, index: ~210-800 chars depending on font)

### Permission Model & Collaborative Editing

All notes are created with `"ownership": { default: 3 }` to allow all users to edit and move them. This is core to the collaborative investigation workflow.

**Socket-Based Collaboration:**
Since Foundry's default Drawing permission system restricts non-owners from modifying drawings, the module uses a socket-based approach to enable true collaborative editing:

1. **module.json** - Must have `"socket": true` to enable socket communication
2. **Permission Overrides in CustomDrawing class:**
   - `_canControl(user, event)` - Returns `true` for all investigation board notes (allows selection)
   - `_canDrag(user, event)` - Returns `true` for all investigation board notes (allows dragging)
   - `_canView(user, event)` - Returns `true` for all investigation board notes (allows viewing)
3. **Permission Override in CustomDrawingSheet class:**
   - `_canRender(options)` - Returns `true` for investigation board notes (allows opening edit dialog)

**Socket Communication Flow:**
```
Player Action → preUpdateDrawing Hook → Permission Check
                                            ↓
                              [Has Permission?]
                                    ↓           ↓
                                  YES          NO
                                    ↓           ↓
                            Direct Update   Socket Emit
                                              ↓
                                    GM Client Receives
                                              ↓
                                    GM Performs Update
                                              ↓
                                    updateDrawing Hook
                                              ↓
                                 All Clients Refresh Visuals
```

**Key Socket Components:**
- `SOCKET_NAME` - `module.investigation-board` (socket channel identifier)
- `collaborativeUpdate(drawingId, updateData)` - Helper function that routes updates through socket if user lacks permission
- `handleSocketMessage(data)` - GM-side handler that processes socket requests
- `preUpdateDrawing` hook - Intercepts updates from non-owners and routes through socket

**Important:** The GM must be logged in for socket-based updates to work. The GM's client processes all socket requests from players.

### CSS Auto-Build

CSS files in `styles/` are automatically compiled by Foundry. Do not manually process or re-read them after edits.

**Key CSS Classes:**
- `.connect-mode-active` - Applied to body during connection creation, shows `cursor: alias`
- `.connections-section` - Container for connections list in edit dialog
- `.connections-list` - Flexbox container for connection items (wraps at 4 items per row)
- `.connection-item` - Individual connection card with color picker and remove button
- `.button-group` - Flexbox container for Save/Cancel buttons
- `.cancel-button` and `.save-button` - Equal-width buttons with hover effects

## Foundry VTT Integration

### Hooks Used
- `Hooks.once("init")` - Register settings, set `CONFIG.Drawing.objectClass`, register custom sheet (with `makeDefault: false`), add ESC key handler for canceling connections
- `Hooks.once("ready")` - Initialize socket listener for collaborative editing (`game.socket.on(SOCKET_NAME, handleSocketMessage)`)
- `Hooks.on("getSceneControlButtons")` - Integrate Investigation Board tools into Drawings control
- `Hooks.on("preUpdateDrawing")` - **Collaborative editing interceptor:**
  - Checks if current user initiated the update
  - If user lacks permission, routes update through socket to GM
  - Returns `false` to prevent direct update (socket handles it)
  - Returns `true` for GM or owners to allow normal update
- `Hooks.on("updateDrawing")` - Multiple responsibilities:
  - Redraw connection lines and numbers when notes move (x/y changes)
  - **Refresh visuals on ALL clients** when flags change (text, image, connections, etc.)
  - **Auto-refresh handout sprites when dimensions mismatch** - Critical fix for resize handles
    - Checks if handout sprite dimensions differ from document dimensions (tolerance: 5px)
    - If mismatch detected, calls `placeable.refresh()` to update sprites
    - This ensures resize handles work properly without requiring page refresh
- `Hooks.on("canvasReady")` - Clean up containers (lines, preview, numbers, pins), clear connection state, initialize connection lines
- `Hooks.on("createDrawing")` - Ensure new notes are interactive in Investigation Board mode
- `Hooks.on("deleteDrawing")` - Redraw connection lines when notes are deleted (removes orphaned connections visually)

### API Usage
- **Template Loading:** Use `foundry.applications.handlebars.loadTemplates()` (namespaced function), NOT the deprecated global `loadTemplates()`
- **Document Creation:** `canvas.scene.createEmbeddedDocuments("Drawing", [...])`
- **Canvas Interaction:** `canvas.drawings.activate()` to switch to drawing mode

### Custom Sheet Registration

```javascript
DocumentSheetConfig.registerSheet(DrawingDocument, "investigation-board", CustomDrawingSheet, {
  label: "Note Drawing Sheet",
  types: ["base"],
  makeDefault: false,  // CRITICAL: Must be false to avoid affecting standard Foundry drawings
});
```

**Important:** `makeDefault: false` is critical - if set to `true`, ALL drawings (including standard Foundry drawing tools) will use the custom sheet, which breaks normal drawing functionality.

The custom sheet is assigned explicitly via `"flags.core.sheetClass": "investigation-board.CustomDrawingSheet"` when creating Investigation Board notes through the four creation buttons. This ensures:
- Investigation Board notes → Use CustomDrawingSheet
- Standard Foundry drawings → Use default DrawingConfig sheet

## Settings

World-level settings control:

**Note Appearance:**
- Note dimensions (width in pixels for sticky/photo/index, width AND height for handouts)
  - `handoutNoteWidth` (default: 400px) - Initial width for new handout notes
  - `handoutNoteHeight` (default: 400px) - Initial height for new handout notes
- Font family (Rock Salt, Courier New, Times New Roman, Signika, Arial) - **Default for new notes, can be overridden per-note, not applicable to handouts**
- Base font size (scales with note width) - **Default for new notes (except index cards use 9), can be overridden per-note, not applicable to handouts**
- Pin color (random, red, blue, yellow, green, none)
- Board mode (modern, futuristic, custom) - **handouts always use transparent background**
- Default text for new notes (sticky, photo, index only)

**Connection Lines:**
- Connection Line Color - Hex color string (default: "#FF0000") - **Used as fallback, new connections use player's color**
- Connection Line Width - Pixels (default: 3)

**Advanced:**
- Character name key for context menu feature (e.g., `prototypeToken.name` or `system.alias`)
- Base character limits (hidden JSON object)

Settings trigger `refreshAllDrawings()` on change to update all investigation board drawings and connection lines on the canvas immediately.

## File Structure

```
investigation-board/
├── scripts/
│   ├── investigation-board.js  # Core logic, custom classes
│   └── settings.js             # Settings registration
├── styles/
│   └── style.css               # Auto-compiled CSS
├── templates/
│   └── drawing-sheet.html      # Handlebars template for note config dialog
├── assets/
│   ├── *.webp                  # Background images for notes and pins
│   └── fonts/
│       └── rock_salt.ttf
└── module.json                 # Foundry module manifest
```

## Development Workflow

1. **Testing Changes:** Refresh Foundry after code changes. Existing notes may need manual refresh (select/deselect) or canvas.drawings refresh. Connection lines auto-update on note movement.

2. **Creating New Note Types:** Extend `noteTypes` in `CustomDrawingSheet.getData()`, add background images, update `_updateSprites()` logic, add character limits, update `_getPinPosition()` width calculation.

3. **Modifying Sprite Layout:** Edit `CustomDrawing._updateSprites()`. Futuristic photo notes branch early; other types use shared layout logic. Remember pins are managed globally via `drawAllConnectionLines()`.

4. **Adding Board Modes:** Add choice to `boardMode` setting, update `getBackgroundImage()` function, provide background assets in `assets/`.

5. **Scene Toolbar Buttons:** The buttons are only visible when the Journal Notes control is selected. The correct implementation uses the pattern shown in the `getSceneControlButtons` hook. Connect Mode is a toggle (not a button).

6. **Modifying Connection Line Rendering:** Edit `drawYarnLine()` for visual changes, `drawAllConnectionLines()` for logic changes. Connection lines use PIXI.Graphics with quadratic bezier curves.

7. **Z-Index Management:** Five global layers with sortableChildren enabled:
   - Drawings (backgrounds, text): zIndex 0
   - Connection lines container: zIndex 10
   - Connection preview line: zIndex 15 (only during creation)
   - Pins container: zIndex 20
   - Connection number overlays: zIndex 100 (only during editing)

## Known Limitations

- **GM must be online** for collaborative editing to work (GM's client processes socket requests from players)
- Only GM can assign images to photo notes by default (requires browser file permissions for players)
- Deleting all drawings via the Drawing tools delete button will remove ALL notes and connections
- Notes are Drawing objects, so they can only be edited/moved in drawing mode
- Connection lines are one-directional (stored in source note only)
- Pins are repositioned globally on every redraw for proper z-ordering (slight performance consideration with many notes)
- Connection numbers only show for outgoing connections (not incoming), matching the one-directional storage model
- Live preview line only appears after clicking first pin (not before first click)

## Context Menu Feature

Right-click context menus on Actors and Scenes include "Create Photo Note from..." options. The note uses:
- **Scenes:** Navigation name or scene name
- **Actors:** Value from `characterNameKey` setting path (default: `prototypeToken.name`)

## Troubleshooting Common Issues

### Issue: Resize Handles Don't Update Handout Visuals

**Problem:** When using Foundry's resize handles to resize a handout note, the yellow selection outline shows the new size but the image sprite stays at the old size until page refresh or moving the drawing.

**Root Cause:** Foundry's resize interaction updates the document dimensions but does NOT automatically call `refresh()` on the drawing placeable. During drag, continuous refresh calls happen (that's why it looks correct while dragging), but after release, only the document updates.

**Solution:** Implemented in `updateDrawing` hook (investigation-board.js ~line 1710):
```javascript
// For handouts, check if sprite dimensions differ from document dimensions
if (noteData.type === "handout") {
  const placeable = canvas.drawings.get(drawing.id);
  if (placeable && placeable.photoImageSprite) {
    const docW = drawing.shape.width;
    const docH = drawing.shape.height;
    const spriteW = placeable.photoImageSprite.width || 0;
    const spriteH = placeable.photoImageSprite.height || 0;

    // Check if sprite dimensions don't match document (tolerance: 5px)
    const tolerance = 5;
    const widthMismatch = Math.abs(spriteW - docW) > tolerance;
    const heightMismatch = Math.abs(spriteH - docH) > tolerance;

    if (widthMismatch || heightMismatch) {
      await placeable.refresh();  // Force sprite update
    }
  }
}
```

This approach:
- Detects when document dimensions change but sprites haven't updated
- Forces refresh automatically without user intervention
- Uses 5px tolerance to account for aspect ratio scaling differences
- Works on EVERY updateDrawing event (not just shape changes) to catch all resize scenarios

### Issue: Custom Sheet Applied to All Drawings

**Problem:** All drawings (including standard Foundry drawing tools like rectangles, polygons, etc.) use the Investigation Board custom sheet instead of the default Foundry sheet.

**Root Cause:** `makeDefault: true` in the sheet registration makes the custom sheet the default for ALL DrawingDocument instances.

**Solution:** Set `makeDefault: false` in sheet registration (investigation-board.js ~line 1579):
```javascript
DocumentSheetConfig.registerSheet(DrawingDocument, "investigation-board", CustomDrawingSheet, {
  label: "Note Drawing Sheet",
  types: ["base"],
  makeDefault: false,  // CRITICAL: Must be false
});
```

Investigation Board notes explicitly set their sheet via `flags.core.sheetClass` when created (investigation-board.js ~line 1225):
```javascript
flags: {
  [MODULE_ID]: { type: noteType, text: defaultText, ... },
  core: { sheetClass: "investigation-board.CustomDrawingSheet" }
}
```

This ensures:
- Only Investigation Board notes (created via the 4 creation buttons) use CustomDrawingSheet
- Standard Foundry drawings use default DrawingConfig sheet
- Module doesn't interfere with other drawing functionality

### Issue: Image Not Displaying After First Browse

**Problem:** When creating a handout note and browsing for an image:
1. First browse: Size updates but image stays as placeholder
2. Second browse (selecting same image): Image finally displays

**Root Cause:** The auto-resize logic in FilePicker callback was updating document dimensions but NOT saving the image path. Only the input field value was updated.

**Solution:** Save both dimensions AND image path in single update (investigation-board.js ~line 213):
```javascript
// For handouts
await this.document.update({
  'shape.width': targetWidth,
  'shape.height': targetHeight,
  [`flags.${MODULE_ID}.image`]: path  // Save image path immediately
});

// For photo notes
await this.document.update({
  [`flags.${MODULE_ID}.image`]: path  // Save image path immediately
});
```

This ensures:
- Image displays immediately when selected
- Auto-resize happens simultaneously with image save
- No need to click Save button or browse twice
- Works for both handouts (with auto-resize) and photo notes (without auto-resize)

### Issue: FilePicker Starts in Module Folder

**Problem:** When browsing for images, FilePicker opens in `modules/investigation-board/assets/` which is counter-intuitive since users typically store images in their world's data folder or other locations.

**Root Cause:** FilePicker `current` parameter was hardcoded to module assets folder.

**Solution:** Set FilePicker `current` parameter to empty string (investigation-board.js ~line 184):
```javascript
new FilePicker({
  type: "image",
  current: "",  // Start at root, not module folder
  callback: async (path) => { ... }
})
```

Benefits:
- Opens at Foundry root directory
- Easy access to world's data/assets folder
- Users can navigate to any location they prefer
- More intuitive UX for finding user-uploaded images

### Issue: Players Cannot Edit/Move GM-Created Notes

**Problem:** Players can see notes created by the GM but cannot select, move, edit, or connect them.

**Root Cause:** Foundry's default Drawing permission system only allows the author (creator) to modify drawings.

**Solution:** Implemented socket-based collaborative editing with permission overrides:

1. **module.json** - Add `"socket": true`:
```json
{
  "id": "investigation-board",
  "socket": true,
  ...
}
```

2. **CustomDrawing class** - Add permission overrides:
```javascript
_canControl(user, event) {
  const noteData = this.document.flags?.[MODULE_ID];
  if (noteData?.type) return true;
  return super._canControl(user, event);
}

_canDrag(user, event) {
  const noteData = this.document.flags?.[MODULE_ID];
  if (noteData?.type) return !this.document.locked;
  return super._canDrag(user, event);
}

_canView(user, event) {
  const noteData = this.document.flags?.[MODULE_ID];
  if (noteData?.type) return true;
  return super._canView?.(user, event) ?? true;
}
```

3. **CustomDrawingSheet class** - Add render permission override:
```javascript
_canRender(options) {
  const noteData = this.document.flags?.[MODULE_ID];
  if (noteData?.type) return true;
  return super._canRender(options);
}
```

4. **preUpdateDrawing hook** - Intercept and route non-owner updates:
```javascript
Hooks.on("preUpdateDrawing", (drawing, changes, options, userId) => {
  if (userId !== game.user.id) return true;
  const noteData = drawing.flags?.[MODULE_ID];
  if (!noteData?.type) return true;
  if (game.user.isGM || drawing.testUserPermission(game.user, "OWNER")) return true;

  // Route through socket
  socket.emit(SOCKET_NAME, {
    action: "updateDrawing",
    sceneId: canvas.scene.id,
    drawingId: drawing.id,
    updateData: changes,
    requestingUser: game.user.id
  });
  return false; // Prevent direct update
});
```

5. **Socket handler** - GM processes requests:
```javascript
function handleSocketMessage(data) {
  if (!game.user.isGM) return;
  if (data.action === "updateDrawing") {
    const scene = game.scenes.get(data.sceneId);
    const drawing = scene?.drawings.get(data.drawingId);
    if (drawing?.flags?.[MODULE_ID]) {
      drawing.update(data.updateData);
    }
  }
}
```

**Important:** GM must be logged in for this to work.

### Development Tips

**When Adding New Note Types:**
1. Add to flag structure with appropriate fields
2. Update `noteTypes` object in `CustomDrawingSheet.getData()`
3. Add rendering logic in `CustomDrawing._updateSprites()` - check note type EARLY in function
4. Update `_getPinPosition()` if pin positioning differs
5. Update template conditionals in `drawing-sheet.html`
6. Add creation button in `getSceneControlButtons` hook
7. Add default dimensions in settings if needed
8. Set `flags.core.sheetClass` in `createNote()` function

**When Debugging Sprite Issues:**
- Check if `_updateSprites()` is being called (add temp console.log)
- Verify sprite properties are being set (width, height, position, texture)
- Check if sprites have valid parent before setting properties
- Remember: Setting sprite properties doesn't automatically trigger render
- Use `placeable.refresh()` to force sprite rebuild

**When Working with Resize:**
- Foundry's resize handles update `drawing.shape.width/height`
- Resize does NOT automatically call `refresh()`
- Use `updateDrawing` hook to detect dimension changes
- Check if sprites match document dimensions, force refresh if mismatch

## Recent Feature Updates

### Collaborative Editing via Sockets (v3.0.1)
- **True Multi-User Collaboration** - Any user can now edit, move, resize, and connect ANY note regardless of who created it
- **Socket-Based Updates** - Player changes are routed through the GM's client when they lack direct permission
- **Permission Overrides** - Custom `_canControl`, `_canDrag`, `_canView`, and `_canRender` methods bypass Foundry's default restrictions
- **Real-Time Sync** - All clients automatically refresh visuals when notes are updated (text, connections, position, etc.)
- **Seamless Experience** - Players interact with notes normally; socket routing is transparent

**Technical Requirements:**
- `module.json` must include `"socket": true`
- GM must be logged in for player edits to work
- `preUpdateDrawing` hook intercepts and routes non-owner updates
- `updateDrawing` hook refreshes visuals on all clients

### Connection Creation Improvements
- **Live Preview Line** - Yarn line follows cursor after clicking first pin, shows exact path before committing
- **Alias Cursor** - Cursor changes to `alias` icon during connection workflow for better visual feedback
- **Pin-Click System** - Direct pin clicking instead of toggle button, more intuitive workflow
- **ESC to Cancel** - Press ESC at any time to cancel connection creation

### Connection Management Enhancements
- **Numbered Connections** - List shows "1: Photo Note", "2: Index Card" format in edit dialog
- **Visual Number Overlays** - Big floating numbers appear on canvas at connected notes during editing
- **Animated Direction Indicators** - Marching lights flow along connection lines showing direction
- **Per-Connection Colors** - Each connection uses player's color by default, individually customizable
- **Inline Connection Editing** - Manage all connections directly in note edit dialog, no separate menu

### Per-Note Text Customization
- **Font Selector** - Choose font per note (Rock Salt, Courier New, Times New Roman, Signika, Arial)
- **Font Size Control** - Set font size per note (8-48px), overrides global default
- **Index Card Default** - Index cards automatically use font size 9 (instead of global default)
- **Dynamic Truncation** - Character limits adjust based on selected font size

### UI/UX Improvements
- **Cancel Button** - Added to all note edit dialogs alongside Save button
- **Flexbox Layout** - Connection list shows 4 items per row before wrapping
- **Two-Column Controls** - Color picker and remove button side-by-side for each connection
- **Integrated Tools** - All Investigation Board tools appear in Drawing control (not separate control)

### Handout Note Feature (New Note Type)
- **Image-Only Notes** - Display user-uploaded images without text, perfect for evidence photos, maps, documents
- **Transparent Background** - Only image and pin visible, no note frame or background
- **Auto-Resize on Image Selection** - Handouts automatically resize to match selected image dimensions
  - Capped at 1000px height and 2000px width
  - Maintains aspect ratio
  - Immediate visual update when browsing for images
- **Manual Resize Support** - Use Foundry's native resize handles to adjust dimensions freely
  - Auto-refresh mechanism ensures visual updates without page reload
  - Aspect ratio preserved when scaling image sprite
- **Dynamic Pin Positioning** - Pin positioned at 5% from top edge, adjusts automatically with resize
- **Default 400x400** - New handouts start as squares, easily customizable
- **Full Connection Support** - Create connections from/to handouts just like other note types
- **FilePicker Improvements** - Browse button opens at root directory for easy access to world assets
