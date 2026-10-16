# Kites and Threads Workflow - install and run

An offline-first workflow app for the studio: leads, jobs, milestone stages,
workflow tasks, quotes, invoices, payments, an automated email log, backup
export/import, and optional sync between your own devices.

Everything is plain files. There is no account, no server to pay for, and no
build step needed to use the app in a browser.

## What is in the folder

| File | Purpose |
| --- | --- |
| `index.html` | The whole app (layout, screens, sync buttons). |
| `workflow.js` | Pure workflow logic: milestones, tasks, quotes, invoices. |
| `pwa.js` | Install prompt and offline indicator. |
| `sw.js` | Service worker: caches the app so it opens without a network. |
| `manifest.webmanifest` | Makes the app installable on a phone home screen. |
| `icons/` | App icons for the desktop app, phone home screen and taskbar. |
| `main.js` | Electron entry point for the Mac desktop app. |
| `sync-server.js` | Optional sync server you run on one computer on your network. |
| `build.js` | Writes one self-contained HTML file that works fully offline. |
| `invoice.js` | Builds the quote and invoice document in the studio's own layout. |
| `logo-black.png` | The black lockup used on documents, drawn from `assets/`. |
| `tools/` | Helper scripts: app icons, the document logo, and the app probe. |
| `workflow.test.js`, `invoice.test.js`, `sync-server.test.js` | Tests for all three modules. |

## Quotes and invoices

Every job has a Quote / invoice section. Fill in the place, the events, the charge and
the add-ons, then use Preview and print. The preview is the studio's own document, three
A4 pages: the lockup and details boxes plus the covering letter, then the package details
with crew, photo and film output, then the charge, the add-ons and Thank You.

To get a file, choose Save as PDF in the print dialog. In the Mac app that is the PDF
button in the print panel, on a phone it is Save as PDF in the share sheet.

The Studio button holds the studio details and the standard wording, so new documents
start already written. A document saved on a job keeps its own copy, so changing the
standard wording later never changes a quote that has already gone out.

## Run it in a browser

Open `index.html`. That is it. It works from a USB stick, from a folder on your
desktop, or from a web host. Your data is saved in that browser's local storage.

To make one portable file instead, run `node build.js`. It writes
`kites-and-threads-workflow.standalone.html`, which has the styles, logic and
logo baked in and needs no other file.

## Mac desktop app

From the `kites-workflow-ninja` folder:

```
npm install
npm start
```

That opens the app in its own window with its own storage, separate from Safari
and Chrome.

To build a real, double-clickable Mac app bundle:

```
npm run dist:mac
```

The finished app appears in `dist/`. It is unsigned, so the first time you open
it, right-click it and choose Open, then confirm. After that it opens normally.
Drag it to your Applications folder if you want it there.

Note: the Mac app keeps its own data. Use Export backup in the app, or the sync
buttons, to move data between the Mac app and a phone.

## Android phone

Android installs a web app to the home screen only when the page is served over
**https** (or from localhost). A plain `http://192.168.x.x` address will not show
the install option, because browsers refuse service workers on insecure origins.
The app still works over plain http, it just will not install.

So, to install on the phone:

1. Put this folder on any static https host (or on a small https server you
   control). All paths are relative, so it can live in a subfolder.
2. Open the address in Chrome on the phone.
3. Tap the three-dot menu and choose **Add to Home screen** (**Install app** on
   newer versions).
4. Repeat on every phone or tablet you want to use.

The icon then behaves like a normal app: full screen, no browser bars, and it
opens with no network.

## Sync between devices

`sync-server.js` is a tiny dependency-free server that keeps one copy of your
data on your network, so your Mac and your phone can exchange it.

Start it on the computer that stays at the studio:

```
node sync-server.js
```

It prints a `localhost` address and one address per network interface. On each
device, type the printed address into the **Sync server** box at the top of the
app, then use **Push to server** or **Pull from server**. The address is
remembered on that device.

How it behaves, honestly:

- Sync is manual. You press Push or Pull. There is no background syncing.
- The last push wins. If two people change data at the same time, the later push
  overwrites the earlier one. Agree on who pushes when.
- There is no password. Anyone on the same network who can reach the port can
  read and change the data, so only run it on a trusted network such as your
  home or studio wifi. Do not expose it to the internet as-is.
- Only your own copies sync. A device that never pulls keeps its old data.

If you need it to work from anywhere, host the app over https and host one
sync server with a password in front of it. Ask before doing that: the current
server has no authentication.

## Backups

**Export backup** downloads a JSON file with every lead, job type, task, quote,
invoice and payment. Keep it somewhere safe such as Google Drive or an external
drive. **Import backup** replaces the data on that device with the file's
contents, so export first if you are not sure.

On its own, each device has its own copy of the data in local storage. Until you
sync or export, the devices do not know about each other.

## Tests

```
npm test
```

Runs the workflow unit tests with Node's built-in test runner. No network, no
browser needed.
