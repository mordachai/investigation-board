# Investigation Board - Foundry VTT Module

## Project Overview

**Investigation Board** is a comprehensive Foundry VTT module designed to transform the canvas into an interactive mystery map. It empowers players and GMs to create, connect, and manage various types of clues using a visual "sticky note" interface. The module heavily leverages standard Foundry `Drawing` documents, extending them with custom rendering, behaviors, and interactivity suited for investigation scenarios.

### Core Philosophy
*   **Player Agency:** All players can move, edit, and connect notes, regardless of who created them (permissions are effectively overridden for Board items).
*   **Visual Cohesion:** Notes look like physical objects (photos, sticky notes, index cards) rather than generic UI windows.
*   **Immersive Audio:** Media notes provide synchronized audio playback ("Play for Everyone") visualized as spinning cassette tapes.

## Technical Architecture

### Tech Stack
*   **Foundry VTT API (v13+)**: Built for modern Foundry, utilizing `ApplicationV2` frameworks and ES modules.
*   **PIXI.js**: Powered by Foundry's underlying PIXI engine for rendering "yarn" lines, pins, and custom note sprites.
*   **Socket API**: Robust custom socket handler for collaborative actions (e.g., deletions, updates) and global audio broadcasting.

### Modular File Structure
The module is refactored into a clean, modular structure for better maintainability:
*   `scripts/main.js`: Entry point, hook registrations, and mode management.
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
*   **Context Menu**: A custom right-click menu tailored for note management (Edit, View, Play Audio, Connect).

#### 2. Note Previewer (`NotePreviewer` extends `ApplicationV2`)
A "Detail View" triggered by double-clicking a note.
*   **Visuals**: Displays high-res versions of photos or text.
*   **Audio**: Contains the cassette interface with a unified "Play for Everyone" button and local playback controls.
*   **Sync**: Polls `game.audio` to animate spinning reels even if playback was triggered externally.

#### 3. Connection System ("Yarn")
*   **Rendering**: Realistic "Twisted Yarn" appearance using Quadratic Bezier curves with diagonal ply texture.
*   **Color Logic**: Automatically adjusts player colors to more realistic, darker "yarn-like" hues while avoiding becoming too dark or muddy.
*   **Storage**: One-directional links stored in `flags.investigation-board.connections`.
*   **Logic**: Handles updates when notes move, removing lines if notes are deleted.
*   **Preview**: Shows a dynamic "yarn" line following the mouse cursor during the connection process.

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
| `identityName` | String | Special name field for "Futuristic" mode. |

## Features & Mechanics

### Note Types
1.  **Sticky Note**: Classic square note for short text.
2.  **Photo Note**: Polaroid-style frame mounting an image (Actor/Scene/User provided) with a caption.
3.  **Index Card**: Larger lined card for longer text.
4.  **Handout**: Image-only note (documents, maps) with transparent background.
5.  **Media (Cassette)**: Represents audio. Plays local or global sound. Animates when playing.

### Interaction Model
*   **Creation**:
    *   **Drag & Drop**: Drag Actors, Scenes, Journal Pages, or Playlist Sounds onto the canvas.
    *   **Scene Controls**: Use the "Investigation Board" tool layer.
*   **Connection**:
    *   Click on a Note's **Pin** to start a connection -> Click on target Note's **Pin** to finish.
    *   Supports live preview line and connection numbering during the process.
*   **Audio Control**:
    *   **Unified Control**: Right-click context menu options ("Play for Me", "Play for All") now route through the Note Previewer to ensure UI synchronization.

### Settings & Customization
*   **Board Mode**: Modern, Futuristic, Custom. Changes assets and styling.
*   **Pin Colors**: Red, Blue, Green, Yellow, Random, or None.
*   **Fonts**: Rock Salt, Courier New, Times New Roman, Signika, Arial.
*   **Dimensions**: Custom default sizes for all note types.

## Recent Development History
*   **Twisted Yarn Rendering**: Implemented a realistic rope-like texture for connection lines with diagonal hatching.
*   **Automatic Color Adjustment**: Added `getRealisticYarnColor` to automatically darken and desaturate bright player colors for a more authentic physical yarn look.
*   **Architectural Refactoring**: Decomposed the monolithic `investigation-board.js` into a modular directory structure using ES Modules.
*   **Fix (`createPhotoNoteFromActor`)**: Now correctly extracts `actor.img` and passes it to the note.
*   **UX Improvement (`skipAutoOpen`)**: Notes created via Drag & Drop or Directory Context Menus no longer auto-open the edit dialog.

## Troubleshooting & Known Patterns
*   **Right-Click Issues**: If right-click stops working, check `activateListeners` in `CustomDrawing`. We forcibly override `mouseInteractionManager` permissions to ensure all players can interact.
*   **Permissions**: The module aggressively grants "UPDATE" permission logic via `testUserPermission` overrides to facilitate the collaborative board experience without changing actual document ownership.

## Building
No build step required. The module uses native ES Modules.
1.  Edit files in `scripts/`.
2.  Restart/Reload Foundry VTT.