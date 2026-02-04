#!/usr/bin/env bash
set -euo pipefail

export DISPLAY=:1
export HOME=/tmp/openclaw-home
export XDG_CONFIG_HOME="${HOME}/.config"
export XDG_CACHE_HOME="${HOME}/.cache"

CDP_PORT="${OPENCLAW_BROWSER_CDP_PORT:-${CLAWDBOT_BROWSER_CDP_PORT:-9222}}"
VNC_PORT="${OPENCLAW_BROWSER_VNC_PORT:-${CLAWDBOT_BROWSER_VNC_PORT:-5900}}"
NOVNC_PORT="${OPENCLAW_BROWSER_NOVNC_PORT:-${CLAWDBOT_BROWSER_NOVNC_PORT:-6080}}"
ENABLE_NOVNC="${OPENCLAW_BROWSER_ENABLE_NOVNC:-${CLAWDBOT_BROWSER_ENABLE_NOVNC:-1}}"
HEADLESS="${OPENCLAW_BROWSER_HEADLESS:-${CLAWDBOT_BROWSER_HEADLESS:-0}}"

mkdir -p "${HOME}" "${HOME}/.chrome" "${XDG_CONFIG_HOME}" "${XDG_CACHE_HOME}"

echo "Starting Xvfb..."
Xvfb :1 -screen 0 1280x800x24 -ac -nolisten tcp &
XVFB_PID=$!
sleep 2

# Verify Xvfb started
if ! kill -0 $XVFB_PID 2>/dev/null; then
  echo "ERROR: Xvfb failed to start"
  exit 1
fi
echo "Xvfb started (PID: $XVFB_PID)"

if [[ "${HEADLESS}" == "1" ]]; then
  CHROME_ARGS=(
    "--headless=new"
    "--disable-gpu"
  )
else
  CHROME_ARGS=()
fi

# Chrome listens on CDP_PORT directly now (simpler)
CHROME_ARGS+=(
  "--remote-debugging-address=0.0.0.0"
  "--remote-debugging-port=${CDP_PORT}"
  "--user-data-dir=${HOME}/.chrome"
  "--no-first-run"
  "--no-default-browser-check"
  "--disable-dev-shm-usage"
  "--disable-background-networking"
  "--disable-features=TranslateUI"
  "--disable-breakpad"
  "--disable-crash-reporter"
  "--metrics-recording-only"
  "--no-sandbox"
)

echo "Starting Chromium on CDP port ${CDP_PORT}..."
chromium "${CHROME_ARGS[@]}" about:blank &
CHROME_PID=$!
sleep 3

# Wait for Chrome to be ready
for i in $(seq 1 30); do
  if curl -sS --max-time 1 "http://127.0.0.1:${CDP_PORT}/json/version" >/dev/null 2>&1; then
    echo "Chromium ready on port ${CDP_PORT}"
    break
  fi
  if ! kill -0 $CHROME_PID 2>/dev/null; then
    echo "ERROR: Chromium exited unexpectedly"
    exit 1
  fi
  sleep 0.5
done

if [[ "${ENABLE_NOVNC}" == "1" && "${HEADLESS}" != "1" ]]; then
  echo "Starting VNC on port ${VNC_PORT}..."
  x11vnc -display :1 -rfbport "${VNC_PORT}" -shared -forever -nopw -xkb &
  sleep 1
  
  echo "Starting noVNC on port ${NOVNC_PORT}..."
  websockify --web /usr/share/novnc/ "${NOVNC_PORT}" "localhost:${VNC_PORT}" &
fi

echo "Sandbox browser ready. Access:"
echo "  - noVNC: http://localhost:${NOVNC_PORT}/vnc.html"
echo "  - VNC:   localhost:${VNC_PORT}"
echo "  - CDP:   http://localhost:${CDP_PORT}"

# Keep running - wait for Chrome
wait $CHROME_PID
