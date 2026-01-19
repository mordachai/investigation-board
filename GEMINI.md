# Investigation Board - Foundry VTT Module

## Project Overview

**Investigation Board** is a comprehensive Foundry VTT module designed to transform the canvas into an interactive mystery map. It empowers players and GMs to create, connect, and manage various types of clues using a visual "sticky note" interface. The module heavily leverages standard Foundry `Drawing` documents, extending them with custom rendering, behaviors, and interactivity suited for investigation scenarios.

### Core Philosophy
*   **Player Agency:** All players can move, edit, and connect notes, regardless of who created them (permissions are effectively overridden for Board items via socket logic).
*   **Visual Cohesion:** Notes look like physical objects (photos, sticky notes, index cards) rather than generic UI windows.
*   **Immersive Audio:** Media notes provide synchronized audio playback ("Play for Everyone") visualized as spinning cassette tapes.

## Technical Architecture

### Tech Stack
*   **Foundry VTT API (v13+)**: Built for modern Foundry.
    *   **Application V2**: All new UIs must use `foundry.applications.api.ApplicationV2` or `DocumentSheetV2`.
    *   **FilePicker**: **CRITICAL**: Use `foundry.applications.apps.FilePicker.implementation`. The global `FilePicker` is deprecated.
        *   To open UI: `new FilePicker({...}).render(true)`.
        *   Static methods: `FilePicker.upload`, `FilePicker.browse` (namespaced).
    *   **Math Helpers**: Use `Math.clamp()` (standard) instead of the deprecated `Math.clamped()`.
*   **PIXI.js**: Powered by Foundry's underlying PIXI engine for rendering "yarn" lines, pins, and custom note sprites.
*   **Socket API**: Robust custom socket handler for collaborative actions (e.g., deletions, updates) and global audio broadcasting.

### Modular File Structure
*   `scripts/main.js`: Entry point, hooks (Paste, Context Menus), and mode management.
*   `scripts/config.js`: Centralized constants and configuration.
*   `scripts/state.js`: Module-wide state management.
*   `scripts/apps/`: UI components (`CustomDrawingSheet`, `NotePreviewer`, `InvestigationBoardHUD`).
*   `scripts/canvas/`: Canvas objects and rendering logic (`CustomDrawing`, `ConnectionManager`).
*   `scripts/utils/`: Shared utilities (`SocketHandler`, `CreationUtils`, `Helpers`).

### Key Components

#### 1. Custom Drawing (`CustomDrawing` extends `Drawing`)
The heart of the module. It overrides standard drawing behaviors to:
*   **Rendering**: Draw background sprites (notes), pins, and photo frames.
*   **Interactivity**: Force `mouseInteractionManager` permissions to allow right-clicks for all users.

#### 2. Clipboard & Import Integration
*   **Paste Handler**: Listens for `paste` events on the document.
    *   Detects images in clipboard.
    *   Uploads to `assets/ib-handouts/` with **Unique Filenames** (Timestamp + RandomID) to prevent caching/overwriting.
    *   Creates a Handout Note immediately.
*   **Context Menus**:
    *   **Journals**: "Create Handout Note" added to image context menus.
    *   **Image Popouts**: "Create Handout Note" added to the header ellipsis menu.
    *   **Directories**: Import Folder/Playlist options for bulk note creation.

#### 3. Connection System ("Yarn")
*   **Rendering**: Realistic "Twisted Yarn" appearance using Quadratic Bezier curves.
*   **Logic**: Handles updates when notes move, removing lines if notes are deleted.
*   **Pins**: Visual anchor points for connections.

## Data Model
All data is stored in `drawing.document.flags['investigation-board']`:

| Property | Type | Description |
| :--- | :--- | :--- |
| `type` | String | `sticky`, `photo`, `index`, `media`, `handout` |
| `text` | String | The content text of the note. |
| `image` | String | Path to the main image (for Photo/Handout/Media). |
| `audioPath` | String | Path to audio file (Media notes only). |
| `connections` | Array | List of target note IDs for yarn lines. |
| `linkedObject` | String | UUID link to a Foundry document (Actor, Item, etc.). |
| `font` | String | Font family used for this specific note. |
| `fontSize` | Number | Font size override. |

## Development Rules & Patterns

### 1. v13 API Strictness
*   **FilePicker**: Always import `const FilePicker = foundry.applications.apps.FilePicker.implementation;`.
    *   NEVER use `new FilePicker().browse()`. Use `.render(true)` for UI, or static `FilePicker.browse()` for data.
*   **Math**: Always use `Math.clamp()`.
*   **AppV2**: Prefer `foundry.applications.api.DialogV2` over `Dialog`.

### 2. Note Creation vs. Paste
To distinguish between a user clicking a tool (creates a fresh note) and a user Copy/Pasting (Ctrl+C/V) an existing note:
*   **Tool Creation**: Passes `{ ibCreation: true }` in the options to `collaborativeCreate`.
*   **Paste/Duplicate**: Lacks this flag.
*   **Hook Logic (`preCreateDrawing`)**: If `!options.ibCreation` and `!data._id`, it is treated as a paste. We:
    *   Clear connections (`flags...connections: []`).
    *   Suppress the auto-open sheet (`options.skipAutoOpen = true`).

### 3. Collaborative Editing
*   Users generally do not have ownership of Drawings.
*   We use `socket-handler.js` to route `update` and `create` requests to the GM.
*   `collaborativeUpdate` and `collaborativeCreate` are the primary entry points.

## Building
No build step required. The module uses native ES Modules.
1.  Edit files in `scripts/`.
2.  Restart/Reload Foundry VTT.
