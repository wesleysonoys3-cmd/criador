#!/bin/bash
# ================================================================
#  criaSiteTiago — Launcher oficial do Agente Autônomo estilo TiAi
#  Uso: Duplo clique, ou clique no Dock / Desktop / Launchpad
# ================================================================

set +e  # Não quero fechar o terminal se algo falhar, quero mostrar erro

LAUNCHER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$LAUNCHER_DIR")"

# Se o launcher estiver DENTRO do .app bundle, usar a raiz do projeto
if [ -f "$APP_DIR/Contents/Info.plist" ]; then
  # .app: CriaSiteTiago.app/Contents/MacOS/criaSiteTiago
  # aponta para /Users/tiagosantos/Desktop/criador (pai do .app se estiver lá)
  PROJ_DIR="$(cd "$APP_DIR/../../.." && pwd)"
  if [ ! -f "$PROJ_DIR/server.js" ]; then
    # fallback: assume que o projeto está no Desktop fixo
    PROJ_DIR="/Users/tiagosantos/Desktop/criador"
  fi
else
  # Executando como .command direto ou shell
  if [ -f "$LAUNCHER_DIR/server.js" ]; then
    PROJ_DIR="$LAUNCHER_DIR"
  else
    PROJ_DIR="$(cd "$LAUNCHER_DIR/.." && pwd)"
    if [ ! -f "$PROJ_DIR/server.js" ]; then
      PROJ_DIR="/Users/tiagosantos/Desktop/criador"
    fi
  fi
fi

cd "$PROJ_DIR" || { echo "❌ Não encontrei a pasta do projeto em: $PROJ_DIR"; read -r -p "Enter para sair…" _; exit 1; }

LOG_FILE="$PROJ_DIR/launcher.log"
: > "$LOG_FILE"
echo "🕐 [$(date '+%H:%M:%S')] Iniciando criaSiteTiago — diretório: $PROJ_DIR" | tee -a "$LOG_FILE"

# 1) Garantir permissão de execução no start.sh
if [ -f "$PROJ_DIR/start.sh" ]; then
  chmod +x "$PROJ_DIR/start.sh" 2>/dev/null || true
fi

# 2) Encontrar node (portátil no projeto, senão o do sistema)
NODE_BIN=""
NODE_PORT="$(ls -d "$PROJ_DIR"/node-v*-darwin-*/bin/node 2>/dev/null | head -1)"
if [ -n "$NODE_PORT" ] && [ -x "$NODE_PORT" ]; then
  NODE_BIN="$NODE_PORT"
  export PATH="$(dirname "$NODE_PORT"):$PATH"
elif command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
else
  echo "❌ Node.js não encontrado. Reinstale o node portátil na pasta do projeto." | tee -a "$LOG_FILE"
  echo "   Espera-se algo como: $PROJ_DIR/node-v22.14.0-darwin-x64/bin/node" | tee -a "$LOG_FILE"
  read -r -p "Enter para sair…" _
  exit 2
fi
echo "✅ Node OK: $("$NODE_BIN" --version)  ($NODE_BIN)" | tee -a "$LOG_FILE"

# 3) Carregar .env se existir (só pra checar GOOGLE_API_KEY)
if [ -f "$PROJ_DIR/.env" ]; then
  # shellcheck disable=SC1091
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      \#*)   continue ;;
      *\"*)  eval "${line%%=*}"="\"$(echo "${line#*=}" | tr -d '"')\"" ;;
      *)     eval "${line%%=*}"="'$(echo "${line#*=}" | tr -d "'")'" ;;
    esac
  done < "$PROJ_DIR/.env" 2>/dev/null
fi

if [ -z "$GOOGLE_API_KEY" ] || echo "$GOOGLE_API_KEY" | grep -q "sua_chave"; then
  echo "⚠️  AVISO: GOOGLE_API_KEY não configurada no .env. O agente vai funcionar mas vai retornar erro ao gerar." | tee -a "$LOG_FILE"
fi

# 4) Matar qualquer servidor antigo na porta 3000
PORT="3000"
OLD_PIDS="$(lsof -ti :"$PORT" 2>/dev/null)"
if [ -n "$OLD_PIDS" ]; then
  echo "🔄 Fechando servidor antigo (PIDs: $OLD_PIDS)…" | tee -a "$LOG_FILE"
  kill -9 $OLD_PIDS 2>/dev/null || true
  sleep 1
fi

# 5) Lançar o servidor em BACKGROUND com NOHUP (continua rodando mesmo se fechar o terminal)
SERVER_LOG="$PROJ_DIR/server.log"
: > "$SERVER_LOG"
cd "$PROJ_DIR"
nohup "$NODE_BIN" "$PROJ_DIR/server.js" >> "$SERVER_LOG" 2>&1 &
SERVER_PID=$!
echo "🚀 Servidor iniciado — PID=$SERVER_PID, log em: $SERVER_LOG" | tee -a "$LOG_FILE"
disown "$SERVER_PID" 2>/dev/null || true

# 6) Esperar o servidor subir (máx 15 segundos)
READY=0
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if lsof -i :"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    READY=1
    break
  fi
  # Verifica se o processo tá vivo ainda
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "💥 O servidor caiu antes de abrir a porta. Tail do log:" | tee -a "$LOG_FILE"
    tail -n 30 "$SERVER_LOG" | tee -a "$LOG_FILE"
    read -r -p "Enter para sair…" _
    exit 3
  fi
  sleep 1
done

if [ "$READY" -ne 1 ]; then
  echo "⚠️  Timeout esperando a porta $PORT abrir. Verifique o log: $SERVER_LOG" | tee -a "$LOG_FILE"
  tail -n 20 "$SERVER_LOG" | tee -a "$LOG_FILE"
else
  URL="http://localhost:$PORT/"
  echo "🌐 Abrindo navegador em: $URL" | tee -a "$LOG_FILE"
  # Abrir no navegador PADRÃO do usuário (Safari / Chrome / Firefox default)
  /usr/bin/open "$URL"
fi

# 7) Print conclusão e NÃO fecha a janela automaticamente (para .command)
echo ""
echo "=============================================="
echo "  ✅  criaSiteTiago ONLINE"
echo "  🚀  PID servidor: $SERVER_PID"
echo "  📂  Projeto: $PROJ_DIR"
echo "  🌐  URL:     http://localhost:$PORT/"
echo "  📝  Logs:    $SERVER_LOG"
echo ""
echo "  💡  Dica: para fechar o servidor depois,"
echo "     feche o processo PID=$SERVER_PID ou"
echo "     execute:  lsof -ti :3000 | xargs kill -9"
echo "=============================================="
echo ""

# Se estiver rodando VIA .app bundle, não precisa ficar com terminal aberto.
# Caso contrário (.command), espera Enter do usuário.
if { [ -f "$APP_DIR/Contents/Info.plist" ] || [[ "$0" == *.app/Contents/MacOS/* ]]; } 2>/dev/null; then
  sleep 1
  exit 0
fi

read -r -p "Pressione Enter para fechar esta janela (o servidor CONTINUA rodando!)…" _
exit 0
