# 🦎 PodarcisNest — Multi-User LLM Wiki Server Infrastructure (TypeScript)

| | |
| --- | --- |
| <br>⠀⠀⠀⠀⠀⠀⠀⠀⠠⣽⣆⡄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀<br>⠀⠀⠀⣤⣤⣤⣤⣄⡚⠻⣿⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀<br>⠀⠀⠀⣿⣿⣿⣿⣿⣿ ⣸⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀<br>⠀⢀⡀⠸⢿⣿⣿⣿⣿⣶⣿⠃⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀<br>⠐⠲⣿⣼⠂ ⣿⣿⣿⣿⣿⣆⠀⢀⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀<br> ⠈⠙⠻⣶⣼⣿⢿⣿⣿⣿⣿⡆⠙⢿⣦⣄⣀⠀⠀⠀⠀⠀⠀⠀⠀<br>⠀⠀⠀⠀⠀⠉⠁⢸⣿⣿⣿⣿⣿⠀⣀⣄⠉⠙⠛⠿⢷⣦⣀⠀⠀⠀<br>⠀⠀⠀⠀⢀⠰⣶⣶⣿⣿⣿⣿⣿⣿⣿⣿⡀⣠⠄⠀⠀⠈⠻⣿⡆⠀<br>⠀⠀⠠⠶⢮⣷⣿⡋⠋⠉⢹⣿⣿⠉⠀⠻⣷⣿⣿⡉⠓⠀⠀⢹⣿⠀<br>⠀⠀⠀⠋⠹⠉⠙⠁⠀⠀⠈⣿⣿⡇⠀⠀⠈⠉⠆⠁⠀⠀⠀⢸⣿⠇<br>⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘⢿⣿⣄⠀⠀⠀⠀⠀⠀⠀⢀⣾⣿⠁<br>⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠻⣿⣦⣄⡀⡀⢀⣠⣴⣿⣿⠃⠀<br>⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠛⠿⠿⣿⣿⠿⠿⠋⠁⠀⠀<br> | **PodarcisNest** 🦎<br> *Multi-User LLM Wiki Server Infrastructure* <br><br>Installation:<br>```git clone https://github.com/XicuM/PodarcisNest.git```<br>```cd PodarcisNest```<br>```./setup.sh```<br> |

**PodarcisNest** is the Multi-User LLM Wiki Server Infrastructure for the **Podarcis** research ecosystem, engineered in **TypeScript / Node.js**.

It provides teams with:
* **Isolated User Workspaces**: Spawns and manages dedicated Docker containers for each researcher with VS Code Web (`code-server`), Python, and agent runtimes.
* **Dynamic Ingress Routing**: Fastify-based session router and HTTP/WebSocket reverse proxy that streams authenticated users directly into their container workspace.
* **Shared OKF Knowledge Mounts**: Mounts the centralized Open Knowledge Format (OKF v0.2) `wiki/` and `sources/` repositories directly into researcher containers.
* **Admin Web Dashboard & Debug CLI**: Web portal and operator CLI (`podarcisnest`) for provisioning users, container lifecycles, and monitoring.
* **Slack Research Agent (`@podarcis`)**: First-party `@slack/bolt` Socket Mode agent for querying team knowledge and staging papers.
* **Optional Systemd Integration**: Automated background daemon on Linux with automatic restarts and logging.

---

## 🦎 Podarcis Ecosystem

* **[Podarcis](https://github.com/XicuM/Podarcis)**: The core research engine, FastMCP gateway (`podarcis-mcp`), and autonomous multi-agent pipeline (`@researcher`, `@synthesizer`, `@protocol-architect`, `@auditor`).
* **[PodarcisNest](https://github.com/XicuM/PodarcisNest)** (This Repo): The multi-user server infrastructure, reverse proxy, container workspace manager, and Slack research agent.

---

## 📋 Prerequisites

* **Node.js**: `20.x` LTS or newer (`pnpm` or `npm`)
* **Docker**: Docker Engine / Docker Desktop running locally

---

## 🚀 Quick Start

### 1. Installation

Clone the repository and run the setup script:

```bash
chmod +x setup.sh
./setup.sh
```

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

Run via `podarcisnest` (if installed globally) or `./bin/podarcisnest.js`:

```bash
# Check service status, active users, and container port bindings
./bin/podarcisnest.js status

# Run server in the foreground with auto-reload (debug mode)
./bin/podarcisnest.js run --port 8080

# List all registered users and workspaces
./bin/podarcisnest.js user list

# Create a user (and optionally start their container immediately)
./bin/podarcisnest.js user add alice --password mysecret
./bin/podarcisnest.js user add bob --password mysecret --run

# Container Lifecycle Control
./bin/podarcisnest.js user start alice       # Start user workspace container
./bin/podarcisnest.js user stop alice        # Stop user workspace container
./bin/podarcisnest.js user restart alice     # Restart user workspace container
./bin/podarcisnest.js user start-all         # Start all registered user containers
./bin/podarcisnest.js user stop-all          # Stop all user containers

# Account Maintenance
./bin/podarcisnest.js user password alice newpassword  # Reset password
./bin/podarcisnest.js user seed alice                  # Seed or re-sync Podarcis .agents and wiki layout
./bin/podarcisnest.js user delete alice                # Delete user and wipe workspace

# Template Asset Synchronization
./bin/podarcisnest.js sync-templates                   # Fetch/pull latest Podarcis master branch templates
```

### 🤖 Slack Research Agent (`@podarcis`)

```bash
# 1. Check Slack configuration and knowledge base status
./bin/podarcisnest.js slack status

# 2. Configure with OpenCode, OpenAI, or Anthropic
./bin/podarcisnest.js slack config \
  --bot-token "xoxb-..." \
  --app-token "xapp-..." \
  --provider opencode \
  --base-url "http://localhost:8000/v1" \
  --model "opencode"

# 3. Test knowledge retrieval locally from terminal
./bin/podarcisnest.js slack query "Summarize recent notes from the past 7 days"

# 4. Run Slack listener in foreground (Socket Mode)
./bin/podarcisnest.js slack start
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
├── src/
│   ├── index.ts           <── Main TypeScript module exports
│   ├── types.ts           <── Shared types & schema definitions
│   ├── cli/
│   │   └── index.ts       <── Commander operator CLI
│   ├── server/
│   │   ├── app.ts         <── Fastify reverse proxy & WebSocket router
│   │   ├── user-manager.ts<── Container orchestration & port allocation
│   │   ├── seeder.ts      <── Podarcis wiki & .agents workspace seeder
│   │   └── templates/     <── Eta web templates (login.eta, admin.eta)
│   └── slack/
│       ├── bot.ts         <── @slack/bolt Socket Mode bot
│       ├── agent.ts       <── Multi-turn research agent & tool executor
│       ├── knowledge.ts   <── Scoped shared wiki knowledge base reader
│       └── config.ts      <── Slack token & LLM configuration
├── bin/
│   └── podarcisnest.js    <── Executable Node CLI launcher
├── Dockerfile             <── Base image with code-server, Python, uv, & Podarcis runtime
├── setup.sh               <── Automated setup script
├── package.json           <── Node.js dependencies & scripts
├── tsconfig.json          <── TypeScript configuration
└── tsup.config.ts         <── Fast ESM bundler configuration
```
