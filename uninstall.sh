#!/usr/bin/env bash
set -e

PURGE_DATA=false
STOP_CONTAINERS=true

while [[ "$#" -gt 0 ]]; do
    case $1 in
        --purge-data) PURGE_DATA=true ;;
        --no-stop-containers) STOP_CONTAINERS=false ;;
        -h|--help)
            echo "Usage: ./uninstall.sh [OPTIONS]"
            echo "Options:"
            echo "  --purge-data           Also delete the data/ directory (users and shared wiki)"
            echo "  --no-stop-containers   Do not stop running user Docker containers"
            exit 0
            ;;
        *) echo "Unknown parameter passed: $1"; exit 1 ;;
    esac
    shift
done

echo "========================================="
echo "   🗑️ Uninstalling PodarcisNest Service  "
echo "========================================="

# 1. Stop and remove systemd system services
if [ -f /etc/systemd/system/podarcisnest.service ] || [ -f /etc/systemd/system/podarcisnest-slack.service ]; then
    echo "Stopping and disabling systemd system services..."
    if command -v sudo &> /dev/null; then
        sudo systemctl stop podarcisnest podarcisnest-slack 2>/dev/null || true
        sudo systemctl disable podarcisnest podarcisnest-slack 2>/dev/null || true
        sudo rm -f /etc/systemd/system/podarcisnest.service /etc/systemd/system/podarcisnest-slack.service
        sudo systemctl daemon-reload
        sudo systemctl reset-failed 2>/dev/null || true
        echo "✓ Removed systemd system services."
    else
        echo "Please run with root/sudo to remove /etc/systemd/system/podarcisnest.service"
    fi
fi

# 2. Stop and remove systemd user services
USER_SERVICE_DIR="$HOME/.config/systemd/user"
if [ -f "$USER_SERVICE_DIR/podarcisnest.service" ] || [ -f "$USER_SERVICE_DIR/podarcisnest-slack.service" ]; then
    echo "Stopping and disabling systemd user services..."
    systemctl --user stop podarcisnest podarcisnest-slack 2>/dev/null || true
    systemctl --user disable podarcisnest podarcisnest-slack 2>/dev/null || true
    rm -f "$USER_SERVICE_DIR/podarcisnest.service" "$USER_SERVICE_DIR/podarcisnest-slack.service"
    systemctl --user daemon-reload
    systemctl --user reset-failed 2>/dev/null || true
    echo "✓ Removed systemd user services."
fi

# 3. Stop running user Docker containers
if [ "$STOP_CONTAINERS" = true ] && command -v docker &> /dev/null; then
    echo "Stopping running PodarcisNest user containers..."
    CONTAINERS=$(docker ps -q --filter "label=podarcisnest.user" 2>/dev/null || true)
    if [ -n "$CONTAINERS" ]; then
        docker stop $CONTAINERS >/dev/null 2>&1 || true
        docker rm -f $CONTAINERS >/dev/null 2>&1 || true
        echo "✓ Stopped and removed user containers."
    else
        echo "No running user containers found."
    fi
fi

# 4. Optional: Purge data directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ "$PURGE_DATA" = true ]; then
    echo "Purging data/ directory..."
    rm -rf "$SCRIPT_DIR/data"
    echo "✓ Purged data/ directory."
fi

echo ""
echo "========================================="
echo "   ✓ PodarcisNest Service Uninstalled!   "
echo "========================================="
