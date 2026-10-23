# Kavya ![Version](https://img.shields.io/badge/version-2.1.1-green.svg)

Connect [Paperback](https://paperback.moe/) to your [Kavita](https://www.kavitareader.com/) manga and comic libraries.

Primary author and maintainer: [KaitoKid](https://github.com/KaitoKid). Original author: [ACK72](https://github.com/ACK72/kavya-paperback). Licensed under [BSD 2-Clause](LICENSE).

Requires Paperback's **0.8 extension API** and **Kavita 0.9**.

## Install or update

Add this repository as a source in Paperback:

[https://kaitokid.github.io/kavya-paperback/](https://kaitokid.github.io/kavya-paperback/)

**Existing users:** Click **UPDATE** to replace the old extension, including ACK72's version.

**New users:** Install **Kavya**, then open **Server Settings** and enter your Server URL and Kavita API Key. Check **Connection**.

## What's changed

Compared with [ACK72's Kavya 1.3.6](https://github.com/ACK72/kavya-paperback/tree/66a2f69bf24a30af999c0c66525117fe70a5733c) (April 2024):

- Fix search, filtering and pagination for Kavita 0.9.
- Refresh authentication and fix rating updates.
- Follow your Kavita dashboard order, including series smart filters.
- Add genre/tag exclusions, publication status and read progress filters.
- Improve chapter/volume ordering and show chapter progress and connection status.

## Limitations

Manga/comics only: Book and Light Novel libraries and EPUBs are hidden.

Tracking requires a Paperback collection and Kavita track list. Reading in the viewer syncs progress; manual **Mark as read** does not.
