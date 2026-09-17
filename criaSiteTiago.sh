#!/bin/bash
# ================================================================
#  criaSiteTiago — Launcher oficial do Agente TiAi IDE (RC18)
#  Se estiver DENTRO de CriaSiteTiago.app, usa o projeto empacotado
#  em Contents/Resources/app (auto-contido /Applications instalável).
# ================================================================

set +e

LAUNCHER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR_BUNDLE="$(dirname "$LAUNCHER_DIR")"     # Contents se estiver em app/Contents/MacOS
APP_BUNDLE_ROOT="$(dirname "$APP_DIR_BUNDLE")" # CriaSiteTiago.app se estiver no bundle

# ===========================
# RC18: PRIORIDADE 1 = Detectar rodando DENTRO do .app bundle
# ===========================
PROJ_DIR=""
if [ -f "$APP_DIR_BUNDLE/Info.plist" ]; then
  # 100% rodando dentro de CriaSiteTiago.app/Contents/MacOS/CriaSiteTiago
  RES_APP_DIR="$APP_DIR_BUNDLE/Resources/app"
  if [ -f "$RES_APP_DIR/server.js" ]; then
    PROJ_DIR="$RES_APP_DIR"
  fi
fi

# Fallback 2: se rodou o .command fora do bundle ou pasta do projeto
if [ -z "$PROJ_DIR" ]; then
  if [ -f "$APP_BUNDLE_ROOT/Contents/Info.plist" ] && [ -f "$APP_BUNDLE_ROOT/Contents/Resources/app/server.js" ]; then
    PROJ_DIR="$APP_BUNDLE_ROOT/Contents/Resources/app"
  elif [ -f "$LAUNCHER_DIR/server.js" ]; then
    PROJ_DIR="$LAUNCHER_DIR"
  elif [ -f "$(cd "$LAUNCHER_DIR/.." && pwd)/server.js" ]; then
    PROJ_DIR="$(cd "$LAUNCHER_DIR/.." && pwd)"
  elif [ -d "/Users/tiagosantos/Desktop/criador" ] && [ -f "/Users/tiagosantos/Desktop/criador/server.js" ]; then
    PROJ_DIR="/Users/tiagosantos/Desktop/criador"
  else
    echo "❌ Não encontrei a pasta do projeto (nenhum server.js)."
    echo "   Procurei:"
    echo "    - \$APP_BUNDLE/Contents/Resources/app (bundle .app)"
    echo "    - $LAUNCHER_DIR/server.js"
    echo "    - /Users/tiagosantos/Desktop/criador"
    read -r -p "Enter para sair…" _
    exit 1
  fi
fi

cd "$PROJ_DIR" || { echo "❌ cd falhou em: $PROJ_DIR"; read -r -p "Enter para sair…" _; exit 1; }

LOG_FILE="$PROJ_DIR/launcher.log"
: > "$LOG_FILE"
echo "🕐 [$(date '+%H:%M:%S')] Iniciando TiAi IDE. Fonte projeto: $PROJ_DIR" | tee -a "$LOG_FILE"

# 1) Garantir permissões de execução
if [ -f "$PROJ_DIR/start.sh" ]; then chmod +x "$PROJ_DIR/start.sh" 2>/dev/null || true; fi

# 2) Encontrar node (portátil 1º, fallback sistema 2º)
NODE_BIN=""
NODE_PORT="$(ls "$PROJ_DIR"/node-v*-darwin-*/bin/node 2>/dev/null | head -1)"
if [ -n "$NODE_PORT" ] && [ -x "$NODE_PORT" ]; then
  NODE_BIN="$NODE_PORT"
  export PATH="$(dirname "$NODE_PORT"):$PATH"
elif command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
else
  echo "❌ Node.js NÃO encontrado. Impossível rodar o TiAi IDE." | tee -a "$LOG_FILE"
  echo "   Espera-se node portátil em: $PROJ_DIR/node-vX.X.X-darwin-x64/bin/node" | tee -a "$LOG_FILE"
  read -r -p "Enter para sair…" _
  exit 2
fi
echo "✅ Node OK: $("$NODE_BIN" --version)  ($NODE_BIN)" | tee -a "$LOG_FILE"

# 3) Carregar .env (checar GOOGLE_API_KEY avisar se faltar)
if [ -f "$PROJ_DIR/.env" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      \#*)   continue ;;
      *\"*)  eval "${line%%=*}"="\"$(echo "${line#*=}" | tr -d '"')\"" ;;
      *)     eval "${line%%=*}"="'$(echo "${line#*=}" | tr -d "'")'" ;;
    esac
  done < "$PROJ_DIR/.env" 2>/dev/null
fi
if [ -z "${GOOGLE_API_KEY:-}" ] || echo "${GOOGLE_API_KEY:-}" | grep -q "sua_chave\|your_key\|YOUR_KEY"; then
  echo "⚠️  ATENÇÃO: GOOGLE_API_KEY vazia no .env → a IA NÃO vai gerar nada, só vai retornar erro." | tee -a "$LOG_FILE"
fi

# 4) Matar servidor antigo porta 3000 (para não conflitar)
PORT="3000"
OLD_PIDS="$(lsof -ti :"$PORT" 2>/dev/null)"
if [ -n "$OLD_PIDS" ]; then
  echo "🔄 Fechando servidor antigo (PIDs $OLD_PIDS)…" | tee -a "$LOG_FILE"
  kill -9 $OLD_PIDS 2>/dev/null || true
  sleep 0.8
fi

# 5) Rodar servidor em BACKGROUND nohup (persiste)
SERVER_LOG="$PROJ_DIR/server.log"
: > "$SERVER_LOG"
cd "$PROJ_DIR"
nohup "$NODE_BIN" "$PROJ_DIR/server.js" >> "$SERVER_LOG" 2>&1 &
SERVER_PID=$!
disown "$SERVER_PID" 2>/dev/null || true
echo "🚀 Servidor iniciado PID=$SERVER_PID · log: $SERVER_LOG" | tee -a "$LOG_FILE"

# 6) Esperar server subir (max 15s)
READY=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if lsof -i :"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then READY=1; break; fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "💥 Server caiu. Tail do log:" | tee -a "$LOG_FILE"
    tail -n 30 "$SERVER_LOG" | tee -a "$LOG_FILE"
    read -r -p "Enter para sair…" _
    exit 3
  fi
  sleep 1
done

URL="http://localhost:$PORT/"
if [ "$READY" -ne 1 ]; then
  echo "⚠️  Timeout porta $PORT — talvez esteja carregando ainda… Tentando abrir mesmo assim." | tee -a "$LOG_FILE"
fi

# Abrir NAVEGADOR PADRÃO do macOS (Safari/Chrome/Arc padrão do usuário)
echo "🌐 Abrindo navegador → $URL" | tee -a "$LOG_FILE"
/usr/bin/open "$URL"

echo ""
echo "=============================================="
echo "  ✅  TiAi IDE ONLINE"
echo "  🚀  PID servidor : $SERVER_PID"
echo "  📂  Projeto      : $PROJ_DIR"
echo "  🌐  URL          : $URL"
echo "  📝  Logs         : $SERVER_LOG"
echo ""
echo "  💡  Para fechar: lsof -ti :3000 | xargs kill -9"
echo "=============================================="
echo ""

# Se for bundle .app, fecha automaticamente a janela (não precisa terminal aberto).
# Se for .command separado, espera o usuário apertar enter.
if { [ -f "$APP_DIR_BUNDLE/Info.plist" ] || [[ "$0" == *.app/Contents/MacOS/* ]]; } 2>/dev/null; then
  sleep 1.5
  exit 0
fi
read -r -p "Pressione Enter para FECHAR a janela (servidor CONTINUA rodando!)…" _
exit 0
