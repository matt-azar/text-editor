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

Apps check, in order (must be anonymous HTTPS that returns JSON, not an HTML login page):

1. `https://cdn.jsdelivr.net/gh/matt-azar/text-editor@main/download-site/latest.json`
2. `https://raw.githubusercontent.com/matt-azar/text-editor/main/download-site/latest.json`

Keep `download-site/latest.json` on `main` in sync with each cut. Installer `url` inside that file should be a public raw/release URL (grok.bot login gates break Check for Updates).
