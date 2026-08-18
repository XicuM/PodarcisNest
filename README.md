# 🦎 PodarcisNest — Team Research Habitat & Server

| | |
| --- | --- |
| <br>⠀⠀⠀⠀⠀⠀⠀⠀⠠⣽⣆⡄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀<br>⠀⠀⠀⣤⣤⣤⣤⣄⡚⠻⣿⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀<br>⠀⠀⠀⣿⣿⣿⣿⣿⣿ ⣸⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀<br>⠀⢀⡀⠸⢿⣿⣿⣿⣿⣶⣿⠃⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀<br>⠐⠲⣿⣼⠂ ⣿⣿⣿⣿⣿⣆⠀⢀⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀<br> ⠈⠙⠻⣶⣼⣿⢿⣿⣿⣿⣿⡆⠙⢿⣦⣄⣀⠀⠀⠀⠀⠀⠀⠀⠀<br>⠀⠀⠀⠀⠀⠉⠁⢸⣿⣿⣿⣿⣿⠀⣀⣄⠉⠙⠛⠿⢷⣦⣀⠀⠀⠀<br>⠀⠀⠀⠀⢀⠰⣶⣶⣿⣿⣿⣿⣿⣿⣿⣿⡀⣠⠄⠀⠀⠈⠻⣿⡆⠀<br>⠀⠀⠠⠶⢮⣷⣿⡋⠋⠉⢹⣿⣿⠉⠀⠻⣷⣿⣿⡉⠓⠀⠀⢹⣿⠀<br>⠀⠀⠀⠋⠹⠉⠙⠁⠀⠀⠈⣿⣿⡇⠀⠀⠈⠉⠆⠁⠀⠀⠀⢸⣿⠇<br>⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘⢿⣿⣄⠀⠀⠀⠀⠀⠀⠀⢀⣾⣿⠁<br>⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠻⣿⣦⣄⡀⡀⢀⣠⣴⣿⣿⠃⠀<br>⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠛⠿⠿⣿⣿⠿⠿⠋⠁⠀⠀<br> | **PodarcisNest** 🦎<br> *Multi-User Research Habitat & Server Infrastructure* <br><br>Installation:<br>```git clone https://github.com/XicuM/PodarcisNest.git```<br>```cd PodarcisNest```<br>```./setup.sh```<br> |

**PodarcisNest** is the multi-user research habitat, dynamic reverse proxy, and container orchestrator for the **Podarcis** research ecosystem.

It provides teams with:
* **Isolated User Workspaces**: Spawns and manages dedicated Docker containers for each researcher with VS Code Web (`code-server`), Python, and agent runtimes.
* **Dynamic Ingress Routing**: Starlette-based session router that proxies authenticated users directly to their isolated container workspace over HTTP and WebSockets.
* **Shared OKF Knowledge Mounts**: Mounts the centralized Open Knowledge Format (OKF v0.2) `wiki/` and `sources/` repositories directly into researcher containers.
* **Admin Web Dashboard & Debug CLI**: Web portal and rich CLI (`podarcisnest`) for provisioning users, container lifecycles, and monitoring.
* **Optional Systemd Integration**: Automated background daemon on Linux with automatic restarts and logging.

---

## 🦎 Podarcis Ecosystem

* **[Podarcis](https://github.com/XicuM/Podarcis)**: The core research engine, FastMCP gateway (`podarcis-mcp`), and autonomous multi-agent pipeline (`@researcher`, `@synthesizer`, `@protocol-architect`, `@auditor`).
* **[PodarcisNest](https://github.com/XicuM/PodarcisNest)** (This Repo): The multi-user server infrastructure, reverse proxy, container workspace manager, and Slack research agent.

---

## 📋 Prerequisites

* **Python**: `3.10` or newer
* **Docker**: Docker Engine / Docker Desktop running locally

---

## 🚀 Quick Start

### 1. Installation

Clone the repository and run the setup script:

```bash
chmod +x setup.sh
./setup.sh
```

> **Note on OS Compatibility**:
> * **Linux (systemd)**: Automatically configures and starts the `podarcisnest` system service.
> * **macOS / Linux without systemd**: Automatically skips service registration and prepares the environment for direct execution.
> * **Windows (WSL2 / Git Bash)**: Fully supported with `./setup.sh`.
> * **Windows (PowerShell)**: Run `python -m venv .venv`, `.venv\Scripts\pip install -e .`, and `docker build -t podarcisnest-user:latest .`.

#### Custom Installation Flags:
* `--port <port>`: Specify web interface listening port (default: `8080`).
* `--no-systemd`: Skip systemd daemon registration (useful for development or Docker-in-Docker).
* `--user-service`: Install as a user-level daemon (`systemctl --user`) instead of system-wide.
* `--no-docker`: Skip automatic `podarcisnest-user:latest` Docker image build during setup.

---

### 2. Accessing the Web Portal

Once started (via systemd or `podarcisnest run`), navigate to:

👉 **`http://localhost:8080/login`**

* **Default Admin Username**: `admin`
* **Default Admin Password**: `admin`

Logging in as `admin` redirects to the **Admin Dashboard** (`/admin`), where you can create users, launch workspaces, and manage active sessions.

---

## 🛠 Administration & Debug CLI

Activate the virtual environment or run via `.venv/bin/podarcisnest`:

```bash
# Activate virtual environment
source .venv/bin/activate
```

### System Status
```bash
# Check service status, active users, and container port bindings
podarcisnest status
```

### Server Execution
```bash
# Run server in the foreground with auto-reload (debug mode)
podarcisnest run --port 8080 --reload
```

### User & Container Management
```bash
# List all registered users and workspaces
podarcisnest user list

# Create a user (and optionally start their container immediately)
podarcisnest user add alice --password mysecret
podarcisnest user add bob --password mysecret --run

# Container Lifecycle Control
podarcisnest user start alice       # Start user workspace container
podarcisnest user stop alice        # Stop user workspace container
podarcisnest user restart alice     # Restart user workspace container
podarcisnest user start-all         # Start all registered user containers
podarcisnest user stop-all          # Stop all user containers

# Account Maintenance
podarcisnest user password alice newpassword  # Reset password
podarcisnest user seed alice                  # Seed or re-sync Podarcis .agents and wiki layout
podarcisnest user delete alice                # Delete user and wipe workspace

# Template Asset Synchronization
podarcisnest sync-templates                   # Fetch/pull latest Podarcis master branch templates
```

### 🤖 Slack Research Agent (`@podarcis`)

PodarcisNest includes a built-in Slack agent operating in **Socket Mode** with scoped access to your shared research repository (`data/shared/`).

```bash
# Check Slack configuration and knowledge base status
podarcisnest slack status

# Configure with OpenCode (default) or OpenAI-compatible server
podarcisnest slack config \
  --bot-token "xoxb-..." \
  --app-token "xapp-..." \
  --provider opencode \
  --base-url "http://localhost:8000/v1" \
  --model "opencode"

# (Optional: Anthropic or OpenAI cloud providers also supported)
# podarcisnest slack config --provider anthropic --api-key sk-ant-...

# Test knowledge retrieval locally from terminal
podarcisnest slack query "Summarize recent notes from the past 7 days"

# Start Slack listener in foreground
podarcisnest slack start
```

> **Privacy Sandbox**: The Slack bot is strictly limited to `data/shared/wiki/` and `data/shared/sources/`. It cannot access individual user workspaces (`data/users/`).

### Linux Service Management (systemd)
```bash
podarcisnest service status
podarcisnest service restart
podarcisnest service stop
```

---

## 📂 Directory Layout

```
PodarcisNest/
├── data/
│   ├── shared/
│   │   ├── wiki/          <── Centralized OKF notes (mounted at /home/coder/workspace/shared/wiki)
│   │   └── sources/       <── Shared research datasets & source materials
│   └── users/
│       ├── users.json     <── User registry and credential hashes
│       └── <username>/
│           └── workspace/ <── Isolated user Podarcis instance (mounted at /home/coder/workspace)
│               ├── .agents/       <── Subagents (researcher, synthesizer, protocol-architect, auditor) & MCPs
│               ├── .mcp.json      <── Model Context Protocol config for VS Code AI agents
│               ├── AGENTS.md      <── Multi-agent rules of engagement & prompt instructions
│               ├── wiki/          <── Dedicated user research wiki in OKF v0.2 format
│               ├── sources/       <── Raw papers & staging ingestion queue (state.json)
│               └── workspace/     <── User profile (profile.md) & personalized protocols
├── podarcisnest/
│   ├── cli.py             <── Operator CLI
│   └── server/
│       ├── app.py         <── Starlette reverse proxy, auth & WebSocket router
│       ├── seeder.py      <── Podarcis wiki & .agents workspace seeder
│       ├── user_manager.py<── Container orchestration & port allocation
│       └── templates/     <── Web UI (login, admin dashboard)
├── Dockerfile             <── Base image with code-server, Python, uv, & Podarcis runtime
└── setup.sh               <── Cross-platform automated setup script
```

---

## 🏗 Architecture Overview

```
Browser (User) ──> PodarcisNest Ingress Router (:8080) ──> Authenticates & Proxies
                                                                 │
                ┌───────────────────────────────────────────────┴───────────────────────────────────────────────┐
                ▼                                                                                               ▼
Container: `podarcisnest-user-alice` (:9003)                                    Container: `podarcisnest-user-bob` (:9004)
- Podarcis Workspace: `data/users/alice/workspace`                              - Podarcis Workspace: `data/users/bob/workspace`
  • `.agents/` (Personas, MCPs, Skills)                                           • `.agents/` (Personas, MCPs, Skills)
  • `wiki/` (Personal OKF Research Wiki)                                          • `wiki/` (Personal OKF Research Wiki)
  • `sources/` (Literature Queue)                                                 • `sources/` (Literature Queue)
- Shared Knowledge Mount: `data/shared/` ──> `/home/coder/workspace/shared/`    - Shared Knowledge Mount: `data/shared/` ──> `/home/coder/workspace/shared/`
- Runtime: VS Code Web + Python + Podarcis CLI + MCP Servers                    - Runtime: VS Code Web + Python + Podarcis CLI + MCP Servers
```

---

## 🦎 Salvem ses Sargantanes! (*Podarcis pityusensis*)

> ### 🌿 Salvem ses Sargantanes!
> 
> *PodarcisNest* is named after *Podarcis*, the genus of Mediterranean wall lizards. In particular, the **Ibiza wall lizard** (*Podarcis pityusensis*), endemic to Ibiza and Formentera (*ses sargantanes*), is facing critical threats of extinction due to invasive alien snake species.
> 
> Support active conservation, educational, and habitat protection initiatives:
> 
> 👉 **[Protegim ses Sargantanes — Learn & Support Conservation Efforts](https://protegimsessargantanes.org/en/home-english/)**

