# Text Editor

A small frameless text editor for Windows, built with Tauri 2 and CodeMirror 6.

## Download

**[Windows installer (v0.1.6)](https://text-editor-download.apps.grok.bot/Text-Editor_0.1.6_x64-setup.exe)** — `Text-Editor_0.1.6_x64-setup.exe` (~1.62&nbsp;MB)

Includes the capital-M app mark (shortcut and window icons), same-line selection polish, current-line highlight toggle, cursor blink/width settings, Ctrl+Shift+W to exit, and Zen Mode (`Ctrl+Shift+Z`) with edge drag. Download page: https://text-editor-download.apps.grok.bot. Origin blob/raw URLs cannot serve this ~1.6&nbsp;MB binary (API: file too large; UI 404). SHA-256: `4ade01606279b1ce12ac37c627f9792fbba497ee1eef640efdc4e54f0e65b46b`. The NSIS setup registers `.txt` and `.md` and will download WebView2 on Windows 10 if needed.

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
