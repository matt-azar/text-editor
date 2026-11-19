# Text Editor

A small frameless text editor for Windows, built with Tauri 2 and CodeMirror 6.

## Download

**[Windows installer (v0.1.0)](https://onlyfiles.com/dl/1795056472.bd8a503044a33b28/w0wJwIXtv8NL/text-editor_0.1.0_x64-setup.exe)** — `Text-Editor_0.1.0_x64-setup.exe` (~1.57&nbsp;MB)

Landing page (same file): [onlyfiles.com/w0wJwIXtv8NL](https://onlyfiles.com/w0wJwIXtv8NL/text-editor_0.1.0_x64-setup.exe).

The installer is also stored on tag [`v0.1.0`](https://cursor.com/codebase/matt-azar/text-editor/tree/v0.1.0) under `releases/`, but Origin blob/raw URLs do not serve this ~1.5&nbsp;MB binary (API: file too large; UI 404). Use the OnlyFiles link above. The NSIS setup registers `.txt` and `.md` and will download WebView2 on Windows 10 if needed.

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
