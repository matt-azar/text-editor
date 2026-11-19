# Text Editor

A small frameless text editor for Windows, built with Tauri 2 and CodeMirror 6.

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

`npm run tauri build` produces an NSIS installer and registers `.txt` and `.md` files.
