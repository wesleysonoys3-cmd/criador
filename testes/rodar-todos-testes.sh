#!/bin/bash
# ============================================================
#  rodar-todos-testes.sh · Master test runner RC24
#  Uso: duplo clique (chmod +x) OU bash testes/rodar-todos-testes.sh
#  RODA 4 NÍVEIS: N1 motor → N2 REST → N3 build+security → N4 clínica E2E
# ============================================================
set +e
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$HERE/.." && pwd)"
LOG="$ROOT_DIR/testes/resultados.log"
NODE_BIN=""

# ===== encontra node portátil ou system node =====
for cand in "$ROOT_DIR"/node-v*-darwin-*/bin/node; do
  [ -x "$cand" ] && NODE_BIN="$cand" && break
done
if [ -z "$NODE_BIN" ] && command -v node >/dev/null 2>&1; then NODE_BIN="$(command -v node)"; fi
if [ -z "$NODE_BIN" ]; then
  echo "❌ Node não encontrado. Esperava $ROOT_DIR/node-v22.14.0-darwin-x64/bin/node"
  read -r -p "Enter para sair…" _ ; exit 2
fi
export PATH="$(dirname "$NODE_BIN"):$PATH"

# ===== banner =====
: > "$LOG"
{
  echo ""
  echo "╔════════════════════════════════════════════════════════════════════╗"
  echo "║  RC24 · TESTES AUTOMÁTICOS · 4 NÍVEIS (N1→N2→N3→N4)             ║"
  echo "╚════════════════════════════════════════════════════════════════════╝"
  echo "🕒 $(date '+%Y-%m-%d %H:%M:%S') Node: $("$NODE_BIN" --version)  ($NODE_BIN)"
  echo "    N1 = motor puro (sem servidor) · N2 = REST endpoints · N3 = build/security · N4 = clínica E2E"
  echo ""
} | tee "$LOG"

# ===== helper =====
export RESULTADOS=()
rodar_nivel() {
  local n="$1" nome="$2" arq="$3"
  echo "┌──────────────────────────────────────────────────────────────┐" | tee -a "$LOG"
  echo "│  🧪 NÍVEL $n · $nome" | tee -a "$LOG"
  echo "└──────────────────────────────────────────────────────────────┘" | tee -a "$LOG"
  cd "$ROOT_DIR"
  "$NODE_BIN" "$arq" 2>&1 | tee -a "$LOG"
  local rc=${PIPESTATUS[0]}
  if [ "$rc" = "0" ]; then
    RESULTADOS+=("N$n ✅ PASSOU")
    echo "   → ✅ N$n passou." | tee -a "$LOG"
  else
    RESULTADOS+=("N$n ❌ FALHOU (exit=$rc)")
    echo "   → ❌ N$n FALHOU (exit=$rc). Veja o log em $LOG" | tee -a "$LOG"
  fi
  echo "" | tee -a "$LOG"
}

# ===== garante Criador up (necessário N2/N3/N4) =====
echo "▶  Verificando TiAgente Criador :3000..." | tee -a "$LOG"
if ! curl -sf http://127.0.0.1:3000/api/status >/dev/null 2>&1; then
  echo "   (Não está up. Vou subir Criador em background, log em /tmp/criador_testes_master.log...)" | tee -a "$LOG"
  (cd "$ROOT_DIR" && "$NODE_BIN" server.js > /tmp/criador_testes_master.log 2>&1 &)
  for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
    sleep 1
    if curl -sf http://127.0.0.1:3000/api/status >/dev/null 2>&1; then echo "   ✅ Criador up após ${i}s"; break; fi
  done
fi
(curl -sf http://127.0.0.1:3000/api/status >/dev/null 2>&1 && echo "   ✅ TiAgente Criador :3000 ONLINE" || echo "   ⚠️  Criador não está up.") | tee -a "$LOG"
echo "" | tee -a "$LOG"

# ===== Executa 4 níveis =====
rodar_nivel 1 "MOTOR ORQUESTRADOR (18 exports, funções puras, transições bloqueadas, whitelist)" "$ROOT_DIR/testes/n1-motor.mjs"
rodar_nivel 2 "REST AGENTE (create/spec/versions/compare/state/capabilities/conversation)" "$ROOT_DIR/testes/n2-rest.mjs"
rodar_nivel 3 "BUILD + SECURITY WHITELIST (plano forçado RC22 + apply SEC-HC-* only)" "$ROOT_DIR/testes/n3-build-security.mjs"
rodar_nivel 4 "E2E CLÍNICA VIDA & SAÚDE (8 TRs Task6: 3 mensagens, versões, build, audit, memória-estado separado)" "$ROOT_DIR/testes/n4-e2e-clinica.mjs"

# ===== banner final =====
{
  echo ""
  echo "╔════════════════════════════════════════════════════════════════════╗"
  echo "║                     📊 RESULTADO FINAL DOS TESTES                 ║"
  echo "╠════════════════════════════════════════════════════════════════════╣"
  for r in "${RESULTADOS[@]}"; do printf "║  %-66s║\n" "$r"; done
  echo "╠════════════════════════════════════════════════════════════════════╣"
  PASSOU=0; FALHOU=0
  for r in "${RESULTADOS[@]}"; do
    if echo "$r" | grep -q '✅'; then PASSOU=$((PASSOU+1)); else FALHOU=$((FALHOU+1)); fi
  done
  printf "║  ✅ PASSARAM: %-6d     ❌ FALHARAM: %-6d            %3d%%             ║\n" "$PASSOU" "$FALHOU" "$(( PASSOU*100/(PASSOU+FALHOU) ))"
  echo "╠════════════════════════════════════════════════════════════════════╣"
  printf "║  Log completo: %-52s║\n" "$LOG"
  echo "║  🧭 Proxima etapa: testes de navegador (manual abaixo)            ║"
  echo "╚════════════════════════════════════════════════════════════════════╝"
  echo ""
} | tee -a "$LOG"

FALHAS_GERAIS=0
for r in "${RESULTADOS[@]}"; do echo "$r" | grep -q '❌' && FALHAS_GERAIS=$((FALHAS_GERAIS+1)); done
echo ""
if [ "$FALHAS_GERAIS" = "0" ]; then echo "🎉 TODOS OS 4 NÍVEIS PASSARAM. RC24 VERDE."; else echo "⚠️  $FALHAS_GERAIS NÍVEIS FALHARAM — veja o log."; fi
echo ""

read -r -p "Pressione Enter para fechar esta janela…" _
exit $FALHAS_GERAIS
