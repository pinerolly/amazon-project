#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="amazon-project:latest"
CONTAINER_NAME="amazon-project"
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
USE_COMPOSE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --compose) USE_COMPOSE=1; shift ;;
    --force) FORCE=1; shift ;;
    -h|--help)
      cat <<'EOF'
Usage: deploy_docker.sh [--compose] [--force]
  --compose   Use docker compose if a docker-compose.yml exists
  --force     Remove any existing container without prompt
EOF
      exit 0
      ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

echo "App dir: $APP_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed or not in PATH. Install Docker first." >&2
  exit 1
fi

if [[ $USE_COMPOSE -eq 1 && -f "$APP_DIR/docker-compose.yml" ]]; then
  echo "Using docker compose to build and run"
  (cd "$APP_DIR" && docker compose up -d --build)
  echo "Started with docker compose"
  exit 0
fi

if [[ ! -f "$APP_DIR/.env" ]]; then
  echo ".env not found in project root ($APP_DIR). Please create it and retry." >&2
  exit 1
fi

echo "Building Docker image: $IMAGE_NAME"
docker build -t "$IMAGE_NAME" "$APP_DIR"

# Remove existing container if present
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  if [[ ${FORCE:-0} -eq 1 ]]; then
    echo "Removing existing container ${CONTAINER_NAME} (force)"
    docker rm -f "$CONTAINER_NAME"
  else
    echo "Stopping and removing existing container ${CONTAINER_NAME}"
    docker rm -f "$CONTAINER_NAME"
  fi
fi

# Mount auth.json if present
AUTH_VOLUME_OPTS=""
if [[ -f "$APP_DIR/auth.json" ]]; then
  AUTH_VOLUME_OPTS="-v $APP_DIR/auth.json:/usr/src/app/auth.json:ro"
  echo "Will mount auth.json into container"
fi

echo "Running container $CONTAINER_NAME"
docker run -d \
  --env-file "$APP_DIR/.env" \
  -p 3000:3000 \
  $AUTH_VOLUME_OPTS \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  "$IMAGE_NAME"

echo "Container started. To view logs: docker logs -f $CONTAINER_NAME"
echo "Check the app at http://localhost:3000 or use curl http://localhost:3000/api/status"
