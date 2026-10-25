#!/bin/bash
# ==========================================================================
#  stop-all — Launcher macOS (DUPLA CLIQUE)
#  Encerra TiAgente Criador (porta 3000) e TiAgente Security (porta 3400).
# ==========================================================================

set +e

LAUNCHER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "$LAUNCHER_DIR/server.js" ]; then
  PROJ_DIR="$LAUNCHER_DIR"
else
  PROJ_DIR="/Users/tiagosantos/Desktop/criador"
fi

LOG_FILE="$PROJ_DIR/stop-all.log"
: > "$LOG_FILE"

echo "" | tee -a "$LOG_FILE"
echo "╔═══════════════════════════════════════════════════════════════╗" | tee -a "$LOG_FILE"
echo "║   TiAgente · PARAR TUDO  (Criador 3000 + Security 3400)    ║" | tee -a "$LOG_FILE"
echo "╚═══════════════════════════════════════════════════════════════╝" | tee -a "$LOG_FILE"
echo "🕐 [$(date '+%H:%M:%S')]" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

function pids_da_porta {
  lsof -ti :"$1" 2>/dev/null | tr '\n' ' ' | sed 's/ $//'
}
function mata_porta {
  local porta="$1" nome="$2"
  local pids
  pids="$(pids_da_porta "$porta")"
  if [ -z "$pids" ]; then
    echo "  ⏭  $nome ($porta) — já estava desligado." | tee -a "$LOG_FILE"
    return 0
  fi
  echo "  ⏹  $nome ($porta) — encerrando PIDs: $pids" | tee -a "$LOG_FILE"
  kill -TERM $pids 2>/dev/null || true
  sleep 1
  # Se ainda estiver vivo após TERM, usar KILL
  sobrando="$(pids_da_porta "$porta")"
  if [ -n "$sobrando" ]; then
    echo "     Ainda vivo — forçando SIGKILL em $sobrando" | tee -a "$LOG_FILE"
    kill -9 $sobrando 2>/dev/null || true
    sleep 1
  fi
  # Confirma
  if pids_da_porta "$porta" | grep -q '[0-9]'; then
    echo "     ❌ Falha ao parar $nome. Tente manualmente: lsof -ti :$porta | xargs kill -9" | tee -a "$LOG_FILE"
    return 1
  fi
  echo "     ✅ Parado." | tee -a "$LOG_FILE"
  return 0
}

mata_porta 3400 "TiAgente Security"
mata_porta 3000 "TiAgente Criador"
# Tentar também previews (3001..3100) — só se existirem
for p in $(seq 3001 3040); do
  if lsof -i :"$p" -sTCP:LISTEN >/dev/null 2>&1; then
    mata_porta "$p" "Preview projeto (porta $p)"
  fi
done

echo "" | tee -a "$LOG_FILE"
echo "═════════════════  SITUAÇÃO ATUAL DAS PORTAS  ═════════════════" | tee -a "$LOG_FILE"
for p in 3000 3400; do
  vivo="$(pids_da_porta "$p")"
  if [ -n "$vivo" ]; then
    echo "  ❌ Porta $p  →  PID $vivo  AINDA RODANDO" | tee -a "$LOG_FILE"
  else
    echo "  ✅ Porta $p  →  LIVRE" | tee -a "$LOG_FILE"
  fi
done
echo "═══════════════════════════════════════════════════════════════" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "  💡 Para LIGAR tudo novamente: duplo clique em  start-all.command" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

read -r -p "Pressione Enter para fechar esta janela…" _
exit 0
