[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/W7W01A1ZN1)

# Investigation Board

A Foundry VTT module that lets everyone create, edit, and move sticky and photo notes on the scene. A must-have for investigative games like City of Mist, Call of Cthulhu, and all your conspiracy adventures.

![image](https://github.com/user-attachments/assets/aa6ac7ea-6051-4c10-b88f-c4dcc8a3bd62)

## New Feature (v1.7): Connecting Notes!

[Grabación 2026-01-13 214416.webm](https://github.com/user-attachments/assets/2f290c09-b59f-42cd-93ba-5c76cb0dc1d6)

## How to Use

<img width="349" height="661" alt="image" src="https://github.com/user-attachments/assets/62d48308-e44a-4f80-b7b3-047cf1663d64" />

Open the **Drawing Tools Toolbar** in the scene controls. You will find several custom buttons to populate your board:

### Note Types
- **Sticky Note**: Classic square notes for quick clues or short text.
- **Photo Note**: Polaroid-style frames. Perfect for suspects, locations, or evidence.
- **Index Card**: Larger lined cards for more detailed notes or descriptions.
- **Handout**: Image-only notes like maps, pictures, or documents.
- **Media (Cassette)**: Visual representation for audio recordings.

### Interaction & Linking
- **Double Click**: Opens the **Note Previewer**, a high-resolution view of the note and its contents.
- **Edit & Drag**: Move notes around by selecting them. Note that you must be in the **Drawing Tools** layer to manipulate notes.
- **Linked Objects**: You can drag and drop Actors, Items, Journal Pages, or Scenes directly onto a note (or into its configuration sheet) to link them. This creates a clickable reference in the note's preview for quick access.
- **Context Menu (Right-Click)**: Right-clicking any note opens a custom menu allowing you to:
    - **Edit**: Open the configuration sheet.
    - **View**: Open the high-res preview.
    - **Play for Me/All**: (Media notes only) Local or global audio playback.
    - **Remove Connections**: Quickly clear all yarn lines attached to the note.
    - **Open Link**: Directly open the linked document if one exists.
    - **Delete**: Remove the note from the board.

### Directory Integration
You can quickly create notes directly from your Foundry sidebars by right-clicking documents:

<img width="800" height="543" alt="image" src="https://github.com/user-attachments/assets/8ae52eb0-4dfd-4a83-b672-850801e51d7b" />

- **Actors**: Create a Photo Note using the actor's portrait. You can choose to use the actor's name or create an "Unknown" version.
- **Scenes**: Create a Photo Note using the scene's thumbnail.
- **Playlists**: Right-click a sound to create a **Media Note** pre-linked to that audio file.
- **Journals**: Right-click any **Image Page** within a journal to transform it into a **Handout**.

> **Note for Players:** If the GM has granted you drawing and file upload permissions, you can autonomously create Handout notes from Image Pages in the Journal directory to share evidence with the group!

#### **Permissions Note**: Only the GM can assign images to photo notes from the file system unless players are given browser file permissions.

If you click on the **Delete button** in the Drawing tools sidebar, **ALL DRAWINGS ON THE SCENE WILL BE DELETED**. To delete notes individually, select them and use the **Delete** key on your keyboard or use the **Right-click context menu**.

The module's settings contain some pretty straightforward options, so you can better adjust it for your table. 

### Module Settings

<img width="786" height="695" alt="image" src="https://github.com/user-attachments/assets/6eff3c27-66af-4a69-927d-d16a48ab4579" />

- **Pin Color**: Choose a fixed color for your pins (Red, Blue, Yellow, Green), set it to 'Random' for each new note, or 'No Pins' to hide them.
- **Board Mode**: **(Work in Progress)** Changes the visual theme of notes. Please use **Modern** for now as other modes are under development.
- **Connection Line Color**: Sets the fallback color for the yarn/lines connecting notes. Initial color is always the player color. Note: individual connection colors can also be edited in the note configuration.
- **Connection Line Width**: Sets the default thickness of the connection yarn (default is 7).
- **Note Widths**: Configure the default pixel width for Sticky Notes, Photo Notes, Index Cards, and Handouts.
- **Base Font Size**: Sets the starting font size for text on your notes.
- **Font**: Choose between several thematic fonts like Rock Salt or Courier New.
- **Character Name Key**: For photo notes created from Actors, this defines which data field to use for the name (e.g., `prototypeToken.name` or `system.alias` for systems like Blades in the Dark).
- **Default Note Texts**: Set the placeholder text for each new note type (Sticky, Photo, Index, Media).
- **Show Setup Warning**: Toggle the reminder for GMs about player permissions for drawings and file uploads.

## Installation

To install this module, in Foundry VTT go to the Add-on Modules tab:

Search in the top bar for "investigation board" and click Install

OR

Click Install Module

Paste the following manifest URL into the bottom Manifest URL field:

```
https://github.com/mordachai/investigation-board/releases/latest/download/module.json
```
After that go to your world and enable the module in your Game Settings under Manage Modules

## Compatibility

- **Foundry VTT v13.x** (minimum v13.332)
- For Foundry v12.x, please use module version 1.3.2 (has a lot less features)
