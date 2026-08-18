#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT=8080
INSTALL_SYSTEMD=true
USER_SERVICE=false
BUILD_DOCKER=true
INSTALL_SLACK=false

# Parse arguments
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --port) PORT="$2"; shift ;;
        --no-systemd) INSTALL_SYSTEMD=false ;;
        --user-service) USER_SERVICE=true ;;
        --no-docker) BUILD_DOCKER=false ;;
        --with-slack|--slack) INSTALL_SLACK=true ;;
        --without-slack|--no-slack) INSTALL_SLACK=false ;;
        -h|--help)
            echo "Usage: ./setup.sh [OPTIONS]"
            echo "Options:"
            echo "  --port <port>         Set web listening port (default: 8080)"
            echo "  --no-systemd          Skip systemd service installation"
            echo "  --user-service        Install as systemd user service instead of system service"
            echo "  --no-docker           Skip Docker user image build"
            echo "  --with-slack          Activate Slack integration (installs slack-bolt & sets up slack service)"
            echo "  --without-slack       Deactivate / skip Slack integration (default)"
            exit 0
            ;;
        *) echo "Unknown parameter passed: $1"; exit 1 ;;
    esac
    shift
done

echo "========================================="
echo "   🦎 Installing PodarcisNest Server     "
echo "========================================="

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 is required."
    exit 1
fi

# Set up virtual environment
if [ ! -d "$SCRIPT_DIR/.venv" ]; then
    echo "Creating virtual environment in $SCRIPT_DIR/.venv..."
    python3 -m venv "$SCRIPT_DIR/.venv"
fi

echo "Installing core dependencies..."
"$SCRIPT_DIR/.venv/bin/pip" install --upgrade pip

if [ "$INSTALL_SLACK" = true ]; then
    echo "Activating Slack integration dependencies..."
    "$SCRIPT_DIR/.venv/bin/pip" install -e "$SCRIPT_DIR[slack]"
else
    echo "Installing core server dependencies (Slack disabled by default)..."
    "$SCRIPT_DIR/.venv/bin/pip" install -e "$SCRIPT_DIR"
fi

# Create data directories
mkdir -p "$SCRIPT_DIR/data/users"
mkdir -p "$SCRIPT_DIR/data/shared/wiki"
mkdir -p "$SCRIPT_DIR/data/shared/sources"
mkdir -p "$SCRIPT_DIR/data/logs"

# Build Docker user image
if [ "$BUILD_DOCKER" = true ]; then
    if command -v docker &> /dev/null; then
        echo "Building / verifying Docker user image (podarcisnest-user:latest)..."
        docker build -t podarcisnest-user:latest "$SCRIPT_DIR"
    else
        echo "Warning: Docker is not installed or not in PATH. Skipping image build."
    fi
fi

# Detect Operating System & Init system
OS="$(uname -s)"
HAS_SYSTEMCTL=false
if command -v systemctl &> /dev/null; then
    HAS_SYSTEMCTL=true
fi

if [ "$INSTALL_SYSTEMD" = true ]; then
    if [ "$OS" != "Linux" ] || [ "$HAS_SYSTEMCTL" = false ]; then
        echo "Note: systemd is only available on Linux with systemctl. Skipping systemd service installation on $OS."
        INSTALL_SYSTEMD=false
    fi
fi

if [ "$INSTALL_SYSTEMD" = true ]; then
    echo "Configuring systemd server service..."
    CURRENT_USER="$(whoami)"
    PYTHON_BIN="$SCRIPT_DIR/.venv/bin/python"

    SERVICE_CONTENT=$(sed \
        -e "s|{{USER}}|$CURRENT_USER|g" \
        -e "s|{{INSTALL_DIR}}|$SCRIPT_DIR|g" \
        -e "s|{{PYTHON_BIN}}|$PYTHON_BIN|g" \
        -e "s|{{PORT}}|$PORT|g" \
        "$SCRIPT_DIR/podarcisnest.service.template")

    if [ "$USER_SERVICE" = true ]; then
        SERVICE_DIR="$HOME/.config/systemd/user"
        mkdir -p "$SERVICE_DIR"
        echo "$SERVICE_CONTENT" > "$SERVICE_DIR/podarcisnest.service"
        systemctl --user daemon-reload
        systemctl --user enable podarcisnest
        systemctl --user restart podarcisnest
        echo "✓ Enabled and started systemd user service (podarcisnest.service)."

        if [ "$INSTALL_SLACK" = true ]; then
            SLACK_SERVICE_CONTENT=$(sed \
                -e "s|{{USER}}|$CURRENT_USER|g" \
                -e "s|{{INSTALL_DIR}}|$SCRIPT_DIR|g" \
                -e "s|{{PYTHON_BIN}}|$PYTHON_BIN|g" \
                "$SCRIPT_DIR/podarcisnest-slack.service.template")
            echo "$SLACK_SERVICE_CONTENT" > "$SERVICE_DIR/podarcisnest-slack.service"
            systemctl --user daemon-reload
            systemctl --user enable podarcisnest-slack
            echo "✓ Configured and enabled Slack user daemon (podarcisnest-slack.service)."
            echo "  (Configure tokens via 'podarcisnest slack config' then start via 'systemctl --user start podarcisnest-slack')"
        fi
    else
        TMP_SERVICE="/tmp/podarcisnest.service"
        echo "$SERVICE_CONTENT" > "$TMP_SERVICE"
        if command -v sudo &> /dev/null; then
            sudo cp "$TMP_SERVICE" /etc/systemd/system/podarcisnest.service
            sudo systemctl daemon-reload
            sudo systemctl enable podarcisnest
            sudo systemctl restart podarcisnest
            echo "✓ Enabled and started systemd service (podarcisnest.service)."

            if [ "$INSTALL_SLACK" = true ]; then
                SLACK_SERVICE_CONTENT=$(sed \
                    -e "s|{{USER}}|$CURRENT_USER|g" \
                    -e "s|{{INSTALL_DIR}}|$SCRIPT_DIR|g" \
                    -e "s|{{PYTHON_BIN}}|$PYTHON_BIN|g" \
                    "$SCRIPT_DIR/podarcisnest-slack.service.template")
                TMP_SLACK="/tmp/podarcisnest-slack.service"
                echo "$SLACK_SERVICE_CONTENT" > "$TMP_SLACK"
                sudo cp "$TMP_SLACK" /etc/systemd/system/podarcisnest-slack.service
                sudo systemctl daemon-reload
                sudo systemctl enable podarcisnest-slack
                echo "✓ Configured and enabled Slack daemon (podarcisnest-slack.service)."
                echo "  (Configure tokens via 'podarcisnest slack config' then start via 'sudo systemctl start podarcisnest-slack')"
            fi
        else
            echo "Warning: sudo not found. Please copy $TMP_SERVICE to /etc/systemd/system/podarcisnest.service manually."
        fi
    fi
fi

echo ""
echo "========================================="
echo "   ✓ PodarcisNest Setup Complete!        "
echo "========================================="
echo "Web Portal: http://localhost:$PORT/login"
echo "Default Admin Credentials:"
echo "  Username: admin"
echo "  Password: admin"
echo ""
echo "Slack Integration Status:"
if [ "$INSTALL_SLACK" = true ]; then
    echo "  Status: ACTIVATED"
    echo "  Next steps: Configure tokens with '$SCRIPT_DIR/.venv/bin/podarcisnest slack config'"
else
    echo "  Status: DEACTIVATED (Default)"
    echo "  To activate later: Run './setup.sh --with-slack' or 'pip install -e .[slack]'"
fi
echo ""
echo "Debug CLI commands:"
echo "  $SCRIPT_DIR/.venv/bin/podarcisnest status"
echo "  $SCRIPT_DIR/.venv/bin/podarcisnest user list"
echo "  $SCRIPT_DIR/.venv/bin/podarcisnest slack status"
echo "========================================="
