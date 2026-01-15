# Investigation Board - Foundry VTT Module

## Project Overview

**Investigation Board** is a Foundry VTT module that transforms the canvas into an interactive investigation board. It allows players and GMs to create sticky notes, photo notes, index cards, handout-style notes, and media recordings, and connect them with "yarn" lines to map out mysteries and conspiracies.

### Key Technologies
*   **Foundry VTT API (v13)**: Built for the latest Foundry version using `ApplicationV2` and modern namespaced implementations (e.g., `foundry.applications.ux.TextEditor.implementation`).
*   **PIXI.js**: Core rendering engine for notes, pins, and connection lines on the `DrawingsLayer`.
*   **ES Modules**: Standard JavaScript modules without a build step.
*   **Socket API**: Custom socket implementation for collaborative editing, global audio broadcasting, and cross-permission deletions.

### Core Architecture
*   **Custom Classes**:
    *   `CustomDrawing` (extends `Drawing`): Manages visual representation, custom interaction logic, and context menus.
    *   `CustomDrawingSheet` (extends `DrawingConfig`): Custom editor for persistent note properties.
    *   `NotePreviewer` (extends `ApplicationV2`): A large-format "Detail View" for notes, supporting enriched links and synchronized media playback.
*   **Data Storage**: Persistent state is stored in `drawing.document.flags['investigation-board']`.
*   **Connection System**: One-directional links stored in the source note, rendered globally as quadratic bezier curves with a "yarn" texture.

## Interaction Model
*   **Double-Click**: Opens the **Detail View** (`NotePreviewer`).
*   **Right-Click**: Opens a custom context menu with comprehensive management options:
    *   **Edit**: Opens the configuration sheet.
    *   **View**: Opens the Detail View (same as double-click).
    *   **Open [Linked Object]**: Directly opens the sheet of any associated Foundry document.
    *   **Play/Stop (Media only)**: Controls local and global audio playback directly from the canvas.
    *   **Remove Connections**: Performs a "deep clean" by removing all yarn lines arriving at or departing from the note.
    *   **Delete**: Deletes the note with a confirmation prompt.
*   **Drag-and-Drop**: Supports linking Foundry documents (Actor, Item, etc.) by dragging them onto notes or into the edit dialog.

## Note Types & Rendering
*   **Sticky/Photo/Index**: Themed backgrounds with text truncation. Photo notes feature dynamic frames that "mount" images precisely.
*   **Handout**: Image-only notes with transparent backgrounds and auto-resize logic.
*   **Media**: Cassette tape notes representing audio evidence.
    *   Standard width: 400px (0.74 height ratio).
    *   Synchronized "spinning reels" animation in Detail View during playback.
    *   Sophisticated audio management to prevent overlapping playback instances.
    *   **Context Menu**: Created from the Playlist sidebar using `getPlaylistDirectorySoundContext` for individual sound entries.

## Critical Fix: The Right-Click Permission Bug
Foundry's `MouseInteractionManager` aggressively blocks right-click events on `PlaceableObjects` that the current user does not own. Standard sheet registration and permission overrides are often insufficient to enable the right-click context menu for players on GM-created notes.

**The Multi-Layered Solution implemented in `CustomDrawing`:**
1.  **`activateListeners` Override**: Manually injected permission overrides into the `mouseInteractionManager` instance:
    `this.mouseInteractionManager.permissions.clickRight = () => true;`
2.  **`testUserPermission` Override**: Forced the document to report `true` for all permission checks up to `OWNER` level. This satisfies internal Foundry checks that decide if an object is "interactable."
3.  **`canUserModify` Override**: Returned `true` to ensure the object is treated as "writable" by the interaction manager, which is a prerequisite for certain mouse events.
4.  **Event Propagation**: Explicitly called `event.stopPropagation()` in `_onClickRight` and `_onClickRight2` to prevent Foundry's default single/double right-click handlers from interfering with the custom menu.

## Development Conventions & Tips
*   **Linked Objects**: Always use `@UUID[document.uuid]{name}` format for compatibility.
*   **Collaborative Actions**: Use `collaborativeUpdate` and `collaborativeDelete` to route actions through the GM via sockets when the player lacks direct permission.
*   **Audio Broadcasting**: Use the `playAudio` and `stopAudio` socket actions for global synchronization.
*   **Permissions**: Always use `doc.testUserPermission(game.user, "LIMITED")` before attempting to render a linked document's sheet.

## Building and Running
1.  **Edit**: Modify files in `scripts/`, `templates/`, or `styles/`.
2.  **Test**: Reload the Foundry VTT world. No build step required.