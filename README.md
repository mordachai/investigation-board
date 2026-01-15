[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/W7W01A1ZN1)

# Investigation Board

A Foundry VTT module that lets everyone create, edit, and move sticky and photo notes on the scene. A must-have for investigative games like City of Mist, Call of Cthulhu, and all your conspiracy adventures.

![image](https://github.com/user-attachments/assets/aa6ac7ea-6051-4c10-b88f-c4dcc8a3bd62)

## New Feature (v1.7): Connecting Notes!

[Grabación 2026-01-13 214416.webm](https://github.com/user-attachments/assets/2f290c09-b59f-42cd-93ba-5c76cb0dc1d6)

## How to Use

<img width="353" height="597" alt="image" src="https://github.com/user-attachments/assets/2281093f-3567-485b-97be-5653ccddddb0" />

Open the Drawing Tools Toolbar, the buttons to create the notes are there:

- 3 types of notes: Sticky, Photo, and Index Card
- Double click on a note let you edit the content
- Delete key: delete selected note

### Create and Edit a Note

Click Create Sticky Note/Photo Note to place one of them in the middle of the scene.

The scene will automatically go to __drawing mode__, and you can change the note content with a DOUBLE CLICK.

__Edit and drag__ the note around is only possible in **drawing mode** ![image](https://github.com/user-attachments/assets/4b6ecb10-2ab4-4328-82fb-939bbcca1f91)
, since in the end, they are a drawing. 

#### **Note** (pun intended): Only the GM can assign an image to the photo notes unless she/he/they give you browser file permissions.

If you click on the Delete button of the Drawing tools, ALL NOTES WILL BE DELETED, so beware. To delete notes and drawings individually, select them and use the Delete button on your keyboard.

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
