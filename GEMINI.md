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
*   **Auto-Play**: Supports opening in "autoplay" or "autobroadcast" modes via context menu actions.

#### 3. Connection System ("Yarn")
*   **Rendering**: Quadratic Bezier curves drawn on the `DrawingsLayer`.
*   **Storage**: One-directional links stored in `flags.investigation-board.connections`.
*   **Logic**: Handles updates when notes move, removing lines if notes are deleted.
*   **Preview**: Shows a dynamic "yarn" line following the mouse cursor during the connection process.

#### 4. The HUD (`InvestigationBoardHUD`)
A custom HUD that appears next to selected notes for rapid access to:
*   Quick text editing.
*   Opening the full configuration sheet.
*   Deleting the note.
*   Removing connections.

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
    *   Double-click a note to open its sheet -> Click "Connect" -> Click target note.
    *   (Legacy/Alt) Right-click -> Context Menu -> Connect.
*   **Audio Control**:
    *   **Unified Control**: Right-click context menu options ("Play for Me", "Play for All") now route through the Note Previewer to ensure UI synchronization.
    *   **Global Broadcast**: GM can broadcast audio to all clients via sockets.

### Settings & Customization
*   **Board Mode**: Modern, Futuristic, Custom. Changes assets and styling (e.g., "Futuristic" adds neon accents and identity names).
*   **Pin Colors**: Red, Blue, Green, Yellow, Random, or None.
*   **Fonts**: Rock Salt, Courier New, Times New Roman, Signika, Arial.
*   **Dimensions**: Custom default sizes for all note types.

## Recent Development History
*   **Fix (`createPhotoNoteFromActor`)**: Now correctly extracts `actor.img` and passes it to the note, ensuring photo notes from Actors aren't blank placeholders.
*   **UX Improvement (`skipAutoOpen`)**: Notes created via Drag & Drop or Directory Context Menus no longer auto-open the edit dialog, streamlining setup.
*   **Audio Sync**: Implemented polling in `NotePreviewer` to ensure the cassette spin animation activates regardless of how playback was started (e.g., via Canvas Context Menu).
*   **Refactor**: Replaced deprecated `Dialog.confirm` with `foundry.applications.api.DialogV2.confirm` for v13 compliance.
*   **Architecture**: Consolidated audio control logic to use the `NotePreviewer` instance as the source of truth for playback state.

## Troubleshooting & Known Patterns
*   **Right-Click Issues**: If right-click stops working, check `activateListeners` in `CustomDrawing`. We forcibly override `mouseInteractionManager` permissions (`clickRight = () => true`) to ensure players can interact with GM-owned notes.
*   **Socket Latency**: Global audio might have a slight delay; the spinning animation is triggered by the local audio playback event (or polling), so it remains visually accurate to what the user hears.
*   **Permissions**: The module aggressively grants "UPDATE" permission logic via `testUserPermission` overrides to facilitate the collaborative board experience without changing actual document ownership.

## Building
No build step required. The module uses native ES Modules.
1.  Edit files in `scripts/`, `templates/`, `styles/`.
2.  Restart/Reload Foundry VTT.
