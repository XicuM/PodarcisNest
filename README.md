# PodarcisLab 🔬

**PodarcisLab** is the multi-user research portal, dynamic reverse proxy, and container orchestrator for the **Podarcis** research ecosystem.

It provides teams with:
* **Isolated User Containers**: Spawns and manages dedicated Docker containers for each researcher running their AI agent of choice (**Hermes Agent**, **OpenCode**, **OpenClaw**, etc.).
* **Dynamic Ingress Routing**: Starlette-based session router that proxies authenticated users directly to their isolated container workspace.
* **Shared OKF Knowledge Mounts**: Mounts the centralized Open Knowledge Format (OKF v0.2) `wiki/` and `sources/` repositories into user containers.
* **Systemd Service Integration**: Pre-configured systemd daemon with automated restarts, logging, and background management.
* **Maintenance & Debug CLI**: A rich CLI tool (`podarcislab`) for inspecting containers, user provisioning, and foreground debugging.

---

## Quick Start

### 1. Installation

Run the setup script (installs dependencies and configures systemd by default):

```bash
chmod +x setup.sh
./setup.sh
```

#### Custom Installation Flags:
* `--port <port>`: Specify web interface port (default: `8080`).
* `--no-systemd`: Skip systemd daemon registration (useful for Docker-in-Docker or manual dev).
* `--user-service`: Install as a `systemctl --user` daemon rather than system-wide `/etc/systemd/system/`.

---

## 2. Administration & Debug CLI

The `podarcislab` CLI provides operator commands for maintenance and diagnostics:

```bash
# Check service and active user containers
podarcislab status

# Run server in the foreground for debugging
podarcislab run --port 8080 --reload

# User Management
podarcislab user list
podarcislab user add alice --password mysecret
podarcislab user password alice newpassword
podarcislab user delete alice

# Service Lifecycle
podarcislab service restart
podarcislab service status
```

---

## 3. Architecture

```
User (Browser) ──> PodarcisLab (Port 8080) ──> Authenticates & Proxies
                                                      │
               ┌──────────────────────────────────────┴──────────────────────────────────────┐
               ▼                                                                             ▼
Container (User: Alice, Port: 9001)                                           Container (User: Bob, Port: 9002)
- Private Workspace: `data/users/alice/`                                      - Private Workspace: `data/users/bob/`
- Shared Mounts: `data/shared/wiki/` (OKF Notes)                             - Shared Mounts: `data/shared/wiki/` (OKF Notes)
- Agent Engine: Hermes Agent / OpenCode                                       - Agent Engine: Hermes Agent / OpenCode
```
