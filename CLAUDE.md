# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Investigation Board is a Foundry VTT module (currently targeting **v14**, Build 360) that enables collaborative investigation gameplay by allowing all users to create, edit, and move notes on the scene canvas. Notes are implemented as Foundry Drawing objects with custom rendering using PIXI.js sprites.

**Note Types:** sticky, photo, index, handout, media, pin, document

**Key Features:**

- Seven note types with visual connection lines (yarn-like strings)
- Collaborative editing via socket routing — all users can edit any note
- Multiple visual themes (modern, custom)
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
├── config.js            # Constants: MODULE_ID, SOCKET_NAME, DEFAULT_PIN_FOLDER, PIN_COLORS, DEFAULT_STAMP_FOLDER, STAMP_IMAGES, DEFAULT_STAMP_TINT, DEFAULT_CONNECTION_LINE_WIDTH, FONTS, MODULE_FONTS, STICKY_TINTS, INK_COLORS, CASSETTE_IMAGES, VIDEO_IMAGES, VIDEO_EXTENSIONS, DOC_BACKGROUNDS, EFFECT_DEFAULTS, VIDEO_FORMATS
├── state.js             # Singleton: InvestigationBoardState { isActive }
├── settings.js          # Settings registration
├── apps/
│   ├── drawing-sheet.js      # CustomDrawingSheet — note edit dialog
│   ├── batch-edit-dialog.js  # BatchEditDialog — bulk pin/connection-color edits across a scope of notes
│   ├── note-previewer.js     # NotePreviewer — floating preview of note content
│   ├── setup-warning.js      # SetupWarningDialog — GM permission setup prompt
│   ├── appearance-dialog.js  # AppearanceDialog — font/color/connection/pin settings
│   ├── note-defaults-dialog.js # NoteDefaultsDialog — dimensions and default text
│   └── video-player.js       # VideoPlayer — ApplicationV2 video playback with broadcast sync
├── canvas/
│   ├── custom-drawing.js    # CustomDrawing — PIXI sprite rendering, permission overrides
│   └── connection-manager.js# All connection line logic, pins, preview, animations
└── utils/
    ├── creation-utils.js    # createNote(), all "create from X" helpers, getNoteDimensions()/buildNoteCreateData()/postCreateFixup() (shared skeleton), getRandomCassetteImage(), getRandomVideoImage()
    ├── helpers.js           # makeFolderImageSource() factory (pins/stamps), truncateText, getEffectiveScale, resolvePinImage/getAvailablePinFiles, resolveStampImage/getAvailableStampFiles
    ├── socket-handler.js    # collaborativeUpdate/Create/Delete, socket listener
    └── audio-utils.js       # Tape effect for media notes
assets/
├── pins/                # Built-in pin images (redPin, bluePin, yellowPin, greenPin .webp)
│                        # GM can point pinImagesFolder at any folder to replace the entire set
├── stamps/               # Built-in stamp images (classified, deceased, evidence, missing, redacted, x-mark .webp)
│                        # GM can point stampImagesFolder at any folder to replace the entire set
templates/
├── drawing-sheet.html        # Note config dialog (Handlebars)
├── note-preview.html         # Note previewer template
├── setup-warning.html        # GM setup warning template
├── appearance-dialog.html    # Appearance settings dialog
├── note-defaults-dialog.html # Note Defaults settings dialog
└── video-player.html         # VideoPlayer window (ApplicationV2)
```

> **Removed:** `InvestigationBoardHUD` (`apps/hud.js`, `templates/hud.html`) was dead code — never imported anywhere — and was deleted rather than wired up.

### Module Entry Point: `scripts/main.js`

Registers all Foundry hooks and manages Investigation Board mode:

- `Hooks.once("init")` — register settings, set `CONFIG.Drawing.objectClass = CustomDrawing`, register sheet (makeDefault: false), register the `cancelConnection` keybinding (Escape — cancels an in-progress yarn connection; returns `false`/unconsumed when not in connection mode so core Escape behavior still fires)
- `Hooks.once("ready")` — init socket, force-load fonts via `document.fonts.load()`, migrate legacy `pinColor` setting values, show setup warning to GM if permissions missing
- `Hooks.on("getSceneControlButtons")` — add 7 tools to `controls.drawings.tools`: 6 note-type creation tools (sticky/photo/index/handout/media/pin) + `batchEditNotes` (opens `BatchEditDialog`)
- `Hooks.on("renderSceneControls")` — activate/deactivate IB mode when drawings control is selected
- `Hooks.on("preCreateDrawing")` — clear connections and suppress auto-open on paste/duplicate
- `Hooks.on("createDrawing")` — open edit dialog for creator, refresh interactivity/pins
- `Hooks.on("preUpdateDrawing")` — route updates through socket for non-owners
- `Hooks.on("preDeleteDrawing")` — protect IB notes from bulk deletion
- `Hooks.on("updateDrawing")` — refresh sprites, connection lines, NotePreviewer and open VideoPlayer on change; also calls `updatePins()` when `hidden` changes
- `Hooks.on("deleteDrawing")` — redraw connections when notes are deleted
- `Hooks.on("canvasReady")` — cleanup containers, reset state, redraw all connections
- `Hooks.on("dropCanvasData")` — link Foundry document to note on drag-drop
- `ready` hook `dragover`/`drop` listeners — create handout notes from desktop image files or image URLs dropped on the canvas (`#board` element); priority: image file > `text/uri-list` URL with known image extension
- Various context menu hooks for creating notes from other document types

### Note Types and Rendering

Seven note types in `drawing.flags['investigation-board'].type`:

- **sticky** — 200×200, colored tints via `STICKY_TINTS`, ink color via `INK_COLORS`
- **photo** — 225×290, polaroid layout
- **index** — 600×400, default fontSize 9
- **handout** — transparent background, image-only, resizable, `fillAlpha: 0.001`
- **media** — 400×~296, two sub-modes: **audio** (cassette tape sprite) and **video** (video sprite). Sub-mode stored in `flags.mediaMode` (`"audio"` | `"video"`). Video notes set `pinColor: "none"` automatically (no pin/connections). Single-click drags/selects like any note; **double-click** (`_onClickLeft2`) opens `NotePreviewer` (audio, with a lo-fi playback toggle) or `VideoPlayer` (video) — there is no single-click-to-play affordance.
- **pin** — 40×40, standalone pin with no background
- **document** — 595×842 (A4-ish), parchment/paper background sprite, title rendered with `PIXI.Text`, body rendered with `PIXI.HTMLText` (preserves bold/italic/alignment from journal pages). Background key (`parchment` | `oldpaper` | `whitepaper`) stored in `flags.docBackground`; textures defined in `DOC_BACKGROUNDS` in `config.js`. Has pin. Does NOT use `tint`.

Rendering in `CustomDrawing._updateSprites()`:

1. Check handout type FIRST — completely different sprite layout
2. Check document type — background sprite + title + HTMLText body; early return
3. All other types use shared layout logic

**Document note sprites** — `bgShadow` (blurred black shadow at offset 8,8), `bgSprite` (background image), `docTitleText` (`PIXI.Text`, centered, hidden when empty), `docBodyText` (`PIXI.HTMLText` with `tagStyles` to lock the note font on every inline tag). Sprites are reused across `_doUpdateSprites()` calls (not destroyed). When a note switches away from type `"document"`, the doc-specific sprites are destroyed in the early type-mismatch block.

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
  type: "sticky" | "photo" | "index" | "handout" | "media" | "pin" | "document",
  text: "note content",
  image: "path/to/image.webp",        // photo, handout, media
  audioPath: "path/to/audio.mp3",     // media/audio only
  audioEffectEnabled: true,           // media/audio only — lo-fi tape effect
  mediaMode: "audio" | "video",       // media only — defaults to "audio"; derived from videoPath for legacy notes
  videoPath: "path/to/video.mp4",     // media/video only
  videoFormat: "crt",                 // media/video — key into VIDEO_FORMATS (cctv|crt|flatscreen|filmProjector|cellphone)
  videoEffects: {                     // media/video — per-note effect overrides
    rollingShutter: false,
    mechanicalSound: true,
    trackingGlitch: false,
    filmGrain: false,
    filmGrainIntensity: 0.15,
    timestampEnabled: false,
    recordingStartISO: "2024-01-01T00:00:00",  // defaults to current time on new notes
    recordingStartCenti: 0,
    timestampDateFormat: "us" | "eu",
    timestampX: 0.6, timestampY: -0.75, timestampFontSize: 30, timestampColor: "#008425",
    glitchIntervalMin: 2, glitchIntervalMax: 4,
  },
  pinColor: "redPin.webp",            // bare filename; "" or absent = auto-random on next render
                                      // resolved at render time via resolvePinImage() so the folder
                                      // can change without touching note data
  unknown: true,                       // photo only — shows "???" instead of name
  font: "Arial",                       // per-note, falls back to global (not handout/media/pin)
  fontSize: 16,                        // per-note, index defaults to 9; document defaults to 14 (not handout/media/pin)
  tint: "#ffff99",                     // sticky notes only — NOT used by document notes
  textColor: "#000000",               // sticky/index/photo/document (stored as textColor in flags)
  title: "Document Title",            // document only — rendered above body; hidden when empty
  docBackground: "parchment",         // document only — key into DOC_BACKGROUNDS ("parchment"|"oldpaper"|"whitepaper")
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

**`requestGlobalRedraw()`** — coalesces bursts of `updatePins()` + `drawAllConnectionLines()` calls (e.g. N notes each calling `draw()`/`refresh()` during `canvasReady`, a bulk import, or a settings change that calls `refreshAllDrawings()`) into a single pass on the next animation frame, instead of running the full O(N) global redraw N times. `CustomDrawing.draw()`/`refresh()`, the `updateDrawing`/`createDrawing`/`deleteDrawing` hooks in `main.js`, and `settings.js`'s `refreshAllDrawings()` all route through this instead of calling `updatePins()`/`drawAllConnectionLines()` directly. The marching-ants ticker in `startConnectionAnimation()` is the one exception — it needs `drawAllConnectionLines(offset)` called directly, every single frame, with the animation offset.

`updatePins()` registers each pin sprite's `pointerdown` listener **once** per sprite lifetime (guarded by `sprite._ibPointerDownBound`) rather than tearing down and re-adding it on every redraw; the handler reads `drawing.document.flags[MODULE_ID]` fresh on each call so it stays correct if the note's type changes later.

**`_getPinPosition(x, y)`** on `CustomDrawing` is the single source of truth for a pin's center point (defaults to `this.document.x/y`, but accepts overrides so `onPinDragMove` can preview the center at a not-yet-committed drag position). `updatePins()` and `onPinDragMove` both derive the sprite's top-left from it (`center - spriteSize/2`) instead of re-deriving the per-type offset formulas independently.

### Pin Images System

Pin images live in `assets/pins/` by default. The GM can point `pinImagesFolder` (world setting) at any folder (e.g. a "nails" set) — all notes immediately resolve to the new folder without touching flag data.

**Key helpers in `utils/helpers.js`:**
- `resolvePinImage(filename)` — prepends the configured folder: `"redPin.webp"` → `"modules/investigation-board/assets/pins/redPin.webp"`
- `getAvailablePinFiles()` — async; scans `pinImagesFolder` via `FilePicker.browse()`, returns array of bare filenames. Module-level cache; busted by `invalidatePinFilesCache()` when the folder setting changes. Falls back to the `PIN_COLORS` constant list for clients without `FILES_BROWSE` permission.
- `invalidatePinFilesCache()` — called from the `pinImagesFolder` setting's `onChange`.

Pin and stamp image sources share one implementation: `makeFolderImageSource(settingKey, defaultFolder, fallbackList)` in `helpers.js` builds the `{resolve, getAvailableFiles, invalidateCache}` trio for both; `resolvePinImage`/`getAvailablePinFiles`/`invalidatePinFilesCache` and their stamp equivalents are thin wrappers around two `makeFolderImageSource()` instances.

**`CustomDrawing._loadPinTexture(noteData)`** — single method replacing four previously duplicated pin-loading blocks across `_doUpdateSprites`. Logic:
1. Global `pinColor` setting `"none"` → destroy sprite, return (disables yarn connections too — pins are the click target)
2. `noteData.pinColor` is set → load `resolvePinImage(noteData.pinColor)`
3. Not set → `getAvailablePinFiles()`, pick random, persist filename to flag via `collaborativeUpdate`, then load

**Global setting `pinColor`** — only two valid values now: `"random"` / `"none"`. Legacy values (`"red"`, `"blue"`, etc. from the old color-name system) are migrated to `"random"` on first `ready` hook by the GM client.

**Per-note pin selector** — the note edit dialog (`drawing-sheet.js`) scans the folder via `getAvailablePinFiles()` in `_prepareContext` and renders a `<select name="pinColor">` with an "Auto" option (empty string) plus one entry per discovered file. Saving sets `flags.${MODULE_ID}.pinColor` to the bare filename or clears it for auto/random.

> **"No Pins" disables connections** — `pinColor: "none"` destroys `pinSprite`, so `updatePins()` skips registering the `pointerdown` listener. Existing yarn lines remain visible but no new connections can be created.

### Stamp System

A GM-only decoration: a rotated "stamp" image (CLASSIFIED, DECEASED, EVIDENCE, MISSING, REDACTED, X MARK, or any custom image in the configured folder) overlaid on **photo, document, index, and handout** notes (`STAMPABLE_TYPES` in `custom-drawing.js`), via the right-click context menu's "Stamp" submenu.

- **Flag shape** — `flags['investigation-board'].stamp = { key: "evidence.webp", rotation: -12.4, offsetX: 0, offsetY: 0 }` (or `null`/absent for no stamp). `rotation` is randomized (±20°) at apply time, not user-configurable.
- **Settings** — `stampTint` (world, hex color, default `#990000`) tints the stamp sprite; `stampImagesFolder` (world, default `modules/investigation-board/assets/stamps`) points at the image source, same "swap the whole set without touching flags" pattern as pins. Both managed via the Appearance dialog.
- **`CustomDrawing._loadStampTexture(noteData)`** — loads and positions `this.stampSprite` from `noteData.stamp`; clamps the stamp's center using its actual rotated bounding box so it never escapes the note edges regardless of tilt or aspect ratio.
- **Context menu submenu** — lists every file from `getAvailableStampFiles()`; label is the filename prettified (`"x-mark.webp"` → `"X Mark"`) since there's no separate label table. A trailing "Remove Stamp" item clears the flag.
- **Constants** — `DEFAULT_STAMP_FOLDER` and `STAMP_IMAGES` (the built-in fallback list, used when the folder can't be browsed) in `config.js`.

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

**Broadcast-type actions have no verified sender** — any connected client can `socket.emit` them directly from the console; Foundry's socket layer doesn't authenticate the payload. Every legitimate emitter is already gated behind a `game.user.isGM` UI check, so as a bar-raising (not airtight) mitigation, each broadcast payload includes `senderId: game.user.id` and the handler's `isFromActiveGM(senderId)` check requires that user to actually be an active GM before acting. This is spoofable by anyone editing the payload before emit — treat it as raising the bar, not closing the hole.

**Socket actions handled by all clients** (not GM-only), all gated by `isFromActiveGM(data.senderId)`:
- `playAudio` — plays audio globally on every connected client (media/audio notes). Stops any existing instance of the same file first.
- `stopAudio` — stops a playing audio file globally.
- `openVideoPlayer` — opens `VideoPlayer` window for the given `drawingId` on all clients (broadcast by GM).
- `playVideo` / `pauseVideo` / `seekVideo` — sync video playback on all client `VideoPlayer` instances.
- `stopVideoBroadcast` — closes/deactivates broadcast state on all clients.

`activeVideoBroadcasts` (`Map<drawingId, { gmUserId }>`) in `socket-handler.js` tracks active broadcasts; clients skip sync events for broadcasts they're already the GM of.

**Socket actions handled by GM only** (non-GM clients ignore these). The GM handler validates every one of these before acting, since a malicious client could otherwise use the GM's own permissions to touch arbitrary drawings:
- `createDrawing` / `createManyDrawings` — create note(s) on behalf of a player; **rejected** unless `createData.flags[MODULE_ID].type` is set (an IB note), and `type` is force-set to `"r"` server-side
- `updateDrawing` — update a note on behalf of a player; the note must already be an IB note, and `updateData` is passed through `sanitizeSocketUpdateData()`, a whitelist (`x`, `y`, `rotation`, `shape.*`, `fillAlpha`, `flags.investigation-board.*`) — a player cannot use this path to flip `hidden`, `locked`, `ownership`, `author`, etc.
- `deleteDrawing` — delete a note on behalf of a player; **rejected** unless the target already has IB flags (prevents a player-controlled socket message from deleting arbitrary drawings, e.g. GM map annotations, on any scene)

**Create round-trip (`drawingCreated` echo)** — `collaborativeCreate`/`collaborativeCreateMany` need to hand the caller back the created document(s) (used by connect-a-new-note and `_convertToNoteType` flows), but a fire-and-forget socket emit can't do that. When routing through the socket, the client generates a `requestId`, stores a `{resolve, timeout}` pair in a module-level `pendingCreateRequests` map, and awaits a `Promise` that only the matching `drawingCreated` message (echoed back by the GM after it actually creates the document, matched on `requestId` + `requestingUser`) can resolve. A 10s timeout resolves to `[]` if the GM never responds (e.g. socket disconnected), so callers always get *something* back rather than hanging forever — treat an empty/`undefined` result from these functions as "creation may have failed or the requester lacks permission," not as a hang.

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

**Cursor behaviour:**
- Note body → `grab` (set via `drawing.cursor` in `refreshDrawingsInteractivity`)
- Pin sprite → `pointer` (set in `updatePins()` in `connection-manager.js`)
- Rotation / scale handles → `pointer` (set in `_applyHandleVisibility()`)

### Permission Overrides in CustomDrawing

```javascript
_canControl(user, event)   // returns true for all IB notes
_canDrag(user, event)      // returns true unless locked
_canView(user, event)      // returns true for all IB notes; false for non-GM when document.hidden
_getTargetAlpha()          // returns 0.4 for GM when document.hidden; delegates to super otherwise
```

`CustomDrawingSheet._canRender(options)` also returns true for all IB notes.

> **`DrawingDocument` has no `ownership` field.** Foundry v14's `BaseDrawing.defineSchema()` (checked directly against the installed core) has no `ownership` schema field — a `Drawing` document's permission model is `metadata.permissions.delete: "OWNER"` plus the `author` field, evaluated through core's default `testUserPermission`, combined with the `_canControl`/`_canDrag`/`_canView` overrides above. Create payloads used to set `ownership: { default: 3 }`, which Foundry's DataModel silently dropped on every create — it never had any effect, and has been removed from all create payloads (`creation-utils.js`). Don't re-add it; if per-note ownership is ever actually needed, it isn't achievable via the `ownership` key on a `Drawing`.
>
> **Who can delete a note is intentionally permissive.** `_canControl` returns `true` for every user on every IB note, so any player who selects a note and presses Delete can hard-delete it via core Foundry's own UI — the `preDeleteDrawing` bulk-deletion guard only blocks *unselected* bulk operations (see Bulk Deletion Protection below), not a deliberate single-note delete by whoever has it selected. This is the current accepted permission model, not a bug: everyone can create, edit, and delete every note. If that ever needs to change (e.g. GM + author-only delete), it requires a real capability check in `preDeleteDrawing`, not a schema/ownership fix.

### Selection Controls and Scaling

Two world settings gate bounding-box display and scaling:
- `showSelectionControls` (default `false`) — shows the selection border and handles on non-handout, non-pin notes when selected
- `allowScaling` (default `false`) — when controls are shown, also shows the scale handle; rotate handle is always shown when controls are on

**Implementation in `_refreshState()`:**

- `handout` — returns early (Foundry handles it normally; resize handles remain)
- `pin` — explicitly sets `this.controls.visible = false` and returns
- all others — hides controls if `showSelectionControls` is off; otherwise calls `_applyHandleVisibility()`

**`_applyHandleVisibility()`** iterates `this.controls.handles.children` and sets visibility **and cursor** by handle name:
- `"rotate"` → `visible = true`, `cursor = 'pointer'`
- `"scale"`, `"scaleX"`, `"scaleY"` → `visible = allowScaling`, `cursor = 'pointer'`
- anything else (translate handles) → `visible = false`

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

- **Convert to…** — five options: Sticky Note, Photo Note, Index Card, Handout Note, Media Note (no Document Note — see UI/UX gap below)

The pin sprite (which lives in `pinsContainer` as a PIXI sibling, not a child of the Drawing) intercepts all pointer events. The `pointerdown` listener checks `event.button === 2 && noteData?.type === "pin"` to forward right-clicks to `drawing._showContextMenu(event)`. Other note types fall through to `onPinPointerDown` (connection mode).

**`_convertToNoteType(targetType)`** — instance method on `CustomDrawing` (called as `this._convertToNoteType(targetType)`; `this.document.id` is the pin being converted) in `custom-drawing.js`:
1. Reads the source pin's position and connections; collects all *incoming* connections from other notes pointing at the pin
2. Creates the new note type at the same position via `createNote` **first** — if this fails, or comes back empty because the requesting player lacks `DRAWING_CREATE` and the socket round-trip times out, the conversion aborts before the pin is touched (see Collaborative Editing → create round-trip below)
3. Restores outgoing connections/linked object on the new note, and re-points incoming connections (`targetId: pinId` → `targetId: newDoc.id`) via `updateIncomingConnections()` in `connection-manager.js` — both run concurrently
4. Deletes the pin last, via `collaborativeDelete`, only once the replacement note and all remaps are confirmed to exist

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

`truncateText(text, font, noteType, fontSize, width, height)` in `utils/helpers.js`. `_computeCharLimit()` estimates capacity geometrically from the note's *actual rendered dimensions* (`width`/`height` in world px) and `FONT_WIDTH_FACTORS[font]` (average character width as a fraction of font size, derived from the module's `FONTS` list in `config.js`) — not a stored per-font/type lookup table. Photo notes only count the caption strip (~20% of height, clamped 30–70px) as usable text height; everything else uses `height - 60`. This is why scaled/resized notes automatically get more or fewer characters without any extra code.

### Handout Auto-Resize Fix

`updateDrawing` hook compares sprite dimensions against document dimensions (tolerance: 5px). If mismatch detected, calls `placeable.refresh()`. This fixes resize handles not updating visuals after release.

### Bulk Deletion Protection

`preDeleteDrawing` hook returns `false` for IB notes unless `options.ibDelete` is set or the placeable is currently controlled (selected). This prevents "Clear All Drawings" from deleting IB notes.

### creation-utils.js helpers

Key exported functions beyond `createNote`:

- `createTextIndexFromPage(page)` — creates an Index Card from a text-type journal page. Calls `stripHtml()` to get plain text, prefixes the page title, auto-links the page UUID.
- `createDocNoteFromPage(page, background)` — creates a Document Note from a text-type journal page. Calls `sanitizeForPixiHtml()` to convert journal HTML to PIXI.HTMLText-safe markup (preserves `<b>`, `<i>`, `<u>`, `<s>`, `<p>` with text-align; strips images, figures, tables, divs).
- `getRandomCassetteImage()` — synchronous; picks a random entry from `CASSETTE_IMAGES` and returns the full asset path.
- `getRandomVideoImage()` — synchronous; picks a random entry from `VIDEO_IMAGES` and returns the full asset path.
- `getNoteDimensions(noteType)` — single source of truth for a note type's default `{width, height}` (settings-backed for sticky/photo/index/handout; fixed for media/pin/document). Also used by `onCanvasRightClick()` in `connection-manager.js`.
- `buildNoteCreateData({x, y, width, height, fillColor, fillAlpha, flags})` — assembles the Drawing creation payload skeleton (author, shape, invisible stroke, lock state, flag wrapping) shared by every create-a-note helper.
- `postCreateFixup(created)` — the shared "force new note interactive 250ms after creation while in IB mode" logic.

`stripHtml(html)` and `sanitizeForPixiHtml(html)` are module-private (not exported) helpers in `creation-utils.js`:
- `stripHtml(html)` — converts HTML to plain text, preserving paragraph and line breaks. Used by index card creation.
- `sanitizeForPixiHtml(html)` — converts HTML to PIXI.HTMLText-safe markup. Whitelisted tags: `b`, `strong`, `i`, `em`, `u`, `s`, `strike`, `br`, `p`, `span`, `font`. Preserves `text-align` on `<p>` tags. Non-whitelisted tags are stripped (text content kept).

### Bulk Import

`importFolderAsNotes(folder)` and `importPlaylistAsNotes(playlist)` in `creation-utils.js` create notes in a grid layout using `collaborativeCreateMany`. Supports Actor, Item, Scene, and Playlist folder types. Uses `foundry.applications.api.DialogV2.wait()` for confirmation, with an optional lo-fi audio effect checkbox for playlist imports.

### Additional Context Menus

Beyond the directory context menus documented above, these hooks extend creation:

- `getHeaderControlsImagePopout` — adds "Create Handout Note" to the Image Popout header controls via `onClick` + `app.options.src` (v14 pattern; the old `renderImagePopout` + `menu.controls-dropdown` approach no longer works)
- `getJournalEntryPageSheetHeaderButtons` (or equivalent v14 hook) — journal page context options:
  - **Image pages** → "Create Handout Note" via `createHandoutNoteFromPage(page)`
  - **Text pages** → "Text to Index Card" via `createTextIndexFromPage(page)` — strips HTML, prefixes page title, opens edit dialog
  - **Text pages** → "Text to Document Note" via `createDocNoteFromPage(page, background)` — prompts for background (parchment/old paper/white paper) then creates a document note with PIXI.HTMLText-safe markup

> **v14 note:** `renderJournalSheet` / `renderJournalPageSheet` + `app.contextMenus` was the v13 approach for journal image context menus. In v14, `JournalEntrySheet` is AppV2 and has no public `contextMenus` array — that feature is currently absent. Use `getHeaderControlsJournalEntrySheet` hook if re-implementing.

### Video Player (`apps/video-player.js`)

`VideoPlayer` extends `HandlebarsApplicationMixin(ApplicationV2)`. One singleton per drawing (`id: "video-player-{drawingId}"`). Opened by clicking a video media note on canvas, or via GM broadcast (`openVideoPlayer` socket action).

**Format system** — `VIDEO_FORMATS` in `config.js` defines five formats (`cctv`, `crt`, `flatscreen`, `filmProjector`, `cellphone`). Each has `aspectRatio`, `padding`, optional `mechanicalSfx`, and `defaultEffects`. Format key stored in `flags.videoFormat`; effects stored in `flags.videoEffects`. Window sizing actually uses `window.innerWidth * 0.6`, not a per-format value.

**Visual effects (RAF-based):**

- `filmGrain` — canvas element drawn at 30fps via `requestAnimationFrame`; intensity configurable
- `timestamp` — live running clock overlay, driven by `video.currentTime` + `recordingStartISO`; shares the grain RAF loop when both are active
- `trackingGlitch` — CSS animation `div` appended at random intervals (`_startGlitchInterval`)
- `rollingShutter` — one-shot CSS animation on open
- `mechanicalSound` — plays `format.mechanicalSfx` via `game.audio.play()` on open

**Broadcast mode (GM only):**

1. GM clicks "Open for All" (`_startBroadcast`) → `activeVideoBroadcasts.set(drawingId, ...)` + emits `openVideoPlayer` socket action
2. GM `play`/`pause`/`seek` events emit corresponding socket actions
3. Non-GM clients receive events and call `app.syncPlayback(action, currentTime)`
4. A click-to-play overlay (`ib-click-to-play`) handles browsers that block autoplay

`applyEffects(effects)` — hot-reloads running effects from the open edit dialog without closing/reopening the window.

`updateTimestampStyle({ x, y, fontSize, color })` — partial live update of timestamp position/color from the edit dialog sliders without triggering a full `applyEffects`.

**Edit dialog integration** — `CustomDrawingSheet._activateListeners()` wires up live preview for open `VideoPlayer` instances:

- Timestamp X/Y/size/color sliders call `getPlayer()?.updateTimestampStyle(...)` on `input`.
- Any change in the effects tab panel debounces 500ms then calls `getPlayer()?.applyEffects(this._readEffectsFromForm())`.
- "Reset effects" button applies the current format's `defaultEffects` to all effect checkboxes without saving.
- "Preview Video" button opens a `VideoPlayer` for the note inline.
- Foundry AppV2 intercepts bubbled `change` events in capture phase — attach listeners directly to checkboxes/radios (target-phase) to reliably receive them.

### Image Import (Clipboard and Drag-and-Drop)

Three entry points all call `_uploadImageHandout(file, prefix)` then `createHandoutNoteFromImage(path)`:

1. **Clipboard paste** — `paste` event on `document`; fires when IB mode is active and focus is not in an input/textarea
2. **File drag-and-drop** — `dragover`/`drop` on the `#board` canvas element; handles actual image files (WhatsApp, desktop, Google Images)
3. **URL drag-and-drop** — same `drop` handler, fallback path; fetches the URL, converts to `File`, then uploads. Only triggers when the URL ends with a known image extension (`/\.(png|jpe?g|gif|webp|avif|svg|bmp|tiff?)(\?.*)?$/i`).

`_uploadImageHandout` generates a unique timestamped filename (`${prefix}_handout_${Date.now()}_${randomID}.${ext}`) and uploads via `FilePicker.uploadPersistent(MODULE_ID, "ib-handouts", ...)` — module-scoped persistent storage (resolves to `modules/investigation-board/storage/ib-handouts/` under whatever storage source/bucket is actually active: local, Forge, S3, etc.) rather than a hardcoded `"data"` source write to a world-root `assets/` folder. Requires `"persistentStorage": true` in `module.json`.

## Settings

All settings are registered in `scripts/settings.js`. The UI is organized into sections.

### Settings UI layout

The settings config page shows:

**Buttons (top):**
- **[Configure Appearance]** — opens `AppearanceDialog` (`scripts/apps/appearance-dialog.js`), `restricted: false`
- **[Configure Note Defaults]** — opens `NoteDefaultsDialog` (`scripts/apps/note-defaults-dialog.js`), `restricted: true` (GM only)

**Scale & Layout** *(section header injected via `renderSettingsConfig` hook)*
- `autoScale` — automatic scale per scene
- `sceneScale` — fixed scale or global multiplier

**Selection & Interaction**
- `showSelectionControls` (world, default `false`)
- `allowScaling` (world, default `false`)

**Advanced**
- `characterNameKey` — dot-path for actor name in photo notes (default: `prototypeToken.name`)
- `showSetupWarning` — GM permission check on ready

Section headers are injected as `<h3 class="ib-settings-header">` elements via a `renderSettingsConfig` hook at the bottom of `registerSettings`.

### Appearance dialog (`AppearanceDialog`)

Manages: `font`, `baseFontSize`, `defaultNoteColor` (client), `defaultInkColor` (client), `pinColor`, `pinImagesFolder`, `connectionLineWidth`. All registered with `config: false` so they don't appear in the flat list. The dialog template (`templates/appearance-dialog.html`) has three fieldsets: Text, Colors, Connections. `restricted: false` so players can change their own client-scope colors.

`pinColor` has two values: `"random"` (pick from folder) and `"none"` (hide all pins, disables connections). `pinImagesFolder` has a folder browse button that opens `FilePicker` in folder mode.

### Note Defaults dialog (`NoteDefaultsDialog`)

Manages: `stickyNoteWidth`, `photoNoteWidth`, `indexNoteWidth`, `handoutNoteWidth`, `handoutNoteHeight`, `stickyNoteDefaultText`, `photoNoteDefaultText`, `indexNoteDefaultText`, `mediaNoteDefaultText`. All registered with `config: false`. Template (`templates/note-defaults-dialog.html`) has two fieldsets: Note Dimensions and Default Text.

### Hidden / internal settings
- `pinColor` — `"random"` | `"none"`, managed via Appearance dialog
- `pinImagesFolder` — folder path for pin images, managed via Appearance dialog; `onChange` calls `invalidatePinFilesCache()` then `refreshAllDrawings()`
- `stampTint` — stamp tint color, managed via Appearance dialog
- `stampImagesFolder` — folder path for stamp images, managed via Appearance dialog; `onChange` calls `invalidateStampFilesCache()` then `refreshAllDrawings()`
- `connectionLineWidth` — managed via Appearance dialog

> Text truncation (`truncateText()` in `helpers.js`) uses a geometric estimate from actual rendered note dimensions (`_computeCharLimit()`), not a stored per-font/type table — there is no `baseCharacterLimits` setting.

All world settings call `refreshAllDrawings()` on change.

### Note Previewer text overflow

Long text in the previewer is contained by `max-height: 55vh; overflow-y: auto` on `.preview-text` in `styles/style.css`. The container (paper background, border) remains full-size; only the text content scrolls inside it.

### Sensitive information visibility (`canViewSensitive`)

Certain fields reveal information players should not see (image file paths, linked object identity). These are gated behind:

```javascript
canViewSensitive = game.user.isGM || game.user.can("FILES_BROWSE")
```

This flag is added to context in both `CustomDrawingSheet._prepareContext()` and `NotePreviewer._prepareContext()`. Fields hidden from non-privileged players:

- **Edit dialog** — Linked Object field, Image Path field (photo/handout), Audio File picker (media); the tape-effect toggle remains visible
- **Note Previewer** — "Linked Reference" footer section

> **This is UI-only, not a real access control.** `canViewSensitive` hides fields in the rendered templates, but the underlying flag data itself is world-visible — Foundry sends full scene/drawing data to every connected client, so `audioPath` still ships in the previewer's `<audio src>` and every flag is readable via the browser console regardless of this gate. Treat it as "not shown in the UI," never as "the player can't get this data."

**Context menu** — the linked-object menu item always shows **"Open"** (no document name), so the object's identity is not revealed in the button text regardless of permission level.

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
- Pins are repositioned globally on every redraw (mitigated by `requestGlobalRedraw()` coalescing bursts into one pass, but a single move/drag still triggers one full pin+line rebuild across every note on the scene — fine at normal board sizes, a potential cost on very large boards)
- Notes can only be edited/moved in drawing mode
- **Video broadcast state is memory-only on the GM client** (`activeVideoBroadcasts` in `socket-handler.js`). A GM reload/crash mid-broadcast loses that state: players keep synced windows, but the context menu shows "Open for All" again (GM-side desync), and a late-joining player never receives the `openVideoPlayer` event for an already-running broadcast. Accepted; not persisted to a scene/world flag.
- **Image Popout → "Create Handout Note" is GM-only**, while every other creation entry point (paste, drag-drop, scene tools) is gated on `DRAWING_CREATE` instead of `isGM`. Inconsistent, but left as-is — not a deliberate design decision, just not worth the churn to align.
- **No i18n** — no `lang/` folder, every user-facing string is hardcoded in JS/Handlebars. A real gap for community translation, but out of scope as a large, separate undertaking.
- **`_showContextMenu` in `custom-drawing.js` is a ~600-line imperative-DOM method** with real duplication (menu-item/separator construction, the two near-identical outside-click-to-close handlers, the linked-object "Open" block and Remove-Connections block each appearing once in the pin branch and once in the normal-note branch). Left unrefactored: it's the single largest interactive surface in the module (pins, stamps, connections, convert-to, linked objects, media broadcast controls) and there is no way to load a live Foundry instance in this environment to click through the result — a structural refactor here without the ability to visually verify every submenu is a bad risk/reward trade. Refactor this with a live Foundry client attached, not blind.
- New `PIXI.TextStyle`/`HTMLTextStyle` objects are constructed on every sprite refresh rather than cached/mutated in place — cheap in practice, left as-is.
