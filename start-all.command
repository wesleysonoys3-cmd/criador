#!/bin/bash
# ==========================================================================
#  start-all — Launcher macOS (DUPLA CLIQUE: abre Terminal.app e roda)
#  Sobe 2 servidores numa tacada só:
#    1) TiAgente Criador  → http://localhost:3000
#    2) TiAgente Security → http://localhost:3400
#
#  COMPATIBILIDADE: bash 3.2+ (padrão macOS Catalina → Sequoia).
#  NÃO usa arrays associativos (declare -A) nem bash 4.
# ==========================================================================

set +e

LAUNCHER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "$LAUNCHER_DIR/server.js" ]; then
  PROJ_DIR="$LAUNCHER_DIR"
else
  PROJ_DIR="/Users/tiagosantos/Desktop/criador"
fi
SECURITY_DIR="$PROJ_DIR/TiAgente-Security"

LOG_FILE="$PROJ_DIR/start-all.log"
CRIADOR_LOG="$PROJ_DIR/server.log"
SECURITY_LOG="$SECURITY_DIR/server.log"

: > "$LOG_FILE"

echo "" | tee -a "$LOG_FILE"
echo "╔═══════════════════════════════════════════════════════════════╗" | tee -a "$LOG_FILE"
echo "║   TiAgente · INICIAR TUDO  (Criador 3000 + Security 3400)   ║" | tee -a "$LOG_FILE"
echo "╚═══════════════════════════════════════════════════════════════╝" | tee -a "$LOG_FILE"
echo "🕐 [$(date '+%H:%M:%S')] Diretório projeto : $PROJ_DIR" | tee -a "$LOG_FILE"
echo "🕐 [$(date '+%H:%M:%S')] Diretório security: $SECURITY_DIR" | tee -a "$LOG_FILE"

if [ ! -f "$PROJ_DIR/server.js" ]; then
  echo "❌ Pasta CRIADOR incorreta (não encontrei server.js). Esperado em: $PROJ_DIR" | tee -a "$LOG_FILE"
  read -r -p "Enter para sair…" _; exit 1
fi
if [ ! -f "$SECURITY_DIR/server.js" ]; then
  echo "❌ Pasta SECURITY incorreta (não encontrei TiAgente-Security/server.js)." | tee -a "$LOG_FILE"
  read -r -p "Enter para sair…" _; exit 1
fi

NODE_BIN=""
NODE_PORT="$(ls -d "$PROJ_DIR"/node-v*-darwin-*/bin/node 2>/dev/null | head -1)"
if [ -n "$NODE_PORT" ] && [ -x "$NODE_PORT" ]; then
  NODE_BIN="$NODE_PORT"
  export PATH="$(dirname "$NODE_PORT"):$PATH"
elif command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
else
  echo "❌ Node.js não encontrado. Esperado: $PROJ_DIR/node-v22.14.0-darwin-x64/bin/node" | tee -a "$LOG_FILE"
  read -r -p "Enter para sair…" _; exit 2
fi
echo "✅ Node OK: $("$NODE_BIN" --version)  ($NODE_BIN)" | tee -a "$LOG_FILE"

chmod +x "$PROJ_DIR/start.sh" 2>/dev/null || true
chmod +x "$SECURITY_DIR/start.sh" 2>/dev/null || true

porta_em_uso() {
  lsof -i :"$1" -sTCP:LISTEN >/dev/null 2>&1
}
pid_da_porta() {
  lsof -ti :"$1" 2>/dev/null | tr '\n' ' ' | sed 's/ $//'
}
aguarda_porta() {
  local porta="$1" max="$2" pid="$3" i
  for i in $(seq 1 "$max"); do
    if porta_em_uso "$porta"; then return 0; fi
    if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then return 2; fi
    sleep 1
  done
  return 1
}

# ===== Variáveis individuais (Bash 3 seguro — SEM declare -A) =====
C_NOME="TiAgente Criador"
C_PORTA=3000
C_URL="http://localhost:3000/"
C_PROJ="$PROJ_DIR"
C_LOG="$CRIADOR_LOG"
C_SERVER="$PROJ_DIR/server.js"
C_STATUS="PENDENTE"
C_PID=""

S_NOME="TiAgente Security"
S_PORTA=3400
S_URL="http://localhost:3400/"
S_PROJ="$SECURITY_DIR"
S_LOG="$SECURITY_LOG"
S_SERVER="$SECURITY_DIR/server.js"
S_STATUS="PENDENTE"
S_PID=""

inicia_servico() {
  # $1=nome $2=porta $3=proj_dir $4=log_file $5=server_js
  # Variáveis de retorno (globais): _STATUS _PID
  local nome="$1" porta="$2" proj="$3" log="$4" server_js="$5"
  local antigo
  echo "" | tee -a "$LOG_FILE"
  echo "───────────────────────────────────────────────────────────" | tee -a "$LOG_FILE"
  echo "▶  $nome  (porta $porta)" | tee -a "$LOG_FILE"

  if porta_em_uso "$porta"; then
    antigo="$(pid_da_porta "$porta")"
    echo "   🔄 Já está rodando (PID(s) $antigo). Vou reiniciar limpo…" | tee -a "$LOG_FILE"
    kill -9 $antigo 2>/dev/null || true
    sleep 1
  fi

  : > "$log"
  cd "$proj" || {
    echo "   ❌ cd falhou em: $proj" | tee -a "$LOG_FILE"
    _STATUS="FALHOU"; _PID=""
    return
  }
  nohup "$NODE_BIN" "$server_js" >> "$log" 2>&1 &
  _PID=$!
  disown "$_PID" 2>/dev/null || true
  echo "   🚀 Servidor lançando — PID=$_PID" | tee -a "$LOG_FILE"
  echo "   📝 Log em: $log" | tee -a "$LOG_FILE"

  if aguarda_porta "$porta" 18 "$_PID"; then
    echo "   ✅ $nome ONLINE (porta $porta aberta)" | tee -a "$LOG_FILE"
    _STATUS="ONLINE"
  else
    local rc=$?
    _STATUS="FALHOU"
    if [ "$rc" = "2" ]; then
      echo "   💥 Processo caiu ANTES de abrir a porta $porta. Tail do log:" | tee -a "$LOG_FILE"
    else
      echo "   ⚠️  Timeout esperando porta $porta. Estado do processo (PID=$_PID):" | tee -a "$LOG_FILE"
    fi
    tail -n 30 "$log" | tee -a "$LOG_FILE"
  fi
}

# ======= Executa os dois serviços =======
inicia_servico "$C_NOME" "$C_PORTA" "$C_PROJ" "$C_LOG" "$C_SERVER"
C_STATUS="$_STATUS" ; C_PID="$_PID"

inicia_servico "$S_NOME" "$S_PORTA" "$S_PROJ" "$S_LOG" "$S_SERVER"
S_STATUS="$_STATUS" ; S_PID="$_PID"

# ======= Abre navegador =======
echo "" | tee -a "$LOG_FILE"
echo "🌐 Abrindo navegador (2 abas)..." | tee -a "$LOG_FILE"
if [ "$C_STATUS" = "ONLINE" ]; then
  /usr/bin/open "$C_URL" 2>/dev/null || true
  echo "   → $C_URL" | tee -a "$LOG_FILE"
fi
if [ "$S_STATUS" = "ONLINE" ]; then
  sleep 0.4
  /usr/bin/open "$S_URL" 2>/dev/null || true
  echo "   → $S_URL" | tee -a "$LOG_FILE"
fi

# ======= Banner final =======
echo "" | tee -a "$LOG_FILE"
echo "╔═══════════════════════════════════════════════════════════════╗" | tee -a "$LOG_FILE"
echo "║                       RESULTADO FINAL                       ║" | tee -a "$LOG_FILE"
echo "╠═══════════════════════════════════════════════════════════════╣" | tee -a "$LOG_FILE"
printf "║  Criador  3000  │ %-8s  │ PID  %-8s                  ║\n" "$C_STATUS" "$C_PID" | tee -a "$LOG_FILE"
printf "║  Security 3400  │ %-8s  │ PID  %-8s                  ║\n" "$S_STATUS" "$S_PID" | tee -a "$LOG_FILE"
echo "╠═══════════════════════════════════════════════════════════════╣" | tee -a "$LOG_FILE"
echo "║  🏷️  RELEASES ativas (camadas empilhadas):                   ║" | tee -a "$LOG_FILE"
echo "║  · RC20 · Google Gemini como motor DEV principal             ║" | tee -a "$LOG_FILE"
echo "║  · RC21 · Single-port /preview/:slug (mobile nuvem)         ║" | tee -a "$LOG_FILE"
echo "║  · RC22 · Pipeline 3-IA · Arquiteta/Dev/QA (Cerebras/Gemini/ ║" | tee -a "$LOG_FILE"
echo "║                  Mistral) fallback Gemini                   ║" | tee -a "$LOG_FILE"
echo "║  · RC23 · Tela chaves providers + backup tar.gz obrigatório ║" | tee -a "$LOG_FILE"
echo "║  · RC24 · AGENT ORCHESTRATOR (camada ACIMA do RC22)          ║" | tee -a "$LOG_FILE"
echo "╠═══════════════════════════════════════════════════════════════╣" | tee -a "$LOG_FILE"
echo "║  🧭 RC24 · Endpoints REST do Orquestrador (projetos agent__*):║" | tee -a "$LOG_FILE"
echo "║  POST /api/agent/create                          · criar     ║" | tee -a "$LOG_FILE"
echo "║  GET  /api/agent/:slug                           · ver spec  ║" | tee -a "$LOG_FILE"
echo "║  PUT  /api/agent/:slug/spec                      · versão    ║" | tee -a "$LOG_FILE"
echo "║  GET  /api/agent/:slug/versions  +  /compare?a&b · diff      ║" | tee -a "$LOG_FILE"
echo "║  GET/POST /api/agent/:slug/state                 · estado    ║" | tee -a "$LOG_FILE"
echo "║  GET  /api/agent/:slug/capabilities              · tools     ║" | tee -a "$LOG_FILE"
echo "║  POST /api/agent/:slug/build                     · RC22 build║" | tee -a "$LOG_FILE"
echo "║  POST /api/agent/:slug/audit                     · Security  ║" | tee -a "$LOG_FILE"
echo "║  POST /api/agent/:slug/security/apply            · whitelist ║" | tee -a "$LOG_FILE"
echo "║  GET/POST /api/agent/:slug/conversation/*        · memória   ║" | tee -a "$LOG_FILE"
echo "╠═══════════════════════════════════════════════════════════════╣" | tee -a "$LOG_FILE"
echo "║  💬 Slash commands (no chat do Criador, precisa agent__…):    ║" | tee -a "$LOG_FILE"
echo "║    /build   /audit   /estado [val]   /agente   /memoria      ║" | tee -a "$LOG_FILE"
echo "║    /resumo  /tools   /versao          /help                  ║" | tee -a "$LOG_FILE"
echo "╠═══════════════════════════════════════════════════════════════╣" | tee -a "$LOG_FILE"
echo "║  💡  Para PARAR TUDO: duplo clique em  stop-all.command    ║" | tee -a "$LOG_FILE"
echo "║      Ou shell: lsof -ti :3000 :3400 | xargs kill -9        ║" | tee -a "$LOG_FILE"
echo "╚═══════════════════════════════════════════════════════════════╝" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

read -r -p "Pressione Enter para fechar esta janela (os 2 servidores CONTINUAM rodando!)…" _
exit 0
