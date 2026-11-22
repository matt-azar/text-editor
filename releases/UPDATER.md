# Updater signing (Tauri)

After pulling updater changes, install the JS plugins then restart dev:

```
npm install
npm run tauri dev
```

Required packages (already in `package.json` / lockfile): `@tauri-apps/plugin-updater`, `@tauri-apps/plugin-process`. Vite cannot resolve them until `node_modules` is refreshed.

Release builds that produce `.sig` / `latest.json` need the **private** updater key in the environment. The public key is already in `src-tauri/tauri.conf.json`.

## Supply the private key

Set before `tauri build` / NSIS:

```
TAURI_SIGNING_PRIVATE_KEY=<path to key file OR literal key contents>
TAURI_SIGNING_PRIVATE_KEY_PASSWORD=   # empty if the key has no password
```

For GitHub Actions (`windows-release.yml`), add repository secrets:

- `TAURI_SIGNING_PRIVATE_KEY` — private key file contents
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — optional

Do **not** commit the private key. Losing it means existing installs cannot verify new updates (users reinstall from the download page).

## Endpoints

Apps check, in order:

1. `https://github.com/matt-azar/text-editor/releases/latest/download/latest.json` (anonymous HTTPS)
2. `https://text-editor-download.apps.grok.bot/latest.json`

Each release should attach `latest.json` plus the NSIS setup `.exe` and `.sig` so the GitHub URL works.
