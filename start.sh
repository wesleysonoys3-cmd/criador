#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_DIR="$(ls -d "$SCRIPT_DIR"/node-v*-darwin-* 2>/dev/null | head -1)"

if [ -n "$NODE_DIR" ] && [ -x "$NODE_DIR/bin/node" ]; then
  export PATH="$NODE_DIR/bin:$PATH"
fi

cd "$SCRIPT_DIR"
MODE="${1:-server}"
shift || true

case "$MODE" in
  cli)    exec node agent.js "$@" ;;
  server) exec node server.js "$@" ;;
  *)      echo "Uso: $0 [server|cli]"; exit 1 ;;
esac
