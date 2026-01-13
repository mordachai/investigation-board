# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Investigation Board is a Foundry VTT v13 module that enables collaborative investigation gameplay by allowing all users to create, edit, and move sticky notes, photo notes, and index cards on the scene canvas. These notes are implemented as Foundry Drawing objects with custom rendering using PIXI.js sprites.

**Key Features:**
- Three note types (sticky notes, photo notes, index cards)
- Visual connection lines between notes (yarn-like strings)
- Collaborative editing with full permissions for all users
- Multiple visual themes (modern, futuristic, custom)
- Pins that render on top of connections

## Architecture

### Core Components

**Module Entry Points:**
- `scripts/investigation-board.js` - Main module logic, custom classes, and Foundry hooks
- `scripts/settings.js` - Module settings registration and configuration

**Custom Classes:**
- `CustomDrawing` (extends `Drawing`) - Handles PIXI.js sprite rendering for notes with backgrounds, pins, text, and photo images
- `CustomDrawingSheet` (extends `DrawingConfig`) - Configuration dialog for editing note content and properties

### Note Types and Rendering

The module supports three note types stored in drawing flags:
- **Sticky Notes** - Square notes with text content (200x200, default font size from global setting)
- **Photo Notes** - Polaroid-style notes with an image and caption (225x290, default font size from global setting)
- **Index Cards** - Wide rectangular notes for longer text (600x400, **default font size 9**)

Each note type has:
- Different default dimensions and font sizes
- Per-note font and font size customization (overrides global defaults)
- Dynamic text truncation based on font size and note type
- Configurable background images based on board mode (modern/futuristic/custom)

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
  type: "sticky" | "photo" | "index",
  text: "note content",
  image: "path/to/image.webp",  // photo notes only
  pinColor: "redPin.webp",       // assigned randomly or by setting
  identityName: "Character Name", // futuristic photo notes only
  font: "Arial",                 // per-note font (optional, falls back to global setting)
  fontSize: 16,                  // per-note font size (optional, index cards default to 9, others use global)
  connections: [                 // outgoing connections (optional)
    {
      targetId: "drawingId",
      color: "#FF0000",          // player color by default, customizable per connection
      width: 3
    }
  ]
}
```

### Scene Control Integration

The module integrates into Foundry's **Drawing Tools** control (left sidebar) via the `getSceneControlButtons` hook. All Investigation Board tools appear alongside default drawing tools.

**Creation Tools:**
- **Create Sticky Note** (fas fa-sticky-note) - Creates a 200x200 square note with global font settings
- **Create Photo Note** (fa-solid fa-camera-polaroid) - Creates a 225x290 polaroid-style note with global font settings
- **Create Index Card** (fa-regular fa-subtitles) - Creates a 600x400 wide note with **font size 9** by default

All creation buttons call `createNote(noteType)` which creates a Drawing document at canvas center with default ownership level 3 (full permissions for all users). After creation, the Select tool is automatically activated so users can immediately move the note.

**Important:** Investigation Board tools are integrated into the existing Drawing control, NOT a separate control. This allows users to access both Investigation Board notes and standard Foundry drawing tools from the same control panel.

## Key Implementation Details

### Note Edit Dialog

Double-clicking any investigation note opens the `CustomDrawingSheet` dialog with these features:

**Content Editing:**
- Text area for note content (with dynamic character limits based on font size)
- Font selector (Rock Salt, Courier New, Times New Roman, Signika, Arial)
- Font size input (8-48px, per-note setting that overrides global default)
- Image path picker for photo notes (with Browse button using FilePicker)
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
1. Background sprite (note paper texture)
2. Photo image sprite (for photo notes only, positioned with offsets)
3. Pin sprite (optional, positioned at top center, with click handler for connections)
4. Text sprites (PIXI.Text with word wrapping and truncation, using per-note font/fontSize)

**Font Handling:**
- Text rendering uses `noteData.font` and `noteData.fontSize` if set
- Falls back to global settings if note-specific values not present
- Index cards specifically default to fontSize 9 (not global setting)
- Font and fontSize scale the text, which affects character truncation limits

**Important:** Futuristic photo notes use completely different sprite layout and positioning logic than other note types. Always check `mode === "futuristic"` early in `_updateSprites()`.

### Text Truncation System

Dynamic character limits scale inversely with font size:
- Base limits stored per font in settings (`baseCharacterLimits`)
- Calculated limits adjust using `scaleFactor = BASE_FONT_SIZE / currentFontSize`
- Longer text gets "..." appended when truncated
- Different limits for each note type (sticky: ~90-250, photo: ~20-30, index: ~210-800 chars depending on font)

### Permission Model

All notes are created with `"ownership": { default: 3 }` to allow all users to edit and move them. This is core to the collaborative investigation workflow.

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
- `Hooks.once("init")` - Register settings, set `CONFIG.Drawing.objectClass`, register custom sheet, add ESC key handler for canceling connections
- `Hooks.on("getSceneControlButtons")` - Integrate Investigation Board tools into Drawings control
- `Hooks.on("updateDrawing")` - Redraw connection lines and numbers when notes move (x/y changes)
- `Hooks.on("canvasReady")` - Clean up containers (lines, preview, numbers, pins), clear connection state, initialize connection lines
- `Hooks.on("createDrawing")` - Ensure new notes are interactive in Investigation Board mode

### API Usage
- **Template Loading:** Use `foundry.applications.handlebars.loadTemplates()` (namespaced function), NOT the deprecated global `loadTemplates()`
- **Document Creation:** `canvas.scene.createEmbeddedDocuments("Drawing", [...])`
- **Canvas Interaction:** `canvas.drawings.activate()` to switch to drawing mode

### Custom Sheet Registration

```javascript
DocumentSheetConfig.registerSheet(DrawingDocument, "investigation-board", CustomDrawingSheet, {
  label: "Note Drawing Sheet",
  types: ["base"],
  makeDefault: false,
});
```

The custom sheet is assigned via `"flags.core.sheetClass": "investigation-board.CustomDrawingSheet"` when creating drawings.

## Settings

World-level settings control:

**Note Appearance:**
- Note dimensions (width in pixels for each type)
- Font family (Rock Salt, Courier New, Times New Roman, Signika, Arial) - **Default for new notes, can be overridden per-note**
- Base font size (scales with note width) - **Default for new notes (except index cards use 9), can be overridden per-note**
- Pin color (random, red, blue, yellow, green, none)
- Board mode (modern, futuristic, custom)
- Default text for new notes

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

- Notes need occasional manual refresh (select/deselect or page refresh) if updates from other users don't appear
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

## Recent Feature Updates

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
