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
- **Compact, scalable main window** — no OS title bar: the app's own header is
  the window chrome (it drags, double-clicks to maximize, and draws the caption
  buttons on Windows/Linux; macOS keeps its traffic lights). Below it, a
  single-line timer bar — description, project/task, clock, refresh, edit,
  start/stop — pinned above the one region that scrolls, and entries grouped by
  day with daily totals, one entry per line: description, the task it is booked
  against, times, duration, resume and delete. Roughly a dozen entries fit where
  the old two-line rows fitted one.
- **Projects and tasks** — full Toggl Project → Task hierarchy in a single
  accessible picker, shown as a hierarchy: each project once, its tasks indented
  beneath it under a guide line in the project's colour, so the width goes to
  the task name rather than to the project name repeated on every row. Options
  still carry the whole _Project · Task_ path as their accessible name. In both
  the main window and the mini timer; degrades to projects-only on plans without
  tasks.
- **Rich editing** — every time entry, running or finished, is editable:
  description, project/task, and start/stop times, plus delete. Click an entry
  to open the editor; the running entry's description/project/task update live.
- **Always-on-top mini timer** — one fixed-size line: elapsed time, the same
  description autocomplete as the main window, and start/stop. The field carries
  a tag showing the project's colour and the task it will be booked against, so
  the whole entry is readable at a glance. Picking a suggestion fills in its
  project and task too, and choosing one with Enter starts the timer outright —
  so the single field covers "repeat what I did before" without the panel ever
  changing size. Expand it on the rare occasion you need to set project/task by
  hand. Its dropdowns overlay the desktop rather than growing the panel. Stays
  above other apps and survives display changes / fullscreen apps (see
  _Reliability_).
- **Refresh on demand** — Toggl can be driven from anywhere (web, mobile,
  another device), so both the timer bar and the mini timer carry a refresh
  button that reconciles immediately and reports how fresh the state is. The
  app also reconciles on its own every 30s; the button exists because that
  interval is kept deliberately slow to stay well inside the API rate limit.
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
- **Large targets** — interactive controls in the main window are at least
  44×44px at default scale (`--target-min`), and the entry row is sized by them
  rather than the other way round: density comes out of padding, gaps and type
  size, never out of hit areas. The single-row mini timer is the one documented
  exception (2rem controls, still with a visible focus ring).
- **Visible focus** — a 3px focus ring (contrast-checked) on every focusable
  element for keyboard users; native `<select>`/`<input>`/checkbox elements are
  used so screen-reader and keyboard semantics come for free.
- **Dropdowns dismiss predictably** — every overlay (the project/task picker and
  the description autocomplete, in both windows) closes on Escape, on a pointer
  press outside it, on focus leaving it, and when the window is deactivated.
  Escape is claimed innermost-first, so one press closes one thing: a dropdown
  open inside the entry editor closes the dropdown, not the dialog behind it.
  Keyboard dismissal puts focus back on the control that opened the overlay.
  See `src/renderer/src/lib/useDismiss.ts`.
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

Node **^20.19 || >=22.12** (enforced by `engines`; CI runs 22) — Vite 7 and
electron-vite 5 both require it.

```bash
npm install          # installs deps AND downloads the Electron binary
npm run dev          # launches the app with hot reload
```

> **Note on `allowScripts`:** npm blocks install scripts unless `package.json`
> lists the exact `name@version`, and Electron's binary download *is* an install
> script. Bumping Electron therefore means updating that entry too, or
> `npm run dev` fails with a missing binary — see the note below.

> **Why Vite is pinned to 7, not 8:** `electron-vite@5` declares
> `vite: ^5 || ^6 || ^7`, while `@vitejs/plugin-react@6` requires `vite: ^8`.
> The two cannot both be satisfied, so the compatible ceiling is
> **vite 7 + @vitejs/plugin-react 5 + electron-vite 5**. Everything else is on
> its latest release. Move Vite to 8 only once electron-vite supports it, and
> bump the React plugin in the same commit.

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

## Google Calendar: keeping the connection alive

The Calendar integration stores a long-lived **refresh token** (encrypted via
`safeStorage`) and trades it for short-lived access tokens on demand
(`src/main/integrations/google/`). The app never revokes its own credential — a
"disconnect" the user didn't ask for always means **Google invalidated the
refresh token**. The dominant cause is a Google Cloud misconfiguration, so most
prevention lives in the console, not the code:

- **Publish the OAuth consent screen to _In production_.** While it is in
  _Testing_, Google **expires every refresh token after 7 days**, so the
  connection dies about once a week no matter what the app does. Publishing is
  the single most important fix. (A read-only Calendar app using only the
  `openid`, `email`, and `calendar.events.readonly` scopes generally does not
  require Google verification to run in production.)
- Other Google-side invalidations to be aware of: a refresh token unused for
  **6 months**, the user changing their Google password, the user revoking the
  app at <https://myaccount.google.com/permissions>, or exceeding **50 live
  refresh tokens** for the same client+account (older tokens are silently
  evicted — avoid reconnecting in a loop).

The client is configured PKCE-first with `access_type=offline` and
`prompt=consent` so a genuine refresh token is always issued on (re)consent.

### How the app handles a dead token now

Defense-in-depth so an invalidation degrades gracefully instead of silently:

- **Permanent vs transient errors are distinguished.** A Google `invalid_grant`
  (expired/revoked refresh token) is classified as permanent; network blips,
  timeouts and 5xx are transient (`google/oauth-errors.ts`).
- **Transient refresh failures retry** with a short backoff before the poll
  gives up, so a momentary blip doesn't drop suggestions.
- **A permanent failure self-heals the state**: the dead credential is discarded
  and the connection flips to a `needsReauth` status, which the Settings screen
  surfaces as an explicit **"Reconnect Google Calendar"** prompt — instead of
  forever showing a healthy-looking "Connected" that produces nothing.
- A refresh that resolves after the user has disconnected/reconnected is
  discarded (guarded by a connection epoch), so it can't resurrect a
  disconnected account or clobber a fresh one.
