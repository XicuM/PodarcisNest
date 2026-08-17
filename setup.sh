#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT=8080
INSTALL_SYSTEMD=true
USER_SERVICE=false

# Parse arguments
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --port) PORT="$2"; shift ;;
        --no-systemd) INSTALL_SYSTEMD=false ;;
        --user-service) USER_SERVICE=true ;;
        -h|--help)
            echo "Usage: ./setup.sh [OPTIONS]"
            echo "Options:"
            echo "  --port <port>         Set web listening port (default: 8080)"
            echo "  --no-systemd          Skip systemd service installation"
            echo "  --user-service        Install as systemd user service instead of system service"
            exit 0
            ;;
        *) echo "Unknown parameter passed: $1"; exit 1 ;;
    esac
    shift
done

echo "========================================="
echo "   🔬 Installing PodarcisLab Server      "
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

echo "Installing dependencies..."
"$SCRIPT_DIR/.venv/bin/pip" install --upgrade pip
"$SCRIPT_DIR/.venv/bin/pip" install -e "$SCRIPT_DIR"

# Create data directories
mkdir -p "$SCRIPT_DIR/data/users"
mkdir -p "$SCRIPT_DIR/data/shared/wiki"
mkdir -p "$SCRIPT_DIR/data/shared/sources"

if [ "$INSTALL_SYSTEMD" = true ]; then
    echo "Configuring systemd service..."
    CURRENT_USER="$(whoami)"
    PYTHON_BIN="$SCRIPT_DIR/.venv/bin/python"

    SERVICE_CONTENT=$(sed \
        -e "s|{{USER}}|$CURRENT_USER|g" \
        -e "s|{{INSTALL_DIR}}|$SCRIPT_DIR|g" \
        -e "s|{{PYTHON_BIN}}|$PYTHON_BIN|g" \
        -e "s|{{PORT}}|$PORT|g" \
        "$SCRIPT_DIR/podarcislab.service.template")

    if [ "$USER_SERVICE" = true ]; then
        SERVICE_DIR="$HOME/.config/systemd/user"
        mkdir -p "$SERVICE_DIR"
        echo "$SERVICE_CONTENT" > "$SERVICE_DIR/podarcislab.service"
        systemctl --user daemon-reload
        systemctl --user enable podarcislab
        systemctl --user restart podarcislab
        echo "✓ Enabled and started systemd user service (podarcislab)."
    else
        TMP_SERVICE="/tmp/podarcislab.service"
        echo "$SERVICE_CONTENT" > "$TMP_SERVICE"
        if command -v sudo &> /dev/null; then
            sudo cp "$TMP_SERVICE" /etc/systemd/system/podarcislab.service
            sudo systemctl daemon-reload
            sudo systemctl enable podarcislab
            sudo systemctl restart podarcislab
            echo "✓ Enabled and started systemd service (podarcislab)."
        else
            echo "Warning: sudo not found. Please copy $TMP_SERVICE to /etc/systemd/system/podarcislab.service manually."
        fi
    fi
fi

echo ""
echo "========================================="
echo "   ✓ PodarcisLab Setup Complete!         "
echo "========================================="
echo "Web Portal: http://localhost:$PORT/login"
echo "Default Admin Credentials:"
echo "  Username: admin"
echo "  Password: admin"
echo ""
echo "Debug CLI commands:"
echo "  $SCRIPT_DIR/.venv/bin/podarcislab status"
echo "  $SCRIPT_DIR/.venv/bin/podarcislab user list"
echo "========================================="
