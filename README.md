# Text Editor

A small frameless text editor for Windows, built with Tauri 2 and CodeMirror 6.

## Download

**[Windows installer (v0.1.12)](https://text-editor-download.apps.grok.bot/Text-Editor_0.1.12_x64-setup.exe)** — `Text-Editor_0.1.12_x64-setup.exe` (~2.89&nbsp;MB)

Download page: https://text-editor-download.apps.grok.bot.

SHA-256: `b3ab8527e4e2666640f798b644cbc9a944b2f1c7ceb38315c2decfcf489c2c8b`.

## Develop

Install [Rust 1.85+](https://rustup.rs/) and Node 22, then:

```
npm install
npm run tauri dev
```

Windows 11 includes the WebView2 runtime this app uses. The window is drawn without the native title bar.

## Checks

```
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

## Windows installer

`npm run tauri build -- --bundles nsis` on Windows produces the NSIS setup under `src-tauri/target/release/bundle/nsis/`.

From Linux, cross-build with:

```
npm run tauri build -- --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis
```

Pushing a `v*` tag (or running the **Windows release** workflow) builds on `windows-latest` and attaches the installer to a GitHub Release when this repository is mirrored to GitHub.

Updater: `@tauri-apps/plugin-updater` + `@tauri-apps/plugin-process` (run `npm install` after pull). Signing: `releases/UPDATER.md`.
