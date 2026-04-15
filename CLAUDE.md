# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Investigation Board is a Foundry VTT module (currently targeting **v14**, Build 360) that enables collaborative investigation gameplay by allowing all users to create, edit, and move notes on the scene canvas. Notes are implemented as Foundry Drawing objects with custom rendering using PIXI.js sprites.

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

No build step required. Edit JS/CSS and reload Foundry.

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
- `Hooks.once("ready")` — init socket, force-load fonts via `document.fonts.load()`, show setup warning to GM if permissions missing
- `Hooks.on("getSceneControlButtons")` — add 6 creation tools to `controls.drawings.tools`
- `Hooks.on("renderSceneControls")` — activate/deactivate IB mode when drawings control is selected
- `Hooks.on("preCreateDrawing")` — clear connections and suppress auto-open on paste/duplicate
- `Hooks.on("createDrawing")` — open edit dialog for creator, refresh interactivity/pins
- `Hooks.on("preUpdateDrawing")` — route updates through socket for non-owners
- `Hooks.on("preDeleteDrawing")` — protect IB notes from bulk deletion
- `Hooks.on("updateDrawing")` — refresh sprites, connection lines, NotePreviewer on change; also calls `updatePins()` when `hidden` changes
- `Hooks.on("deleteDrawing")` — redraw connections when notes are deleted
- `Hooks.on("canvasReady")` — cleanup containers, reset state, redraw all connections
- `Hooks.on("dropCanvasData")` — link Foundry document to note on drag-drop
- Various context menu hooks for creating notes from other document types

### Note Types and Rendering

Six note types in `drawing.flags['investigation-board'].type`:

- **sticky** — 200×200, colored tints via `STICKY_TINTS`, ink color via `INK_COLORS`
- **photo** — 225×290, polaroid layout (or horizontal in futuristic mode)
- **index** — 600×400, default fontSize 9
- **handout** — transparent background, image-only, resizable, `fillAlpha: 0.001`
- **media** — 400×~296, cassette tape image, plays audio on click
- **pin** — 40×40, standalone pin with no background

Rendering in `CustomDrawing._updateSprites()`:

1. Check handout type FIRST — completely different sprite layout
2. Check futuristic photo notes — horizontal layout
3. All other types use shared layout logic

**`_updateSprites()` concurrency guard:** The method uses `_spriteUpdateRunning` / `_spriteUpdateQueued` flags. If called while running, it queues one re-run. The queued call fires unawaited from the `finally` block — any state set *after* `await _updateSprites()` can be overridden by the queued run. Apply persistent visual state *inside* `_doUpdateSprites()`, not after it.

**v14: all sprites go to `this.shape`, not `this`** — See the v14 section below.

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
  audioPath: "path/to/audio.mp3",     // media only
  audioEffectEnabled: true,           // media only — lo-fi tape effect
  pinColor: "redPin.webp",
  identityName: "Character Name",      // futuristic photo only
  unknown: true,                       // photo only — shows "???" instead of name
  font: "Arial",                       // per-note, falls back to global (not handout/media/pin)
  fontSize: 16,                        // per-note, index defaults to 9 (not handout/media/pin)
  tint: "#ffff99",                     // sticky notes only (stored as tint in flags, not inkColor)
  textColor: "#000000",               // sticky/index/photo (stored as textColor in flags)
  linkedObject: "@UUID[...]{Name}",    // any note, set via drag-and-drop
  connections: [
    { targetId: "drawingId", color: "#FF0000", width: 3 }
  ]
}
```

> **Note:** Flag fields `tint` and `textColor` are the canonical names in flags; `inkColor` may appear in older code as an alias. Always write `textColor` for ink color.

### Connection Lines

Stored one-directionally in source note's `connections` flag array. All rendering managed by `canvas/connection-manager.js`:

- `drawAllConnectionLines()` — redraws all yarn lines and repositions pins
- `updatePins()` — moves pin sprites from drawing children to global `pinsContainer`
- `startConnectionPreview()` / `clearConnectionPreview()` — live line following cursor
- `showConnectionNumbers()` / `clearConnectionNumbers()` — floating number overlays during editing
- `startConnectionAnimation()` / `stopConnectionAnimation()` — marching lights while dialog open

Pins are repositioned into global `pinsContainer` at zIndex 20 on every redraw (world coordinates). Pins in `pinsContainer` are decoupled from their drawing's PIXI hierarchy, so any per-drawing state (visibility, alpha) must be explicitly applied to `drawing.pinSprite` inside `updatePins()`.

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

**Socket actions handled by all clients** (not GM-only):
- `playAudio` — plays audio globally on every connected client (media notes). Stops any existing instance of the same file first.
- `stopAudio` — stops a playing audio file globally.

**Socket actions handled by GM only** (non-GM clients ignore these):
- `createDrawing` — create a single IB note on behalf of a player
- `createManyDrawings` — bulk create notes on behalf of a player
- `updateDrawing` — update a note on behalf of a player
- `deleteDrawing` — delete a note on behalf of a player

**Collaborative helper functions** in `utils/socket-handler.js` — always prefer these over direct Foundry API calls:
- `collaborativeUpdate(drawingId, updateData)` — update, auto-routing via socket if needed
- `collaborativeCreate(createData, options)` — create single note
- `collaborativeCreateMany(createDataArray, options)` — bulk create
- `collaborativeDelete(drawingId)` — delete with `{ ibDelete: true }` to bypass protection

**Creation option flags** used to coordinate behavior across hooks:
- `ibCreation: true` — injected by `collaborativeCreate`; signals a tool-initiated creation so `preCreateDrawing` skips clearing connections and suppressing auto-open
- `ibRequestingUser: userId` — passed from socket handler into `createDrawing` hook so the correct client opens the edit dialog
- `skipAutoOpen: true` — prevents the edit sheet from opening after note creation

### v13 fillAlpha Migration

Foundry v13 rejects updates on drawings where `fillAlpha === 0 && strokeWidth === 0` (no visible content). Legacy IB notes used `fillAlpha: 0` for handout/media/pin types.

Two mitigation points:
1. `canvasReady` hook — GM scans all scene drawings and batch-updates `fillAlpha: 0` → `0.001` once
2. `collaborativeUpdate` — patches `fillAlpha: 0.001` into any update touching a legacy note

When creating new notes always use `fillAlpha: 0.001` (not `0`) for transparent types.

### Fonts

Module fonts are declared as `@font-face` rules at the top of `styles/style.css` — **not** in `module.json`. The four custom fonts are: Rock Salt, Caveat, Typewriter Condensed, IB Special Elite. Font files live in `assets/fonts/`. After declarations in CSS, `document.fonts.load()` is called in the `ready` hook to eagerly load them so PIXI.Text can use them before any canvas rendering.

> Do not add a `fonts` array to `module.json` — fonts are managed exclusively in CSS.

### Hidden Notes (GM Visibility)

IB notes support GM hide/reveal via the right-click context menu (`document.hidden`). The implementation works around Foundry v13's rendering pipeline:

- **`_getTargetAlpha()`** is overridden to return `0.4` for GM when `document.hidden`. This is the correct hook: Foundry's `Drawing._refreshState()` calls `this.alpha = this._getTargetAlpha()` on every render tick, so setting `this.alpha` anywhere else gets overridden each frame.
- **`_canView(user)`** returns `false` for non-GM users when `document.hidden`, hiding the note from players at the framework level.
- **`updatePins()`** explicitly sets `pinSprite.visible` and `pinSprite.alpha` based on hidden state, because pins live in `pinsContainer` outside the drawing's PIXI hierarchy and don't inherit container alpha.
- The `updateDrawing` hook watches `changes.hidden !== undefined` to call `updatePins()` immediately when visibility is toggled.

### Investigation Board Mode

Activated when Drawings control is selected (`renderSceneControls` hook). In active mode:

- IB notes: `eventMode = 'static'`, interactive
- Non-IB drawings: `eventMode = 'none'`, non-interactive
- Body gets `.investigation-board-mode` CSS class

### Permission Overrides in CustomDrawing

```javascript
_canControl(user, event)   // returns true for all IB notes
_canDrag(user, event)      // returns true unless locked
_canView(user, event)      // returns true for all IB notes; false for non-GM when document.hidden
_getTargetAlpha()          // returns 0.4 for GM when document.hidden; delegates to super otherwise
```

`CustomDrawingSheet._canRender(options)` also returns true for all IB notes.

### Selection Controls and Scaling

Two world settings gate bounding-box display and scaling:
- `showSelectionControls` (default `false`) — shows the selection border and handles on non-handout, non-pin notes when selected
- `allowScaling` (default `false`) — when controls are shown, also shows the scale handle; rotate handle is always shown when controls are on

**Implementation in `_refreshState()`:**

- `handout` — returns early (Foundry handles it normally; resize handles remain)
- `pin` — explicitly sets `this.controls.visible = false` and returns
- all others — hides controls if `showSelectionControls` is off; otherwise calls `_applyHandleVisibility()`

**`_applyHandleVisibility()`** iterates `this.controls.handles.children` and sets visibility by handle name:
- `"rotate"` → always `true`
- `"scale"`, `"scaleX"`, `"scaleY"` → `allowScaling` setting
- anything else (translate handles) → `false`

**`controls._refresh` monkey-patch** — `ShapeControls._refresh()` resets all `handle.visible` to true on every render tick. Since `this.controls` is recreated fresh on every `draw()` call, `draw()` monkey-patches `controls._refresh` in-place to call `_applyHandleVisibility()` after the base refresh. The patch only applies to non-handout, non-pin IB notes.

**Sprite resize on scale** — `_doUpdateSprites` reads `this.document.shape.width` / `this.document.shape.height` as the authoritative rendered size (not the settings values). The `updateDrawing` hook detects `shapeChanged` and also checks for sprite/document dimension mismatch (tolerance 5px), triggering `placeable.refresh()` either way.

**Text size is NOT tied to note scale** — font size uses `settingsWidth` (from settings) as the reference, so scaling the note gives more text wrap space without changing the font size:
```javascript
const settingsWidth = game.settings.get(MODULE_ID, "stickyNoteWidth") || 200;
const fontSize = (settingsWidth / 200) * baseFontSize * fontBoost;
// word wrap uses document shape width (actual rendered width)
```

### Pin Note Context Menu

Right-clicking a pin-only note (type `"pin"`) shows a context menu with:
- **Convert to…** — five options: Sticky Note, Photo Note, Index Card, Handout Note, Media Note

The pin sprite (which lives in `pinsContainer` as a PIXI sibling, not a child of the Drawing) intercepts all pointer events. The `pointerdown` listener checks `event.button === 2 && noteData?.type === "pin"` to forward right-clicks to `drawing._showContextMenu(event)`. Other note types fall through to `onPinPointerDown` (connection mode).

**`_convertToNoteType(pinId, newType)`** in `custom-drawing.js`:
1. Reads the source pin's position and connections
2. Collects all *incoming* connections from other notes pointing to `pinId`
3. Deletes the pin via `collaborativeDelete`
4. Creates the new note type at the same position via `createNote`
5. Re-maps incoming connections on all other notes: `targetId: pinId` → `targetId: newDoc.id`
6. Re-maps outgoing connections from the old pin onto the new note

### Note Positioning

**Toolbar cascade** (`createNote` in `creation-utils.js`) — when no explicit `x`/`y` is provided, new notes are staggered diagonally so they don't stack. Step size is 15% of the note's own dimensions, capped at 80 world units, cycling every 6 notes back to center.

**Connection-mode right-click menu** (`onCanvasRightClick` in `connection-manager.js`) — since the right-click always fires on the source note's pin, a minimum-distance push is applied:
- Direction: from viewport center (`canvas.stage.pivot`) toward source note center; 30° fallback if the note is within 10 world units of center
- `minDist = srcHalfDiag + tgtHalfDiag + 40` (all in world units — **no** `sceneScale` factor)

**Coordinate system note** — `document.shape.width/height` are the raw stored values (e.g., 200 for a sticky note) and equal the note's actual world-space rendered size. `sceneScale` (from `getEffectiveScale()`) is used only when *positioning* a new note (`x = viewCenter.x - width * sceneScale / 2`), not when computing distances or sizes from existing documents. Never multiply `shape.width` by `sceneScale` — that will undercount by the scale factor.

### API Patterns

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

### Bulk Import

`importFolderAsNotes(folder)` and `importPlaylistAsNotes(playlist)` in `creation-utils.js` create notes in a grid layout using `collaborativeCreateMany`. Supports Actor, Item, Scene, and Playlist folder types. Uses `foundry.applications.api.DialogV2.wait()` for confirmation, with an optional lo-fi audio effect checkbox for playlist imports.

### Additional Context Menus

Beyond the directory context menus documented above, one more hook extends creation:

- `getHeaderControlsImagePopout` — adds "Create Handout Note" to the Image Popout header controls via `onClick` + `app.options.src` (v14 pattern; the old `renderImagePopout` + `menu.controls-dropdown` approach no longer works)

> **v14 note:** `renderJournalSheet` / `renderJournalPageSheet` + `app.contextMenus` was the v13 approach for journal image context menus. In v14, `JournalEntrySheet` is AppV2 and has no public `contextMenus` array — that feature is currently absent. Use `getHeaderControlsJournalEntrySheet` hook if re-implementing.

### Clipboard Paste

`ready` hook listens for `paste` events on the document. When an image is pasted while IB mode is active (and focus is not on an input/textarea), it:
1. Ensures `assets/ib-handouts/` directory exists via `FilePicker.browse`/`createDirectory`
2. Uploads the pasted image with a timestamped unique filename
3. Calls `createHandoutNoteFromImage(path)` with the uploaded path

## Settings

World-level settings (see `scripts/settings.js`):

- Note dimensions: `stickyNoteWidth`, `photoNoteWidth`, `indexNoteWidth`, `handoutNoteWidth`, `handoutNoteHeight`
- Appearance: `font`, `baseFontSize`, `pinColor`, `autoScale`, `sceneScale`
- Connection lines: `connectionLineWidth`
- Default text per note type: `stickyNoteDefaultText`, `photoNoteDefaultText`, `indexNoteDefaultText`, `mediaNoteDefaultText`
- `showSelectionControls` (world, default `false`) — show bounding box and rotate handle on selected notes (excludes pin and handout)
- `allowScaling` (world, default `false`) — also show scale handle when selection controls are on
- `showSetupWarning` — GM permission check on ready
- `characterNameKey` — dot-path for actor name in photo notes (default: `prototypeToken.name`)
- `baseCharacterLimits` — hidden JSON for text truncation

Client-level settings:
- `defaultNoteColor` — default sticky note tint color
- `defaultInkColor` — default ink/text color for new notes

All settings call `refreshAllDrawings()` on change.

## v14 Migration Notes

This module was migrated from Foundry v13 to v14. The following are the breaking changes and their fixes — important context for future work.

### `this.shape` — where sprites live in v14

In v14, `Drawing._draw()` creates `this.shape = canvas.primary.addDrawing(this)` — a `PrimaryGraphics` instance in `canvas.primary`, NOT a child of the Drawing container. **All `addChild`/`removeChild` calls in `_doUpdateSprites()` must target `this.shape`, not `this`.**

- `canvas.primary.addDrawing()` **reuses** the same PrimaryGraphics across `draw()` calls — `_clear()` only hides it, doesn't destroy children. Safe to re-use existing sprites.
- `this.shape` is positioned at `(x + w/2, y + h/2)` with `pivot = (w/2, h/2)`. A sprite added at (0, 0) appears at the note's world position.
- `this` (the Drawing container) is NOT at world coordinates in v14 — do not add visual sprites to `this`.
- `autoScale` defaults to `true` — do NOT apply `getEffectiveScale()` as `this.shape.scale`. The shape's parent handles world scaling automatically; applying scale manually breaks the controls/sprite size alignment.

### `_refreshState` replaces `_refreshFrame`

v14 deprecated `_refreshFrame`. Override `_refreshState()` to control handle visibility per note type. The current implementation:

```javascript
_refreshState() {
  super._refreshState();
  const noteData = this.document.flags[MODULE_ID];
  if (!noteData?.type) return;
  if (noteData.type === "handout") return;          // handout uses Foundry default
  if (noteData.type === "pin") {
    if (this.controls) this.controls.visible = false;
    return;
  }
  const showControls = game.settings.get(MODULE_ID, "showSelectionControls");
  if (!showControls) { this.controls.visible = false; return; }
  this._applyHandleVisibility();
}
```

`this.frame.handleContainer` no longer exists — use `this.controls.handles`. `this.controls` is recreated on every `draw()` call, so any per-instance customisation (like hiding translate handles) must be re-applied via the `controls._refresh` monkey-patch set up in `draw()`.

### `_prepareSubmitData` override in CustomDrawingSheet

AppV2's `DocumentSheetV2._postRender` and `_onChangeForm` call `_prepareSubmitData` which validates all form fields against the `DrawingDocument` schema. IB custom fields (`text`, `image`, `font`, etc.) are not valid schema paths and throw errors. Override to return `{}`:

```javascript
_prepareSubmitData(event, form, formData) {
  return {};  // IB handles all updates manually in the submit handler
}
```

### Context menu hook format

v14 changed directory context menu hook signatures. All hooks now use `(label, onClick(event, li), visible)` — no more `(name, callback, condition)`:

```javascript
// v14
options.push({
  name: "IB.CreateNote",
  icon: '<i class="fas fa-sticky-note"></i>',
  condition: li => ...,
  callback: li => ...
});
```

Actually the format uses `name`/`icon`/`condition`/`callback` keys but the hook is called with `(html, options)` not `(name, ...)`. The IB code uses `getActorDirectoryEntryContext` etc. — verify these fire correctly in v14.

### Folder context menus

v14 consolidated all folder context hooks into a single `getFolderContextOptions` hook. Type-specific hooks (`getActorDirectoryFolderContext`, etc.) are gone.

### Scene navigation context

`getSceneContextOptions` fires for both the Scene directory AND `SceneNavigation` in v14. The separate `getSceneNavigationContext` hook was removed.

### Tool activation

`ui.controls.activate({ control: "drawings", tool: "select" })` — use the method, not direct property assignment.

### `Color extends Number` — never store as flag value

In v14, `game.user.color` returns a `Color` object (extends `Number`). **Do not store a `Color` object directly in document flags.** Foundry's `mergeObject` / data pipeline treats `Color` as a plain object, spreads its enumerable own properties (none), and produces `{}`, losing the value entirely.

Always convert to a primitive before storing:

```javascript
// WRONG — stores as {} after Foundry's data pipeline
connections.push({ color: game.user.color });

// RIGHT — stores as "#28afcc" (plain string, survives round-trip)
connections.push({ color: game.user.color?.css ?? "#FF0000" });
```

The same applies to any `Color` value you want to persist. Use `.css` (CSS hex string) or `Number(color)` (plain integer).

### Connection yarn color pipeline

`toYarnColorNum(colorInput)` in `connection-manager.js` converts a stored color (string, number, or Color object) to a plain integer for PIXI `lineStyle`. Uses `foundry.utils.Color.multiplyScalar(raw, factor)` — a static method that takes two plain numbers and returns a plain number, avoiding all `instanceof`/`valueOf` chain issues.

- `Number(colorInput)` correctly extracts the value from Color objects (calls `valueOf()`)
- `typeof colorInput === "string"` branch handles CSS strings like `"#28afcc"`
- Never use `instanceof foundry.utils.Color` for type-checking — class identity can differ between core and module contexts

### `_refreshFrame` → `_refreshState` / dead `_onHandleDrag`

`_onHandleDrag` was calling a non-existent `super._onHandleDrag()` — removed entirely.

## Known Limitations

- GM must be online for players to edit notes (socket routing)
- Connection lines are one-directional (stored in source note only)
- Pins are repositioned globally on every redraw (performance consideration with many notes)
- Notes can only be edited/moved in drawing mode
