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

![image](https://github.com/user-attachments/assets/47a642e8-ee5f-4d8a-89cf-c670e84276c2)


## Installation

To install this module, in Foundry VTT go to the Add-on Modules tab:

Search in the top bar for "investigation board" and click Install

OR

Click Install Module

Paste the following manifest URL into the bottom Manifest URL field: https://raw.githubusercontent.com/mordachai/investigation-board/main/module.json

After that go to your world and enable the module in your Game Settings under Manage Modules

## Compatibility

- **Foundry VTT v13.x** (minimum v13.332)
- For Foundry v12.x, please use module version 1.3.2

## Known Limitations

- **Refresh on Update:** The module includes a hook to ensure notes are redrawn when updated by others. However, if something seems out of date, try selecting/deselecting notes or refreshing the page.
