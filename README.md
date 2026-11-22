# Text Editor

A small frameless text editor for Windows, built with Tauri 2 and CodeMirror 6.

## Download

**[Windows installer (v0.1.11)](https://text-editor-download.apps.grok.bot/Text-Editor_0.1.11_x64-setup.exe)** — `Text-Editor_0.1.11_x64-setup.exe` (~1.95&nbsp;MB)

Download page: https://text-editor-download.apps.grok.bot.

SHA-256: `e06a87c8014e944729b33cf796177e4a58110a6e1d40491520c471c6adb0558c`.

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
