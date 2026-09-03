# PodarcisNest Extensions

This directory holds VSIX files baked into the `podarcisnest-user:latest` Docker image.

- `herdr-companion-0.3.0.vsix` — Herdr Companion VS Code extension (status bar, switcher, focus-on-blocked)
  Source: `~/Projects/herdr-companion` (publisher `xicu`, package `herdr-companion`, displayName `Herdr Companion`)

(The legacy Herdr Agent Panel lateral webview was removed — unused. Only Companion ships.)

The `herdr` CLI binary itself (required by the Companion extension: `herdr` in a terminal,
or `curl -fsSL https://herdr.dev/install.sh | sh`) is installed system-wide into the image
via `HERDR_INSTALL_DIR=/usr/local/bin` (Dockerfile), alongside `opencode` (`npm install -g opencode-ai`).

## How autoinstall works

1. **Build-time (Dockerfile)**
   - `COPY extensions/ /tmp/herdr-extensions/` + `RUN code-server --install-extension /tmp/herdr-extensions/*.vsix`
   - Fallback to `code-server --install-extension xicu.herdr-companion` (Open VSX, legacy `xicu.herdr-vscode` fallback) if no vsix baked.

2. **Runtime (src/server/user-manager.ts:385)**
    - `startUserContainer()` mounts host vsix if found:
      - `./extensions/herdr-companion-0.3.0.vsix` (repo) or `~/Projects/herdr-companion/herdr-companion-0.3.0.vsix` (dev), legacy `herdr-vscode` / `0.2.0` paths checked as fallback
     - Container startup wraps `code-server` with `bash -c "code-server --install-extension /tmp/herdr-companion.vsix || true; exec code-server ..."`
   - Also migrates `.vscode/extensions.json` and `.podarcis/templates/vscode/extensions.json` to include `xicu.herdr-companion` (replacing legacy `xicu.herdr-vscode`) (src/server/seeder.ts:109).

3. **Future users**
   - New containers automatically get the extension on first `docker run` after image rebuild.
   - Existing users are migrated on next `seedUserWorkspace()` call (user create, `syncAllUserClineSettings()`, or manual restart).

To update: rebuild extension (`npm run package` in `~/Projects/herdr-companion`), copy vsix here as `herdr-companion-0.3.0.vsix`, then `docker build -t podarcisnest-user:latest .` and `podarcisnest user restart <user>`.
