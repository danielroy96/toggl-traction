# Toggl Traction

[![CI](https://github.com/danielroy96/toggl-traction/actions/workflows/ci.yml/badge.svg)](https://github.com/danielroy96/toggl-traction/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/danielroy96/toggl-traction)](https://github.com/danielroy96/toggl-traction/releases/latest)

An accessible, cross-platform desktop time tracker (Electron + React + TypeScript)
that talks to the [Toggl Track](https://track.toggl.com) API. Built with a focus
on **accessibility**, a **reliable always-on-top mini timer**, and **robust
start/stop** behaviour.

## Download

Grab an installer from the [latest release](https://github.com/danielroy96/toggl-traction/releases/latest):

- **macOS** — `.dmg` (or `.zip`)
- **Windows** — `Toggl-Traction-Setup-*.exe` (or `.zip`)
- **Linux** — `.AppImage` or `.deb`

Installers are built for all three platforms by the [release workflow](.github/workflows/release.yml)
on each `v*` tag. Builds are currently unsigned, so the OS may warn on first launch.

### macOS first launch

The macOS build is ad-hoc signed but not notarized, so on first launch
Gatekeeper says it *"could not verify … is free of malware"* and blocks it.
This is expected — approve it once and it launches normally thereafter.

**macOS 13–14 (Ventura/Sonoma):** right-click (or Control-click) **Toggl
Traction** in Finder → **Open**, then confirm **Open** in the dialog.

**macOS 15+ (Sequoia):** the right-click shortcut was removed. Double-click the
app, dismiss the warning, then open **System Settings → Privacy & Security**,
scroll down, and click **Open Anyway** next to the Toggl Traction message.

Alternatively, on any version, clear the quarantine flag from a terminal to
open it directly:

```bash
xattr -dr com.apple.quarantine "/Applications/Toggl Traction.app"
```

(An older download from before the app was signed may instead report as
*"damaged and can't be opened"* — the same command fixes that.)

## Contributing

`main` is protected: every change lands via a pull request and CI (typecheck,
WCAG contrast, timer tests, build) must pass before merging.

## Features

- **Sign in with a Toggl API token** (OAuth can be layered on later — see
  _Auth_ below). The token is stored encrypted with the OS keychain via
  Electron `safeStorage`, never in plaintext.
- **Modern, scalable UI**: timer bar, entries grouped by day with daily totals,
  resume/delete, and a settings screen.
- **Projects and tasks** — full Toggl Project → Task hierarchy in a single
  accessible picker (e.g. _PROJ – Platform · Code review_), in both the main
  window and the mini timer. Degrades to projects-only on plans without tasks.
- **Rich editing** — every time entry, running or finished, is editable:
  description, project/task, and start/stop times, plus delete. Click an entry
  to open the editor; the running entry's description/project/task update live.
- **Always-on-top mini timer** — a compact glance view (time, description,
  project/task) that **expands with an animation on click** to reveal an
  editable description and project/task picker. Stays above other apps and
  survives display changes / fullscreen apps (see _Reliability_).
- **Suggestions pipeline** for automatic tracking, with scaffolded sources for
  IntelliJ/IDE window detection (branch/ticket refs), Jira and Google Calendar.
- **System tray** with quick start/stop and show/quit.

## Accessibility (WCAG 2.1 AA)

Accessibility was a first-class requirement, not an afterthought:

- **Colour contrast** — every text/background and UI-boundary pairing in all
  three themes (dark, light, high-contrast) is verified against WCAG 2.1 AA by
  `scripts/check-contrast.mjs` (`npm run check:contrast`). Body text ≥ 4.5:1,
  large text and component boundaries ≥ 3:1. There is also a dedicated
  **high-contrast** theme.
- **Respects OS text scaling** — the root font size is the OS/browser default
  (`font-size: 100%`), so the operating system's accessibility text-size
  setting scales the whole UI. A manual multiplier (100–200%) can scale further.
  Everything is sized in `rem`, so the entire layout scales proportionally.
- **Large targets** — all interactive controls are at least 44×44px at default
  scale (`--target-min`).
- **Visible focus** — a 3px focus ring (contrast-checked) on every focusable
  element for keyboard users; native `<select>`/`<input>`/checkbox elements are
  used so screen-reader and keyboard semantics come for free.
- Skip link, `aria-live` timer, descriptive `aria-label`s, and
  `prefers-reduced-motion` support.

## Reliability (the bugs this fixes)

- **Always-on-top mini timer that doesn't vanish** — the topmost flag is
  re-asserted on show/blur/focus, on display add/remove/metrics-change, and on a
  low-frequency heartbeat, plus `setVisibleOnAllWorkspaces(..., { visibleOnFullScreen })`.
  Closing the window hides it (state/position preserved) rather than destroying it.
  See `src/main/windows.ts`.
- **Robust start/stop** — the running timer is owned by a single source of truth
  in the main process (`src/main/timer.ts`). Every mutating call is funnelled
  through a single-slot queue, so a double-click can't create two entries and a
  stop-during-start resolves in order. Buttons disable while a request is in
  flight. This logic is unit-tested in `scripts/timer-test.ts` (`npm test`).

## Architecture

```
src/
  shared/          Types + IPC channel names shared everywhere
  main/            Electron main process
    index.ts       App controller: wires services + IPC surface
    windows.ts     Main window + always-on-top mini timer
    timer.ts       TimerManager — serialized start/stop source of truth
    toggl/         Toggl Track v9 API client
    store.ts       Encrypted token (safeStorage) + settings JSON
    tray.ts        System tray
    integrations/  Suggestion engine + scaffolded sources
  preload/         contextBridge — typed, safe `window.toggl` API
  renderer/        React UI (Vite)
    src/components/ TimerBar, EntryList, LoginView, SettingsView, ...
    src/mini/       MiniTimer
    src/store/      Zustand store bound to the preload bridge
    src/styles/     Design tokens (WCAG-verified) + component/layout CSS
```

Data flow: renderer → preload `window.toggl.*` → `ipcRenderer.invoke` → main
IPC handler → service → broadcast (`webContents.send`) → renderer store. The
main process is always the source of truth, so the main and mini windows can
never disagree.

## Getting started

```bash
npm install          # installs deps AND downloads the Electron binary
npm run dev          # launches the app with hot reload
```

Then sign in: on track.toggl.com go to **Profile settings → API Token**, copy
it, and paste it into the sign-in screen.

> **Note on `npm install`:** Electron's `postinstall` downloads the platform
> binary (~100–200 MB). In restricted/sandboxed environments where install
> scripts are blocked, that download won't run and `npm run dev` will fail with
> a missing `Electron Framework.framework`. Re-run the install with scripts
> enabled (or `node node_modules/electron/install.js`) on a normal machine.

### Scripts

| Command                  | What it does                                              |
| ------------------------ | --------------------------------------------------------- |
| `npm run dev`            | Dev with hot reload                                       |
| `npm run build`          | Production build of main/preload/renderer                 |
| `npm run typecheck`      | Type-check node + web projects                            |
| `npm test`               | Run TimerManager concurrency tests                        |
| `npm run check:contrast` | Verify all themes meet WCAG 2.1 AA contrast               |
| `npm run verify`         | typecheck + contrast + tests + build (use before commits) |
| `npm run dist`           | Package installers via electron-builder                   |

### UI preview without Electron / a Toggl account

The renderer degrades to the sign-in screen when the preload bridge is absent.
For a full visual/accessibility preview with realistic data, run a standalone
renderer server and open with `?demo`:

```bash
npx vite --config vite.preview.config.ts   # serves on :5199
# visit http://localhost:5199/?demo          (main window)
# visit http://localhost:5199/mini.html?demo (mini timer)
```

The demo bridge (`src/renderer/src/lib/demoBridge.ts`) is an in-memory stand-in
and is lazy-loaded only when `?demo` is present — it never ships in the Electron app.

## Auth: API token now, OAuth later

This build authenticates with a personal API token (simple and reliable). The
Toggl client (`src/main/toggl/client.ts`) isolates the `Authorization` header,
so adding an OAuth flow later means swapping how that header is produced and
adding a redirect handler in the main process — no changes to the rest of the app.

## Integrations (scaffolded)

The suggestion sources in `src/main/integrations/` implement a common
`SuggestionSource` interface and are wired into the engine, settings toggles and
the UI, but their data-gathering is stubbed for this iteration:

- **IDE window detection** — parse the foreground window title (recommended:
  the `active-win` npm package; macOS needs Accessibility/Screen-Recording
  permission) and extract ticket refs like `PROJ-123` from IntelliJ branch names.
- **Jira** — run a JQL query for issues assigned to / in progress for the user.
- **Google Calendar** — OAuth (read-only Calendar scope) + `events.list` around
  now to offer meetings as entries.

Each is a clean drop-in point: implement the one `read*/fetch*` function marked
`SCAFFOLD` in the source and the rest of the pipeline lights up.
