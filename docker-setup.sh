#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"
EXTRA_COMPOSE_FILE="$ROOT_DIR/docker-compose.extra.yml"
GPU_COMPOSE_FILE="$ROOT_DIR/docker-compose.gpu.yml"
DESKTOP_COMPOSE_FILE="$ROOT_DIR/docker-compose.desktop.yml"
GPU_DESKTOP_COMPOSE_FILE="$ROOT_DIR/docker-compose.gpu.desktop.yml"
IMAGE_NAME="${OPENCLAW_IMAGE:-openclaw:local}"
DESKTOP_IMAGE="${OPENCLAW_DESKTOP_IMAGE:-openclaw-desktop:local}"
SANDBOX_BROWSER_IMAGE="${OPENCLAW_SANDBOX_BROWSER_IMAGE:-openclaw-sandbox-browser:local}"
EXTRA_MOUNTS="${OPENCLAW_EXTRA_MOUNTS:-}"
HOME_VOLUME_NAME="${OPENCLAW_HOME_VOLUME:-}"
ENABLE_GPU="${OPENCLAW_ENABLE_GPU:-0}"
ENABLE_DESKTOP="${OPENCLAW_START_DESKTOP:-0}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing dependency: $1" >&2
    exit 1
  fi
}

require_cmd docker
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose not available (try: docker compose version)" >&2
  exit 1
fi

OPENCLAW_CONFIG_DIR="${OPENCLAW_CONFIG_DIR:-$HOME/.openclaw}"
OPENCLAW_WORKSPACE_DIR="${OPENCLAW_WORKSPACE_DIR:-$HOME/.openclaw/workspace}"

mkdir -p "$OPENCLAW_CONFIG_DIR"
mkdir -p "$OPENCLAW_WORKSPACE_DIR"

export OPENCLAW_CONFIG_DIR
export OPENCLAW_WORKSPACE_DIR
export OPENCLAW_GATEWAY_PORT="${OPENCLAW_GATEWAY_PORT:-18789}"
export OPENCLAW_BRIDGE_PORT="${OPENCLAW_BRIDGE_PORT:-18790}"
export OPENCLAW_GATEWAY_BIND="${OPENCLAW_GATEWAY_BIND:-lan}"
export OPENCLAW_IMAGE="$IMAGE_NAME"
export OPENCLAW_DOCKER_APT_PACKAGES="${OPENCLAW_DOCKER_APT_PACKAGES:-}"
export OPENCLAW_EXTRA_MOUNTS="$EXTRA_MOUNTS"
export OPENCLAW_HOME_VOLUME="$HOME_VOLUME_NAME"

# New: User ID/GID for file permission mapping
# Note: UID is a readonly bash variable, so we use DOCKER_UID/DOCKER_GID
export DOCKER_UID="$(id -u)"
export DOCKER_GID="$(id -g)"

# New: GPU support (set to 1 to enable)
export OPENCLAW_ENABLE_GPU="${OPENCLAW_ENABLE_GPU:-0}"

# GPU environment check
check_gpu_support() {
  if [[ "$ENABLE_GPU" != "1" ]]; then
    return 0
  fi
  
  echo "==> Checking GPU support..."
  
  # Check if nvidia-smi is available
  if ! command -v nvidia-smi >/dev/null 2>&1; then
    echo "WARNING: nvidia-smi not found. GPU support may not work."
    echo "  Install NVIDIA drivers first."
    return 1
  fi
  
  # Check if nvidia-container-toolkit is installed
  if ! command -v nvidia-container-toolkit >/dev/null 2>&1; then
    echo "WARNING: nvidia-container-toolkit not found."
    echo "  Install with: sudo apt install nvidia-container-toolkit"
    return 1
  fi
  
  # Check if Docker has NVIDIA runtime configured
  if ! docker info 2>/dev/null | grep -q "nvidia"; then
    echo "WARNING: NVIDIA runtime not configured in Docker."
    echo "  Run: sudo nvidia-ctk runtime configure --runtime=docker"
    echo "  Then: sudo systemctl restart docker"
    echo ""
    echo "  Attempting to configure automatically (requires sudo)..."
    if sudo nvidia-ctk runtime configure --runtime=docker 2>/dev/null && \
       sudo systemctl restart docker 2>/dev/null; then
      echo "  ✓ NVIDIA runtime configured successfully"
    else
      echo "  ✗ Failed to configure automatically. Please run the commands above manually."
      return 1
    fi
  fi
  
  # Test GPU access in Docker
  if docker run --rm --gpus all nvidia/cuda:12.0-base-ubuntu22.04 nvidia-smi >/dev/null 2>&1; then
    echo "✓ GPU support verified"
  else
    echo "WARNING: GPU test failed. GPU access may not work in containers."
  fi
  
  return 0
}

# New: Canvas Host port for A2UI visualization
export OPENCLAW_CANVAS_PORT="${OPENCLAW_CANVAS_PORT:-18793}"

# New: Project directory (defaults to current directory)
export OPENCLAW_PROJECT_DIR="${OPENCLAW_PROJECT_DIR:-$(pwd)}"

# New: Host root mount (defaults to / for full read-only access)
export OPENCLAW_HOST_ROOT="${OPENCLAW_HOST_ROOT:-/}"

# New: Sandbox browser settings
export OPENCLAW_SANDBOX_BROWSER_IMAGE="${OPENCLAW_SANDBOX_BROWSER_IMAGE:-openclaw-sandbox-browser:local}"
export OPENCLAW_BROWSER_CDP_PORT="${OPENCLAW_BROWSER_CDP_PORT:-9222}"
export OPENCLAW_BROWSER_VNC_PORT="${OPENCLAW_BROWSER_VNC_PORT:-5900}"
export OPENCLAW_BROWSER_NOVNC_PORT="${OPENCLAW_BROWSER_NOVNC_PORT:-6080}"
export OPENCLAW_BROWSER_ENABLE_NOVNC="${OPENCLAW_BROWSER_ENABLE_NOVNC:-1}"
export OPENCLAW_BROWSER_HEADLESS="${OPENCLAW_BROWSER_HEADLESS:-0}"

if [[ -z "${OPENCLAW_GATEWAY_TOKEN:-}" ]]; then
  if command -v openssl >/dev/null 2>&1; then
    OPENCLAW_GATEWAY_TOKEN="$(openssl rand -hex 32)"
  else
    OPENCLAW_GATEWAY_TOKEN="$(python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
)"
  fi
fi
export OPENCLAW_GATEWAY_TOKEN

COMPOSE_FILES=("$COMPOSE_FILE")
COMPOSE_ARGS=()

write_extra_compose() {
  local home_volume="$1"
  shift
  local -a mounts=("$@")
  local mount

  cat >"$EXTRA_COMPOSE_FILE" <<'YAML'
services:
  openclaw-gateway:
    volumes:
YAML

  if [[ -n "$home_volume" ]]; then
    printf '      - %s:/home/node\n' "$home_volume" >>"$EXTRA_COMPOSE_FILE"
    printf '      - %s:/home/node/.openclaw\n' "$OPENCLAW_CONFIG_DIR" >>"$EXTRA_COMPOSE_FILE"
    printf '      - %s:/home/node/.openclaw/workspace\n' "$OPENCLAW_WORKSPACE_DIR" >>"$EXTRA_COMPOSE_FILE"
  fi

  for mount in "${mounts[@]}"; do
    printf '      - %s\n' "$mount" >>"$EXTRA_COMPOSE_FILE"
  done

  cat >>"$EXTRA_COMPOSE_FILE" <<'YAML'
  openclaw-cli:
    volumes:
YAML

  if [[ -n "$home_volume" ]]; then
    printf '      - %s:/home/node\n' "$home_volume" >>"$EXTRA_COMPOSE_FILE"
    printf '      - %s:/home/node/.openclaw\n' "$OPENCLAW_CONFIG_DIR" >>"$EXTRA_COMPOSE_FILE"
    printf '      - %s:/home/node/.openclaw/workspace\n' "$OPENCLAW_WORKSPACE_DIR" >>"$EXTRA_COMPOSE_FILE"
  fi

  for mount in "${mounts[@]}"; do
    printf '      - %s\n' "$mount" >>"$EXTRA_COMPOSE_FILE"
  done

  if [[ -n "$home_volume" && "$home_volume" != *"/"* ]]; then
    cat >>"$EXTRA_COMPOSE_FILE" <<YAML
volumes:
  ${home_volume}:
YAML
  fi
}

VALID_MOUNTS=()
if [[ -n "$EXTRA_MOUNTS" ]]; then
  IFS=',' read -r -a mounts <<<"$EXTRA_MOUNTS"
  for mount in "${mounts[@]}"; do
    mount="${mount#"${mount%%[![:space:]]*}"}"
    mount="${mount%"${mount##*[![:space:]]}"}"
    if [[ -n "$mount" ]]; then
      VALID_MOUNTS+=("$mount")
    fi
  done
fi

if [[ -n "$HOME_VOLUME_NAME" || ${#VALID_MOUNTS[@]} -gt 0 ]]; then
  write_extra_compose "$HOME_VOLUME_NAME" "${VALID_MOUNTS[@]}"
  COMPOSE_FILES+=("$EXTRA_COMPOSE_FILE")
fi
for compose_file in "${COMPOSE_FILES[@]}"; do
  COMPOSE_ARGS+=("-f" "$compose_file")
done
COMPOSE_HINT="docker compose"
for compose_file in "${COMPOSE_FILES[@]}"; do
  COMPOSE_HINT+=" -f ${compose_file}"
done

ENV_FILE="$ROOT_DIR/.env"
upsert_env() {
  local file="$1"
  shift
  local -a keys=("$@")
  local tmp
  tmp="$(mktemp)"
  declare -A seen=()

  if [[ -f "$file" ]]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
      local key="${line%%=*}"
      local replaced=false
      for k in "${keys[@]}"; do
        if [[ "$key" == "$k" ]]; then
          printf '%s=%s\n' "$k" "${!k-}" >>"$tmp"
          seen["$k"]=1
          replaced=true
          break
        fi
      done
      if [[ "$replaced" == false ]]; then
        printf '%s\n' "$line" >>"$tmp"
      fi
    done <"$file"
  fi

  for k in "${keys[@]}"; do
    if [[ -z "${seen[$k]:-}" ]]; then
      printf '%s=%s\n' "$k" "${!k-}" >>"$tmp"
    fi
  done

  mv "$tmp" "$file"
}

upsert_env "$ENV_FILE" \
  OPENCLAW_CONFIG_DIR \
  OPENCLAW_WORKSPACE_DIR \
  OPENCLAW_GATEWAY_PORT \
  OPENCLAW_BRIDGE_PORT \
  OPENCLAW_GATEWAY_BIND \
  OPENCLAW_GATEWAY_TOKEN \
  OPENCLAW_IMAGE \
  OPENCLAW_EXTRA_MOUNTS \
  OPENCLAW_HOME_VOLUME \
  OPENCLAW_DOCKER_APT_PACKAGES \
  DOCKER_UID \
  DOCKER_GID \
  OPENCLAW_ENABLE_GPU \
  OPENCLAW_CANVAS_PORT \
  OPENCLAW_PROJECT_DIR \
  OPENCLAW_HOST_ROOT \
  OPENCLAW_SANDBOX_BROWSER_IMAGE \
  OPENCLAW_BROWSER_CDP_PORT \
  OPENCLAW_BROWSER_VNC_PORT \
  OPENCLAW_BROWSER_NOVNC_PORT \
  OPENCLAW_BROWSER_ENABLE_NOVNC \
  OPENCLAW_BROWSER_HEADLESS

echo "==> Building Docker image: $IMAGE_NAME"
docker build \
  --build-arg "OPENCLAW_DOCKER_APT_PACKAGES=${OPENCLAW_DOCKER_APT_PACKAGES}" \
  -t "$IMAGE_NAME" \
  -f "$ROOT_DIR/Dockerfile" \
  "$ROOT_DIR"

echo ""
echo "==> Building sandbox browser image: $SANDBOX_BROWSER_IMAGE"
docker build \
  -t "$SANDBOX_BROWSER_IMAGE" \
  -f "$ROOT_DIR/Dockerfile.sandbox-browser" \
  "$ROOT_DIR"

# Build desktop image if desktop mode enabled
if [[ "$ENABLE_DESKTOP" == "1" ]]; then
  echo ""
  echo "==> Building desktop image: $DESKTOP_IMAGE"
  docker build \
    --build-arg "OPENCLAW_DOCKER_APT_PACKAGES=${OPENCLAW_DOCKER_APT_PACKAGES}" \
    -t "$DESKTOP_IMAGE" \
    -f "$ROOT_DIR/Dockerfile.desktop" \
    "$ROOT_DIR"
fi

# Add GPU compose file if enabled
if [[ "$ENABLE_GPU" == "1" && -f "$GPU_COMPOSE_FILE" ]]; then
  echo ""
  echo "==> GPU support enabled"
  check_gpu_support || echo "Continuing anyway..."
  COMPOSE_FILES+=("$GPU_COMPOSE_FILE")
  # Rebuild COMPOSE_ARGS with GPU file
  COMPOSE_ARGS=()
  for compose_file in "${COMPOSE_FILES[@]}"; do
    COMPOSE_ARGS+=("-f" "$compose_file")
  done
  # Update hint
  COMPOSE_HINT="docker compose"
  for compose_file in "${COMPOSE_FILES[@]}"; do
    COMPOSE_HINT+=" -f ${compose_file}"
  done
fi

# Add desktop compose files if enabled
if [[ "$ENABLE_DESKTOP" == "1" && -f "$DESKTOP_COMPOSE_FILE" ]]; then
  echo ""
  echo "==> Desktop mode enabled"
  COMPOSE_FILES+=("$DESKTOP_COMPOSE_FILE")
  if [[ "$ENABLE_GPU" == "1" && -f "$GPU_DESKTOP_COMPOSE_FILE" ]]; then
    COMPOSE_FILES+=("$GPU_DESKTOP_COMPOSE_FILE")
  fi
  # Rebuild COMPOSE_ARGS
  COMPOSE_ARGS=()
  for compose_file in "${COMPOSE_FILES[@]}"; do
    COMPOSE_ARGS+=("-f" "$compose_file")
  done
  COMPOSE_HINT="docker compose"
  for compose_file in "${COMPOSE_FILES[@]}"; do
    COMPOSE_HINT+=" -f ${compose_file}"
  done
fi

# Skip onboarding if OPENCLAW_SKIP_ONBOARD is set, or create config directly
if [[ "${OPENCLAW_SKIP_ONBOARD:-0}" == "1" ]]; then
  echo ""
  echo "==> Skipping onboarding (OPENCLAW_SKIP_ONBOARD=1)"
  echo "==> Creating gateway configuration..."
  
  # Create config directory if needed
  mkdir -p "$OPENCLAW_CONFIG_DIR"
  
  # Create or update config.json with gateway settings
  CONFIG_FILE="$OPENCLAW_CONFIG_DIR/config.json"
  if [[ ! -f "$CONFIG_FILE" ]]; then
    cat > "$CONFIG_FILE" << EOF
{
  "gateway": {
    "bind": "${OPENCLAW_GATEWAY_BIND:-lan}",
    "port": ${OPENCLAW_GATEWAY_PORT:-18789},
    "auth": {
      "mode": "token",
      "token": "${OPENCLAW_GATEWAY_TOKEN}"
    }
  }
}
EOF
    echo "  Created $CONFIG_FILE"
  else
    echo "  Config already exists: $CONFIG_FILE"
  fi
else
  echo ""
  echo "==> Onboarding (interactive)"
  echo "When prompted:"
  echo "  - Gateway bind: lan"
  echo "  - Gateway auth: token"
  echo "  - Gateway token: $OPENCLAW_GATEWAY_TOKEN"
  echo "  - Tailscale exposure: Off"
  echo "  - Install Gateway daemon: No"
  echo ""
  echo "TIP: Set OPENCLAW_SKIP_ONBOARD=1 to skip this step"
  echo ""
  docker compose "${COMPOSE_ARGS[@]}" run --rm openclaw-cli onboard --no-install-daemon
fi

echo ""
echo "==> Provider setup (optional)"
echo "WhatsApp (QR):"
echo "  ${COMPOSE_HINT} run --rm openclaw-cli providers login"
echo "Telegram (bot token):"
echo "  ${COMPOSE_HINT} run --rm openclaw-cli providers add --provider telegram --token <token>"
echo "Discord (bot token):"
echo "  ${COMPOSE_HINT} run --rm openclaw-cli providers add --provider discord --token <token>"
echo "Docs: https://docs.openclaw.ai/providers"

echo ""
echo "==> Starting gateway"
docker compose "${COMPOSE_ARGS[@]}" up -d openclaw-gateway

# Start sandbox browser if GUI/browser profile requested
if [[ "${OPENCLAW_START_BROWSER:-0}" == "1" ]]; then
  echo ""
  echo "==> Starting sandbox browser (noVNC)"
  docker compose "${COMPOSE_ARGS[@]}" --profile browser up -d openclaw-sandbox-browser
fi

# Start desktop if desktop mode enabled
if [[ "$ENABLE_DESKTOP" == "1" ]]; then
  echo ""
  echo "==> Starting desktop environment"
  docker compose "${COMPOSE_ARGS[@]}" up -d openclaw-desktop
fi

echo ""
echo "Gateway running with host port mapping."
echo "Access from tailnet devices via the host's tailnet IP."
echo ""
echo "=== Access URLs ==="
echo "  Control UI:    http://localhost:${OPENCLAW_GATEWAY_PORT:-18789}"
echo "  Canvas Host:   http://localhost:${OPENCLAW_CANVAS_PORT:-18793}"
if [[ "${OPENCLAW_START_BROWSER:-0}" == "1" ]]; then
  echo "  noVNC Browser: http://localhost:${OPENCLAW_BROWSER_NOVNC_PORT:-6080}/vnc.html"
fi
if [[ "$ENABLE_DESKTOP" == "1" ]]; then
  echo "  Desktop (noVNC): http://localhost:${OPENCLAW_BROWSER_NOVNC_PORT:-6080}/vnc.html"
  echo "  Desktop (VNC):   localhost:${OPENCLAW_BROWSER_VNC_PORT:-5900}"
fi
echo ""
echo "=== Configuration ==="
echo "  Config:    $OPENCLAW_CONFIG_DIR"
echo "  Workspace: $OPENCLAW_WORKSPACE_DIR"
echo "  Project:   $OPENCLAW_PROJECT_DIR"
echo "  Host root: /host-root (read-only)"
echo "  Token:     $OPENCLAW_GATEWAY_TOKEN"
echo "  GPU:       $([ \"$ENABLE_GPU\" == \"1\" ] && echo \"enabled\" || echo \"disabled\")"
echo ""
echo "=== Commands ==="
echo "  ${COMPOSE_HINT} logs -f openclaw-gateway"
echo "  ${COMPOSE_HINT} exec openclaw-gateway node dist/index.js health --token \"$OPENCLAW_GATEWAY_TOKEN\""
echo "  ${COMPOSE_HINT} --profile browser up -d openclaw-sandbox-browser  # Start visual browser"
echo ""
echo "=== File Access ==="
echo "  Host files (read-only):  /host-root/..."
echo "  Project (read-write):    /project/..."
