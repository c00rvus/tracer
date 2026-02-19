# Tracer Desktop

Windows desktop app (Electron + Playwright) to capture Chromium sessions with a DevTools-like timeline.

## MVP status

- Embedded Chromium via Playwright.
- Capture only starts after clicking `Capture`.
- Captures:
  - `console`
  - `network` (request, response, fail, and response bodies when available)
  - `screenshots` (timer + event triggers)
- Stop by `Stop` button or by closing the browser window.
- Local review with timeline, filters, search, detail tabs, and screenshot preview.
- Export/import session packages as `.zip`.

## Commands

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

Windows portable package:

```bash
npm run dist:portable
```

Windows installer package (NSIS):

```bash
npm run dist:installer
```

macOS package (DMG + ZIP):

```bash
npm run dist:mac
```

Build output:

- Portable EXE in `release/`
- Installer EXE in `release/` (for installed users and upgrades)
- macOS DMG/ZIP in `release/` (must be built on macOS)

## Platform split

- `win32`: custom Electron title bar with custom minimize/maximize/close controls.
- `darwin`: native macOS title bar/buttons (`hiddenInset`, traffic lights), no custom title bar in renderer.
- Build targets are split in `electron-builder.yml`:
  - `win`: `portable` + `nsis`
  - `mac`: `dmg` + `zip`

## macOS unsigned build behavior

This project supports unsigned macOS builds for internal testing. Without Apple signing/notarization:

- first open may be blocked by Gatekeeper
- users can open via right-click `Open`
- in stricter environments, users may need to remove quarantine attributes manually

## Installed app upgrade flow (Windows)

If a user already has Tracer installed and you send a new installer file, use:

```bash
npm run update:installed -- "C:\path\to\Tracer-Setup-x.y.z.exe"
```

Or without Node/npm (recommended for end users):

```bat
scripts\update-installed.cmd "C:\path\to\Tracer-Setup-x.y.z.exe"
```

What it does:

1. Detects the current installed Tracer from Windows registry.
2. Reuses the existing install directory.
3. Stops the running app process (and optional service if configured in script params).
4. Uninstalls the old version silently.
5. Installs the new installer in the same location.

Optional arguments forwarded to PowerShell updater:

- `-ProductName "Tracer"` (registry display name prefix)
- `-ProcessName "Tracer"` (process to stop before update)
- `-ServiceName "TracerService"` (optional Windows service to stop)
- `-NoSilent` (run uninstall/install without silent switches)

Script files:

- `scripts/update-installed.ps1`
- `scripts/run-update-installer.cjs`

## Dev troubleshooting

If you see `Electron failed to install correctly` while running `npm run dev`, your shell may have `ELECTRON_RUN_AS_NODE=1`.

The launcher `scripts/dev-electron.cjs` clears this variable automatically.

## Session zip format

- `manifest.json`
- `events.ndjson`
- `screenshots/*.png`
- `network/bodies/*`
- `meta/version.json`
