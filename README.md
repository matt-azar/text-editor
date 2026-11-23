# Text Editor

A small frameless text editor for Windows and Linux, built with Tauri 2 and CodeMirror 6.

## Download

**[Windows installer (v0.1.12)](https://text-editor-download.apps.grok.bot/Text-Editor_0.1.12_x64-setup.exe)** — `Text-Editor_0.1.12_x64-setup.exe` (~2.89&nbsp;MB)

Download page: https://text-editor-download.apps.grok.bot.

SHA-256: `b3ab8527e4e2666640f798b644cbc9a944b2f1c7ceb38315c2decfcf489c2c8b`.

Linux AppImage/deb are built by the release workflow (and locally below); they are not on the download site yet.

## Develop

Install [Rust 1.85+](https://rustup.rs/) and Node 22, then:

```
npm install
npm run tauri dev
```

**Windows:** WebView2 (included on Windows 11).

**Linux:** WebKitGTK 4.1 and friends (Debian/Ubuntu):

```
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf
```

The window is drawn without the native title bar.

## Checks

```
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

## Package

- **Windows NSIS:** `npm run tauri:build:windows` → `src-tauri/target/release/bundle/nsis/`
- **Linux AppImage + deb:** `npm run tauri:build:linux` → `src-tauri/target/release/bundle/{appimage,deb}/`

From Linux, cross-build Windows with:

```
npm run tauri build -- --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis
```

Pushing a `v*` tag (or running the **Release** workflow) builds Windows NSIS on `windows-latest` and Linux AppImage/deb on `ubuntu-22.04`, then attaches them to a GitHub Release when this repository is mirrored to GitHub.

Updater: `@tauri-apps/plugin-updater` + `@tauri-apps/plugin-process` (run `npm install` after pull). Signing: `releases/UPDATER.md`.
