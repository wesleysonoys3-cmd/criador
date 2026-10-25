#!/usr/bin/env bash
# ============================================
# TiAgente Security · Launcher (não depende do criador)
# ============================================
set -euo pipefail
cd "$(dirname "$0")"

# Carrega .env deste projeto Security (NÃO o do criador)
if [ -f .env ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%%#*}"          # tira comentários
    [ -z "$line" ] && continue
    case "$line" in
      *=*)
        KEY="${line%%=*}"
        VAL="${line#*=}"
        # remove aspas simples/duplas das bordas
        VAL="${VAL#\"}" ; VAL="${VAL%\"}"
        VAL="${VAL#\'}" ; VAL="${VAL%\'}"
        export "$KEY"="$VAL"
        ;;
    esac
  done < .env
fi

# Escolhe node: 1) path explicito 2) node portátil irmão ../node-v22.14.0 3) system node
NODE_BIN=""
if [ -x "../node-v22.14.0-darwin-x64/bin/node" ]; then
  NODE_BIN="$(cd .. && pwd)/node-v22.14.0-darwin-x64/bin/node"
elif command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
else
  echo "❌ Node não encontrado. Instale Node 22+ ou copie o node portátil do TiAgente Criador para a pasta irmã." >&2
  exit 1
fi

export PORT="${SECURITY_PORT:-3400}"
echo "🛞  TiAgente Security · iniciando servidor próprio"
echo "🌐 URL     : http://${HOST:-127.0.0.1}:${PORT}/"
echo "📂 Pasta   : $(pwd)"
echo ""
exec "$NODE_BIN" server.js
