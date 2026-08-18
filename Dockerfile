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
    && rm -rf /var/lib/apt/lists/*

# Install uv package manager
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ENV PIP_BREAK_SYSTEM_PACKAGES=1

# Install Podarcis & MCP dependencies into system Python
RUN uv pip install --system --break-system-packages --no-cache \
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
RUN uv pip install --system --break-system-packages --no-cache \
    "git+https://github.com/XicuM/Podarcis.git@${PODARCIS_REF}" || \
    pip3 install --break-system-packages --no-cache-dir "git+https://github.com/XicuM/Podarcis.git@${PODARCIS_REF}" || true

# Ensure workspace and code-server directories exist
RUN mkdir -p /home/coder/workspace && \
    chown -R coder:coder /home/coder

USER coder
WORKDIR /home/coder/workspace

# Install popular extensions for VS Code Web (Python, Markdown, etc.)
RUN code-server --install-extension ms-python.python || true
RUN code-server --install-extension yzhang.markdown-all-in-one || true
RUN code-server --install-extension bierner.markdown-preview-github-styles || true
RUN code-server --install-extension houkanshan.vscode-markdown-footnote || true

EXPOSE 8000

# Start code-server without password auth (auth is handled by PodarcisNest dynamic router)
CMD ["code-server", "--bind-addr", "0.0.0.0:8000", "--auth", "none", "/home/coder/workspace"]
