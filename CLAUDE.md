# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Investigation Board is a Foundry VTT v13 module that enables collaborative investigation gameplay by allowing all users to create, edit, and move notes on the scene canvas. Notes are implemented as Foundry Drawing objects with custom rendering using PIXI.js sprites.

**Note Types:** sticky, photo, index, handout, media, pin

**Key Features:**

- Six note types with visual connection lines (yarn-like strings)
- Collaborative editing via socket routing — all users can edit any note
- Multiple visual themes (modern, futuristic, custom)
- Pins render on top of connections via global container z-indexing
- Resizable handout notes with auto-resize on image selection
- Clipboard paste to create handout notes
- Drag-and-drop linking of Foundry documents to notes
- Context menu creation from Actors, Items, Scenes, Journal pages, Playlists, Folders

## Development Workflow

No build step required. Edit JS/CSS and reload Foundry. CSS in `styles/` is compiled automatically by Foundry — do not re-read it after edits.

To test: refresh Foundry after code changes. Existing notes may need `canvas.drawings` refresh or select/deselect. Connection lines auto-update on note movement.

## Architecture

### File Structure

```text
scripts/
├── main.js              # Entry point — all Foundry hooks, IB mode activation/deactivation
├── config.js            # Constants: MODULE_ID, SOCKET_NAME, PIN_COLORS, STICKY_TINTS, INK_COLORS
├── state.js             # Singleton: InvestigationBoardState { isActive }
├── settings.js          # Settings registration
├── apps/
│   ├── drawing-sheet.js # CustomDrawingSheet — note edit dialog
│   ├── hud.js           # InvestigationBoardHUD — quick controls on selected notes
│   ├── note-previewer.js# NotePreviewer — floating preview of note content
│   └── setup-warning.js # SetupWarningDialog — GM permission setup prompt
├── canvas/
│   ├── custom-drawing.js    # CustomDrawing — PIXI sprite rendering, permission overrides
│   └── connection-manager.js# All connection line logic, pins, preview, animations
└── utils/
    ├── creation-utils.js    # createNote() and all "create from X" helpers
    ├── helpers.js           # getDynamicCharacterLimits, truncateText, getEffectiveScale
    ├── socket-handler.js    # collaborativeUpdate/Create/Delete, socket listener
    └── audio-utils.js       # Tape effect for media notes
templates/
├── drawing-sheet.html   # Note config dialog (Handlebars)
├── hud.html             # HUD template
├── note-preview.html    # Note previewer template
└── setup-warning.html   # GM setup warning template
```

### Module Entry Point: `scripts/main.js`

Registers all Foundry hooks and manages Investigation Board mode:

- `Hooks.once("init")` — register settings, set `CONFIG.Drawing.objectClass = CustomDrawing`, register sheet (makeDefault: false)
- `Hooks.once("ready")` — init socket, show setup warning to GM if permissions missing
- `Hooks.on("getSceneControlButtons")` — add 6 creation tools to `controls.drawings.tools`
- `Hooks.on("renderSceneControls")` — activate/deactivate IB mode when drawings control is selected
- `Hooks.on("preCreateDrawing")` — clear connections and suppress auto-open on paste/duplicate
- `Hooks.on("createDrawing")` — open edit dialog for creator, refresh interactivity/pins
- `Hooks.on("preUpdateDrawing")` — route updates through socket for non-owners
- `Hooks.on("preDeleteDrawing")` — protect IB notes from bulk deletion
- `Hooks.on("updateDrawing")` — refresh sprites, connection lines, NotePreviewer on change
- `Hooks.on("deleteDrawing")` — redraw connections when notes are deleted
- `Hooks.on("canvasReady")` — cleanup containers, reset state, redraw all connections
- `Hooks.on("dropCanvasData")` — link Foundry document to note on drag-drop
- Various context menu hooks for creating notes from other document types

### Note Types and Rendering

Six note types in `drawing.flags['investigation-board'].type`:

- **sticky** — 200×200, colored tints via `STICKY_TINTS`, ink color via `INK_COLORS`
- **photo** — 225×290, polaroid layout (or horizontal in futuristic mode)
- **index** — 600×400, default fontSize 9
- **handout** — transparent background, image-only, resizable, `fillAlpha: 0`
- **media** — 400×~296, cassette tape image, plays audio on click
- **pin** — 40×40, standalone pin with no background

Rendering in `CustomDrawing._updateSprites()`:

1. Check handout type FIRST — completely different sprite layout
2. Check futuristic photo notes — horizontal layout
3. All other types use shared layout logic

**Z-Index Layering (front to back):**

1. Connection number overlays — zIndex 100 (editing only)
2. Pins container — zIndex 20
3. Connection preview line — zIndex 15 (during creation only)
4. Yarn lines container — zIndex 10
5. Note backgrounds — zIndex 0

### Drawing Flag Structure

```javascript
flags['investigation-board'] = {
  type: "sticky" | "photo" | "index" | "handout" | "media" | "pin",
  text: "note content",
  image: "path/to/image.webp",        // photo, handout, media
  pinColor: "redPin.webp",
  identityName: "Character Name",      // futuristic photo only
  font: "Arial",                       // per-note, falls back to global (not handout/media/pin)
  fontSize: 16,                        // per-note, index defaults to 9 (not handout/media/pin)
  tint: "#ffff99",                     // sticky notes only
  inkColor: "#000000",                 // sticky/index/photo
  linkedObject: "@UUID[...]{Name}",    // any note, set via drag-and-drop
  connections: [
    { targetId: "drawingId", color: "#FF0000", width: 3 }
  ]
}
```

### Connection Lines

Stored one-directionally in source note's `connections` flag array. All rendering managed by `canvas/connection-manager.js`:

- `drawAllConnectionLines()` — redraws all yarn lines and repositions pins
- `updatePins()` — moves pin sprites from drawing children to global `pinsContainer`
- `startConnectionPreview()` / `clearConnectionPreview()` — live line following cursor
- `showConnectionNumbers()` / `clearConnectionNumbers()` — floating number overlays during editing
- `startConnectionAnimation()` / `stopConnectionAnimation()` — marching lights while dialog open

Pins are repositioned into global `pinsContainer` at zIndex 20 on every redraw (world coordinates).

### Collaborative Editing

Non-owners route updates through GM's socket client:

```text
Player update → preUpdateDrawing hook → lacks permission?
                                              ↓ YES
                                    socket.emit(SOCKET_NAME, { action: "updateDrawing", ... })
                                    return false  ← blocks direct update
```

GM-side handler in `utils/socket-handler.js` processes the request and performs the update.

`module.json` must have `"socket": true`.

### Investigation Board Mode

Activated when Drawings control is selected (`renderSceneControls` hook). In active mode:

- IB notes: `eventMode = 'static'`, interactive
- Non-IB drawings: `eventMode = 'none'`, non-interactive
- Body gets `.investigation-board-mode` CSS class

### Permission Overrides in CustomDrawing

```javascript
_canControl(user, event)  // returns true for all IB notes
_canDrag(user, event)     // returns true unless locked
_canView(user, event)     // returns true for all IB notes
```

`CustomDrawingSheet._canRender(options)` also returns true for all IB notes.

### API and v13 Patterns

Always use namespaced Foundry APIs:

```javascript
// Templates
foundry.applications.handlebars.loadTemplates()

// Class references (not globals)
const Drawing = foundry.canvas.placeables.Drawing;
const DrawingConfig = foundry.applications.sheets.DrawingConfig;
const FilePicker = foundry.applications.apps.FilePicker.implementation;
const TextEditor = foundry.applications.ux.TextEditor.implementation;
const DocumentSheetConfig = foundry.applications.apps.DocumentSheetConfig;
const DrawingDocument = foundry.documents.DrawingDocument;
const BasePlaceableHUD = foundry.applications.hud.BasePlaceableHUD;
```

### Scene Tool Buttons

Added to `controls.drawings.tools` in `getSceneControlButtons` hook with `button: true` and `onChange` callback. Tools visible only when Drawing Tools control is active.

```javascript
controls.drawings.tools.createStickyNote = {
  name: "createStickyNote",
  title: "Create Sticky Note",
  icon: "fas fa-sticky-note",
  onChange: () => createNote("sticky"),
  button: true
};
```

### Custom Sheet Registration

```javascript
DocumentSheetConfig.registerSheet(DrawingDocument, "investigation-board", CustomDrawingSheet, {
  label: "Note Drawing Sheet",
  types: ["base"],
  makeDefault: false,  // CRITICAL — must be false, or ALL drawings use custom sheet
});
```

IB notes explicitly set their sheet at creation time:

```javascript
flags: { core: { sheetClass: "investigation-board.CustomDrawingSheet" } }
```

### Text Truncation

In `utils/helpers.js`. Dynamic character limits scale inversely with font size using `scaleFactor = BASE_FONT_SIZE / currentFontSize`. Different limits per note type (sticky, photo, index).

### Handout Auto-Resize Fix

`updateDrawing` hook compares sprite dimensions against document dimensions (tolerance: 5px). If mismatch detected, calls `placeable.refresh()`. This fixes resize handles not updating visuals after release.

### Bulk Deletion Protection

`preDeleteDrawing` hook returns `false` for IB notes unless `options.ibDelete` is set or the placeable is currently controlled (selected). This prevents "Clear All Drawings" from deleting IB notes.

## Settings

World-level settings (see `scripts/settings.js`):

- Note dimensions: `stickyNoteWidth`, `photoNoteWidth`, `indexNoteWidth`, `handoutNoteWidth`, `handoutNoteHeight`
- Appearance: `fontFamily`, `fontSize`, `pinColor`, `boardMode`
- Connection lines: `connectionLineColor`, `connectionLineWidth`
- Default text per note type
- `showSetupWarning` — GM permission check on ready
- `characterNameKey` — dot-path for actor name in photo notes (default: `prototypeToken.name`)
- `baseCharacterLimits` — hidden JSON for text truncation

All settings call `refreshAllDrawings()` on change.

## Known Limitations

- GM must be online for players to edit notes (socket routing)
- Connection lines are one-directional (stored in source note only)
- Pins are repositioned globally on every redraw (performance consideration with many notes)
- Notes can only be edited/moved in drawing mode
