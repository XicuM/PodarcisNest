# Dockerfile for PodarcisLab User Container (VS Code Web / code-server + Python + Agent Runtimes)
FROM codercom/code-server:latest

USER root

# Install system dependencies & build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    curl \
    git \
    build-essential \
    ripgrep \
    && rm -rf /var/lib/apt/lists/*

# Install uv package manager
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Ensure workspace and code-server directories exist
RUN mkdir -p /home/coder/workspace && \
    chown -R coder:coder /home/coder

USER coder
WORKDIR /home/coder/workspace

# Install popular extensions for VS Code Web (Python, Markdown, etc.)
RUN code-server --install-extension ms-python.python || true

EXPOSE 8000

# Start code-server without password auth (auth is handled by PodarcisLab dynamic router)
CMD ["code-server", "--bind-addr", "0.0.0.0:8000", "--auth", "none", "/home/coder/workspace"]
