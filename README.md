[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/W7W01A1ZN1)

# Investigation Board
![Foundry v13](https://img.shields.io/badge/foundry-v13-green?style=for-the-badge) ![Github All Releases](https://img.shields.io/github/downloads/mordachai/investigation-board/total.svg?style=for-the-badge) ![GitHub Release](https://img.shields.io/github/v/release/mordachai/investigation-board?display_name=tag&style=for-the-badge&label=Current%20version)

A Foundry VTT module that lets everyone create, edit, and move sticky and photo notes on the scene. A must-have for investigative games like City of Mist, Call of Cthulhu, and all your conspiracy adventures.

<img width="1200" height="655" alt="image" src="https://github.com/user-attachments/assets/329f44f1-0c5a-455e-b3d1-d585cc3ed665" />

## NEW FEATURE (v 4.3.2) >> Notes From Items:

You can now create photo notes from items too. They will be automatically linked to them.

<img width="600" height="468" alt="image" src="https://github.com/user-attachments/assets/c6b6715c-0bbe-4706-8c07-91cfb2530d0e" />

------

## NEW FEATURE: Old Tape Sound Effects:
<img width="609" height="482" alt="image" src="https://github.com/user-attachments/assets/d8a8d34b-8ef8-41f7-9b83-ecb16241fee1" />

Now you can activate a sound effect filter to make the audio even more immersive. This option is on by default in all Media notes created. Remember to edit and uncheck if you want the original audio.

------

## NEW FEATURE: Connecting Notes:

Click on a pin, click on the other. That's it.

Connecting lines will always have the player's Foundry color initially. You can change it in the Edit menu.

**REMEMBER: YOU NEED TO BE IN DRAW MODE TO MAKE ALL OF THIS**

-----

## CHECK OUT THE VIDEO ↓ 

https://github.com/user-attachments/assets/ee486ed2-040f-4d93-a379-e162cf052986

## How to Use

Open the **Drawing Tools Toolbar** in the scene controls. You will find several custom buttons to populate your board:

<img width="349" height="661" alt="image" src="https://github.com/user-attachments/assets/62d48308-e44a-4f80-b7b3-047cf1663d64" />

### Note Types
- **Sticky Note**: Classic square notes for quick clues or short text.
- **Photo Note**: Polaroid-style frames. Perfect for suspects, locations, or evidence.
- **Index Card**: Larger lined cards for more detailed notes or descriptions.
- **Handout**: Image-only notes like maps, pictures, or documents.
- **Media (Cassette)**: Visual representation for audio recordings.

<img width="800" height="500" alt="image" src="https://github.com/user-attachments/assets/9862eaab-8747-4df5-8153-4a795d1ef19d" />

-----

### Scene in Compendiums

Don't have a scene? Don't worry, you can use this corkboard scene for starters. Import it in your level and knock yourself out!

<img width="978" height="711" alt="image" src="https://github.com/user-attachments/assets/0ea03a2e-a5fc-4f4e-a0b2-8f9b2b690f66" />

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

<img width="800" height="385" alt="image" src="https://github.com/user-attachments/assets/84e46265-a879-40d2-b387-129ffe5a9670" />

- **Actors**: Create a Photo Note using the actor's portrait. You can choose to use the actor's name or create an "Unknown" version.
- **Scenes**: Create a Photo Note using the scene's thumbnail.
- **Items**: Create a Photo Note using the item name and thumbnail.
- **Playlists**: Right-click a sound to create a **Media Note** pre-linked to that audio file.
- **Journals**: Right-click any **Image Page** within a journal to transform it into a **Handout**.

> **Note for Players:** If the GM has granted you drawing and file upload permissions, you can autonomously create Handout notes from Image Pages in the Journal directory to share evidence with the group!

#### **Permissions Note**: Only the GM can assign images to photo notes from the file system unless players are given browser file permissions.

-----

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

-----

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

-----

## Compatibility

- **Foundry VTT v13.x** (minimum v13.332)
- For Foundry v12.x, please use module version 1.3.2 (has a lot less features)
