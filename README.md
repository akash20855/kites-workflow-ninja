# Kites Workflow Ninja

The studio workflow app for Kites and Threads: leads, jobs, workflow tasks, quotes,
invoices, payments and an email log, plus the quote and invoice document the studio
already sends clients.

It runs three ways from the same code:

| Where | How | Data |
| --- | --- | --- |
| Mac desktop app | `npm start`, or the built app in `dist/` | this Mac, inside the app |
| Phone / any browser | open the address the sync server prints, or any https host | that device's browser |
| One offline file | `kites-and-threads-workflow.standalone.html` | wherever you open it |

Everything works with no internet. Each device keeps its own copy of the data, and the
sync server moves a copy between devices when you ask it to.

## Quick start on the Mac

```bash
npm install
npm start            # run the app
npm run dist:mac     # build dist/mac-arm64/Kites Workflow Ninja.app
```

The built app is unsigned, so the first time you open it, right click it and choose Open.

## On a phone

Browsers only offer "Add to Home screen" and offline use over https or on localhost, so:

1. Start the sync server on the Mac: `npm run sync`
2. Open the printed address on the phone, for example `http://192.168.1.10:8787`

A plain `http://192.168.x.x` address still works, it just cannot be installed or used
offline, because browsers only allow that on https or localhost. To install it on the
phone, put the folder on any https host (or a tunnel) and open that address, then use the
browser menu and Add to Home screen. The app then opens full screen and works with no
signal, saving each change on the device.

## Sync between devices

```bash
npm run sync                          # local network, no password
PORT=8080 npm run sync                # different port
SYNC_TOKEN=my-secret npm run sync     # require a token, for hosting it on the internet
```

Then in the app open Sync, enter that address once and use Pull and Push. Keys:

- Manual: nothing syncs by itself. Pull replaces this device's data with the server copy,
  push overwrites the server copy with this device's data. The last push wins, so do not
  edit the same job on two devices at once.
- The server serves the whole app, so the phone gets the real app, offline capable.
- `GET /api/health` reports whether data is stored yet, and `sync-data.json` next to the
  server is the stored copy. It is never served over HTTP and is kept out of git.
- Anyone who can reach the port can read and change the data, so only run it on a network
  you trust, and set `SYNC_TOKEN` if you expose it.

## The quote and invoice document

Each job has a Quote / invoice section. Fill in the place, the events, the charge and the
add-ons, then use Preview and print. The preview reproduces the studio's own document:
the black lockup and the three detail boxes on page one, the covering letter, the package
details with crew, photo and film output on page two, and the charge, add-ons and Thank
You on page three.

To get a file, choose Save as PDF in the print dialog. In the Mac app that is the PDF
button in the print panel; on a phone it is Save as PDF in the share sheet.

The Studio button holds the studio details and the standard wording, so a new quote starts
already written. A document saved on a job keeps its own copy, so changing the standard
wording never changes a quote that has already gone to a client.

## Backups

Export writes a dated `.json` backup of everything, and Import restores one. Use it before
a big change, and to move data between devices without the sync server.

## Checks

```bash
npm test     # 43 tests: workflow logic, the document, and the sync server
npm run icons   # regenerate the app icons from assets (needs macOS tools)
npm run build   # rebuild the single offline file
```

To check the built app rather than the source:

```bash
npm start -- --remote-debugging-port=9222
SYNC_URL=http://127.0.0.1:8787 node tools/probe.js
```

The probe adds a temporary lead, checks the app, the document and the sync server, then
puts the device data back as it found it.

## Files

| File | What it is |
| --- | --- |
| `index.html` | the app: overview, jobs, workflow, quotes, payments, document editor |
| `workflow.js` | pure workflow logic: milestones, tasks, quotes, invoices, reporting |
| `invoice.js` | the quote and invoice document: data defaults, wording and layout |
| `pwa.js`, `sw.js`, `manifest.webmanifest` | install and offline support |
| `main.js` | the Mac app shell |
| `sync-server.js` | serves the app and the sync API, optional token |
| `build.js` | builds the single offline file |
| `tools/` | icon, logo and probe helpers |
| `icons/` | app icons, drawn from `assets/` |

## Limits worth knowing

- Automated emails are written to the email log, not actually sent. Sending needs a mail
  service connected to the app.
- Sync is manual and last-push-wins. There is no merge and no per-user accounts.
- The Mac app is unsigned (no Apple developer certificate), so Gatekeeper needs the first
  open to be confirmed by hand.
