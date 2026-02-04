#!/usr/bin/env bash
set -euo pipefail

# --- Configuration ---
export DISPLAY=:1
export HOME="${HOME:-/root}"
export XDG_CONFIG_HOME="${HOME}/.config"
export XDG_CACHE_HOME="${HOME}/.cache"
export XDG_DATA_HOME="${HOME}/.local/share"
export XDG_RUNTIME_DIR="/tmp/runtime-$(id -u)"

RESOLUTION="${OPENCLAW_DESKTOP_RESOLUTION:-1920x1080x24}"
VNC_PORT="${OPENCLAW_BROWSER_VNC_PORT:-5900}"
NOVNC_PORT="${OPENCLAW_BROWSER_NOVNC_PORT:-6080}"
ENABLE_NOVNC="${OPENCLAW_BROWSER_ENABLE_NOVNC:-1}"
START_GATEWAY="${OPENCLAW_START_GATEWAY:-1}"

# Create all required directories
mkdir -p "${XDG_CONFIG_HOME}" "${XDG_CACHE_HOME}" "${XDG_DATA_HOME}" "${XDG_RUNTIME_DIR}"
mkdir -p "${XDG_CONFIG_HOME}/xfce4" "${XDG_CONFIG_HOME}/dconf"
mkdir -p "${HOME}/.local/share/xfce4"
chmod 700 "${XDG_RUNTIME_DIR}"

# --- Cleanup on exit ---
cleanup() {
  echo "Shutting down desktop environment..."
  kill $(jobs -p) 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT

# --- Start Xvfb ---
echo "Starting Xvfb (${RESOLUTION})..."
Xvfb :1 -screen 0 "${RESOLUTION}" -ac -nolisten tcp +extension GLX &
XVFB_PID=$!
sleep 2

if ! kill -0 $XVFB_PID 2>/dev/null; then
  echo "ERROR: Xvfb failed to start"
  exit 1
fi
echo "Xvfb started (PID: $XVFB_PID)"

# --- Start D-Bus session ---
echo "Starting D-Bus session..."
eval "$(dbus-launch --sh-syntax)"
export DBUS_SESSION_BUS_ADDRESS
export DBUS_SESSION_BUS_PID
echo "D-Bus started (PID: $DBUS_SESSION_BUS_PID)"

# --- Start xfconf daemon ---
echo "Starting xfconfd..."
/usr/lib/x86_64-linux-gnu/xfce4/xfconf/xfconfd &
sleep 1

# --- Start XFCE4 desktop components ---
echo "Starting XFCE4 desktop..."

# Start window manager
xfwm4 --display=:1 --compositor=off &
XFWM4_PID=$!
sleep 2

if kill -0 $XFWM4_PID 2>/dev/null; then
  echo "xfwm4 started (PID: $XFWM4_PID)"
else
  echo "WARNING: xfwm4 not running, continuing anyway..."
fi

# Start desktop background
xfdesktop --display=:1 &
sleep 1

# Start panel
xfce4-panel --display=:1 &
sleep 2

echo "XFCE4 components started"

# --- Start VNC server ---
echo "Starting VNC on port ${VNC_PORT}..."
x11vnc -display :1 -rfbport "${VNC_PORT}" -shared -forever -nopw -xkb &
VNC_PID=$!
sleep 1

# --- Start noVNC ---
if [[ "${ENABLE_NOVNC}" == "1" ]]; then
  echo "Starting noVNC on port ${NOVNC_PORT}..."
  websockify --web /usr/share/novnc/ "${NOVNC_PORT}" "localhost:${VNC_PORT}" &
  NOVNC_PID=$!
fi

# --- Start OpenClaw gateway (optional) ---
if [[ "${START_GATEWAY}" == "1" ]]; then
  echo "Starting OpenClaw gateway..."
  cd /app
  node dist/index.js gateway run \
    --bind "${OPENCLAW_GATEWAY_BIND:-lan}" \
    --port "${OPENCLAW_GATEWAY_PORT:-18789}" \
    --force &
  GATEWAY_PID=$!
  echo "Gateway started (PID: $GATEWAY_PID)"
fi

# --- Print access info ---
echo ""
echo "============================================"
echo "  OpenClaw Desktop Environment Ready"
echo "============================================"
echo "  noVNC:   http://localhost:${NOVNC_PORT}/vnc.html"
echo "  VNC:     localhost:${VNC_PORT}"
if [[ "${START_GATEWAY}" == "1" ]]; then
  echo "  Gateway: http://localhost:${OPENCLAW_GATEWAY_PORT:-18789}"
fi
echo "  Resolution: ${RESOLUTION%x*}"
echo ""
echo "  Host files (read-only):  /host-root/..."
echo "  Project (read-write):    /project/..."
echo "============================================"
echo ""

# --- Keep alive: wait for Xvfb ---
wait $XVFB_PID
