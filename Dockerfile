# Dockerfile for PodarcisNest User Container (VS Code Web / code-server + Python + Agent Runtimes)
FROM codercom/code-server:latest

USER root

# Install system dependencies & build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    python3-dev \
    python-is-python3 \
    curl \
    git \
    build-essential \
    ripgrep \
    ca-certificates \
    gnupg \
    tar \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20.x (provides npm for opencode; codercom/code-server bundles node but not on PATH)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    node --version && npm --version && \
    rm -rf /var/lib/apt/lists/*

# Install uv package manager
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Create a clean virtual environment and put it in PATH
ENV VIRTUAL_ENV=/opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN uv venv /opt/venv

# Install Podarcis & MCP dependencies into the virtual environment
RUN uv pip install --no-cache \
    "mcp[cli]>=1.0.0,<2.0.0" \
    "rich>=13.7.0" \
    "questionary" \
    "python-dotenv>=1.0.0" \
    "pytest" \
    "pyyaml>=6.0" \
    "yfinance" \
    "markitdown" \
    "scipy" \
    "httpx>=0.27.0" \
    "websockets>=12.0" \
    "starlette>=0.37.0"

ARG PODARCIS_REF=master

# Install podarcis CLI package from authoritative repository
RUN uv pip install --no-cache "git+https://github.com/XicuM/Podarcis.git@${PODARCIS_REF}" || true

# Install opencode CLI (https://opencode.ai - npm package opencode-ai, fallback to install script)
RUN npm install -g opencode-ai && opencode --version || \
    (curl -fsSL https://opencode.ai/install | bash && \
     cp /root/.opencode/bin/opencode /usr/local/bin/opencode 2>/dev/null || cp /home/coder/.opencode/bin/opencode /usr/local/bin/opencode 2>/dev/null || true && \
     chmod +x /usr/local/bin/opencode 2>/dev/null || true && \
     opencode --version || /usr/local/bin/opencode --version || /root/.opencode/bin/opencode --version || echo "opencode install completed with fallback")

# Install herdr CLI (https://herdr.dev - terminal workspace manager for AI coding agents,
# required by the Herdr Companion VS Code extension baked below)
RUN curl -fsSL https://herdr.dev/install.sh | HERDR_INSTALL_DIR=/usr/local/bin sh && \
    ln -sf /usr/local/bin/herdr /usr/bin/herdr && \
    herdr --version || echo "WARNING: herdr install failed, continuing without herdr binary"

# Ensure workspace and code-server directories exist
RUN mkdir -p /home/coder/workspace && \
    chown -R coder:coder /home/coder

# Bake canonical Herdr config (custom session settings: sidebar collapsed/hidden,
# mobile_width_threshold=0, allow_nested, tmux-mirrored keys/theme) so every user
# container gets the host's custom settings by default, without host mounts.
# Runtime (user-manager.ts) also mounts/provisions this per user container so
# updates propagate without image rebuild.
COPY config/herdr/config.toml /tmp/podarcis-herdr-config.toml
RUN mkdir -p /home/coder/.config/herdr/sessions/vscode && \
    cp /tmp/podarcis-herdr-config.toml /home/coder/.config/herdr/config.toml && \
    cp /tmp/podarcis-herdr-config.toml /home/coder/.config/herdr/sessions/vscode/config.toml && \
    chown -R coder:coder /home/coder/.config/herdr && \
    rm /tmp/podarcis-herdr-config.toml

USER coder
WORKDIR /home/coder/workspace

# Install popular extensions for VS Code Web (Markdown, graph visualization, etc.)
RUN code-server --install-extension yzhang.markdown-all-in-one || true
RUN code-server --install-extension bierner.markdown-preview-github-styles || true
RUN code-server --install-extension houkanshan.vscode-markdown-footnote || true
RUN code-server --install-extension constellationgraph.constellationgraph || true

USER root
# Copy local Herdr vsix extensions into image if present (build context: ./extensions/)
COPY --chown=coder:coder extensions/ /tmp/herdr-extensions/
USER coder
# Install Herdr Companion extension: prefer local vsix if baked, fallback to Open VSX (xicu.herdr-companion, legacy xicu.herdr-vscode)
RUN if ls /tmp/herdr-extensions/*.vsix 1>/dev/null 2>&1; then for vsix in /tmp/herdr-extensions/*.vsix; do echo "Installing Herdr vsix: $vsix"; code-server --install-extension "$vsix" || true; done; rm -rf /tmp/herdr-extensions || true; else rm -rf /tmp/herdr-extensions || true; fi
RUN code-server --install-extension xicu.herdr-companion || code-server --install-extension xicu.herdr-vscode || true

EXPOSE 8000

# Healthcheck for VS Code Web / code-server process
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://127.0.0.1:8000/ || exit 1

# Start code-server without password auth (auth is handled by PodarcisNest dynamic router)
CMD ["code-server", "--bind-addr", "0.0.0.0:8000", "--auth", "none", "/home/coder/workspace"]
