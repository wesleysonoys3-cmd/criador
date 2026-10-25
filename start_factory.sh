#!/bin/bash
# ============================================================
#  start_factory.sh — Inicializador FÁBRICA MULTI-EMPRESAS
#  TiAgente Criador  +  TiAgente Security
#  Compatível: Bash 3.2+ (macOS Darwin) e Bash 4+ (Linux)
# ============================================================

set -u

# --------- Caminhos base ---------
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR" || { echo "ERRO: não foi para $SCRIPT_DIR"; exit 1; }

# Node portátil (preferencial) + fallback sistema
if [ -x "./node-v22.14.0-darwin-x64/bin/node" ]; then
  NODE_BIN="$SCRIPT_DIR/node-v22.14.0-darwin-x64/bin/node"
elif command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
else
  echo "❌ Node.js não encontrado. Instale o Node 20+ ou use o binário portátil."
  exit 2
fi
echo "ℹ️  Node binário: $NODE_BIN"
$NODE_BIN --version

# --------- Pastas obrigatórias ---------
echo ""
echo "📂 Garantindo pastas da Fábrica..."
mkdir -p "$SCRIPT_DIR/workspace" 2>/dev/null
mkdir -p "$SCRIPT_DIR/audits"    2>/dev/null
mkdir -p "$SCRIPT_DIR/backups"   2>/dev/null
mkdir -p "$SCRIPT_DIR/public"    2>/dev/null
mkdir -p "$SCRIPT_DIR/audio_tmp" 2>/dev/null
mkdir -p "$SCRIPT_DIR/TiAgente-Security/audits"  2>/dev/null
mkdir -p "$SCRIPT_DIR/TiAgente-Security/backups" 2>/dev/null
echo "   ✅ workspace, audits, backups, public, audio_tmp"

# --------- .env principal (Criador) ---------
ENV_FILE="$SCRIPT_DIR/.env"
ENV_SECURITY="$SCRIPT_DIR/TiAgente-Security/.env"
echo ""
echo "🔐 Verificando .env da Fábrica (Criador)..."
if [ ! -f "$ENV_FILE" ]; then
  echo "   ⚠️  .env não existe. Criando modelo..."
  cat > "$ENV_FILE" <<'ENVEOF'
# ===== FÁBRICA TIAGENTE - .env principal =====
PORT=3000
PIPELINE_3IA=on
WORKSPACE_DIR=./workspace
PUBLIC_DIR=./public
AUDIO_TMP_DIR=./audio_tmp

# ===== Provedores IA =====
GOOGLE_API_KEY=
GEMINI_API_KEY=
CEREBRAS_API_KEY=
MISTRAL_API_KEY=
OPENROUTER_API_KEY=
DEEPSEEK_API_KEY=

# ===== Provedores IA (Pipeline RC22 3-IA) =====
ARCH_PROVIDER=cerebras
ARCH_MODEL=llama-3.1-70b
DEV_PROVIDER=gemini
DEV_MODEL=gemini-3.5-flash-lite
QA_PROVIDER=mistral
QA_MODEL=open-mistral-nemo

# ===== WhatsApp Evolux (Cliente Oficial evolux_whatsapp_api.js) =====
EVOLUX_API_URL=https://api.evolux.com.br/v1
EVOLUX_API_KEY=sua_chave_aqui
EVOLUX_INSTANCE_ID=sua_instancia_aqui
EVOLUX_WEBHOOK_SECRET=seu_token_webhook

# ===== WhatsApp Evolux (Compatibilidade legada whatsapp_automation_engine.js) =====
WHATSAPP_EVOLUX_API_KEY=
WHATSAPP_EVOLUX_INSTANCE_ID=
WHATSAPP_EVOLUX_WEBHOOK_SECRET=

# ===== WhatsApp WATI.io (Cliente Oficial wati_whatsapp_api.js) =====
WATI_API_URL=https://wati.pro
WATI_API_TOKEN=
WATI_INSTANCE_NAME=
WATI_DEVICE_ID=
WATI_WEBHOOK_SECRET=

# ===== Integração =====
TIAGENTE_CRIADOR_URL=http://127.0.0.1:3000
TIAGENTE_SECURITY_URL=http://127.0.0.1:3400

# ===== Auto-fix Segurança =====
SECURITY_AUTO_FIX_CRITICAL=true
SECURITY_AUTO_APPLY_NON_CRITICAL=true
ENVEOF
  chmod 600 "$ENV_FILE"
  echo "   ✅ .env modelo criado em: $ENV_FILE"
  echo "   🚨 EDITE AGORA: GOOGLE_API_KEY/GEMINI_API_KEY e EVOLUX_API_KEY + EVOLUX_INSTANCE_ID antes do primeiro uso."
fi

# --------- Verifica flags auto-fix + chaves Evolux/Gemini no .env existente (adiciona se faltar) ---------
_ADICIONOU_ENV=0
_BLOCO_EVOLUX_ADICIONADO=0
if [ -f "$ENV_FILE" ]; then
  if ! grep -Eq '^SECURITY_AUTO_FIX_CRITICAL=' "$ENV_FILE" 2>/dev/null; then
    echo "" >> "$ENV_FILE"
    echo "# ===== Auto-fix Segurança (auto-adicionado pelo start_factory) =====" >> "$ENV_FILE"
    echo "SECURITY_AUTO_FIX_CRITICAL=true" >> "$ENV_FILE"
    _ADICIONOU_ENV=1
  fi
  if ! grep -Eq '^SECURITY_AUTO_APPLY_NON_CRITICAL=' "$ENV_FILE" 2>/dev/null; then
    echo "SECURITY_AUTO_APPLY_NON_CRITICAL=true" >> "$ENV_FILE"
    _ADICIONOU_ENV=1
  fi

  if ! grep -Eq '^GEMINI_API_KEY=' "$ENV_FILE" 2>/dev/null; then
    _G_FROM_GOOGLE=""
    if command -v grep >/dev/null 2>&1; then
      _G_FROM_GOOGLE=$(grep -E '^GOOGLE_API_KEY=' "$ENV_FILE" 2>/dev/null | head -1 | sed 's/^GOOGLE_API_KEY=//') || _G_FROM_GOOGLE=""
    fi
    if [ "$_BLOCO_EVOLUX_ADICIONADO" = "0" ]; then
      echo "" >> "$ENV_FILE"
      echo "# ===== Provedor IA (auto-adicionado pelo start_factory · compatibilidade Gemini) =====" >> "$ENV_FILE"
      _BLOCO_EVOLUX_ADICIONADO=1
    fi
    echo "GEMINI_API_KEY=${_G_FROM_GOOGLE}" >> "$ENV_FILE"
    _ADICIONOU_ENV=1
  fi

  _TEM_EV_URL=0; _TEM_EV_KEY=0; _TEM_EV_INST=0; _TEM_EV_SEC=0
  grep -Eq '^EVOLUX_API_URL=' "$ENV_FILE" 2>/dev/null && _TEM_EV_URL=1
  grep -Eq '^EVOLUX_API_KEY=' "$ENV_FILE" 2>/dev/null && _TEM_EV_KEY=1
  grep -Eq '^EVOLUX_INSTANCE_ID=' "$ENV_FILE" 2>/dev/null && _TEM_EV_INST=1
  grep -Eq '^EVOLUX_WEBHOOK_SECRET=' "$ENV_FILE" 2>/dev/null && _TEM_EV_SEC=1
  if [ "$_TEM_EV_URL" = "0" ] || [ "$_TEM_EV_KEY" = "0" ] || [ "$_TEM_EV_INST" = "0" ] || [ "$_TEM_EV_SEC" = "0" ]; then
    if [ "$_BLOCO_EVOLUX_ADICIONADO" = "0" ]; then
      echo "" >> "$ENV_FILE"
      echo "# ===== WhatsApp Evolux (auto-adicionado pelo start_factory · cliente oficial evolux_whatsapp_api.js) =====" >> "$ENV_FILE"
      _BLOCO_EVOLUX_ADICIONADO=1
    fi
    if [ "$_TEM_EV_URL" = "0" ]; then
      echo "EVOLUX_API_URL=https://api.evolux.com.br/v1" >> "$ENV_FILE"
      _ADICIONOU_ENV=1
    fi
    if [ "$_TEM_EV_KEY" = "0" ]; then
      _WA_KEY=""
      if command -v grep >/dev/null 2>&1; then
        _WA_KEY=$(grep -E '^WHATSAPP_EVOLUX_API_KEY=' "$ENV_FILE" 2>/dev/null | head -1 | sed 's/^WHATSAPP_EVOLUX_API_KEY=//') || _WA_KEY=""
      fi
      if [ -n "$_WA_KEY" ]; then
        echo "EVOLUX_API_KEY=${_WA_KEY}  # copiado de WHATSAPP_EVOLUX_API_KEY (compatibilidade)" >> "$ENV_FILE"
      else
        echo "EVOLUX_API_KEY=sua_chave_aqui" >> "$ENV_FILE"
      fi
      _ADICIONOU_ENV=1
    fi
    if [ "$_TEM_EV_INST" = "0" ]; then
      _WA_INST=""
      if command -v grep >/dev/null 2>&1; then
        _WA_INST=$(grep -E '^WHATSAPP_EVOLUX_INSTANCE_ID=' "$ENV_FILE" 2>/dev/null | head -1 | sed 's/^WHATSAPP_EVOLUX_INSTANCE_ID=//') || _WA_INST=""
      fi
      if [ -n "$_WA_INST" ]; then
        echo "EVOLUX_INSTANCE_ID=${_WA_INST}  # copiado de WHATSAPP_EVOLUX_INSTANCE_ID (compatibilidade)" >> "$ENV_FILE"
      else
        echo "EVOLUX_INSTANCE_ID=sua_instancia_aqui" >> "$ENV_FILE"
      fi
      _ADICIONOU_ENV=1
    fi
    if [ "$_TEM_EV_SEC" = "0" ]; then
      _WA_WH=""
      if command -v grep >/dev/null 2>&1; then
        _WA_WH=$(grep -E '^WHATSAPP_EVOLUX_WEBHOOK_SECRET=' "$ENV_FILE" 2>/dev/null | head -1 | sed 's/^WHATSAPP_EVOLUX_WEBHOOK_SECRET=//') || _WA_WH=""
      fi
      if [ -n "$_WA_WH" ]; then
        echo "EVOLUX_WEBHOOK_SECRET=${_WA_WH}  # copiado de WHATSAPP_EVOLUX_WEBHOOK_SECRET (compatibilidade)" >> "$ENV_FILE"
      else
        echo "EVOLUX_WEBHOOK_SECRET=seu_token_webhook" >> "$ENV_FILE"
      fi
      _ADICIONOU_ENV=1
    fi
  fi

  # --------- WATI.io (auto-adicionado se faltar) ---------
  _TEM_WT_URL=0; _TEM_WT_TOKEN=0; _TEM_WT_NAME=0; _TEM_WT_DEV=0; _TEM_WT_SEC=0
  grep -Eq '^WATI_API_URL=' "$ENV_FILE" 2>/dev/null && _TEM_WT_URL=1
  grep -Eq '^WATI_API_TOKEN=' "$ENV_FILE" 2>/dev/null && _TEM_WT_TOKEN=1
  grep -Eq '^WATI_INSTANCE_NAME=' "$ENV_FILE" 2>/dev/null && _TEM_WT_NAME=1
  grep -Eq '^WATI_DEVICE_ID=' "$ENV_FILE" 2>/dev/null && _TEM_WT_DEV=1
  grep -Eq '^WATI_WEBHOOK_SECRET=' "$ENV_FILE" 2>/dev/null && _TEM_WT_SEC=1
  if [ "$_TEM_WT_URL" = "0" ] || [ "$_TEM_WT_TOKEN" = "0" ] || [ "$_TEM_WT_NAME" = "0" ] || [ "$_TEM_WT_DEV" = "0" ] || [ "$_TEM_WT_SEC" = "0" ]; then
    if [ "$_BLOCO_EVOLUX_ADICIONADO" = "0" ]; then
      echo "" >> "$ENV_FILE"
      echo "# ===== WhatsApp WATI.io (auto-adicionado pelo start_factory · cliente oficial wati_whatsapp_api.js) =====" >> "$ENV_FILE"
      _BLOCO_EVOLUX_ADICIONADO=1
    fi
    if [ "$_TEM_WT_URL" = "0" ]; then
      echo "WATI_API_URL=https://wati.pro" >> "$ENV_FILE"
      _ADICIONOU_ENV=1
    fi
    if [ "$_TEM_WT_TOKEN" = "0" ]; then
      echo "WATI_API_TOKEN=" >> "$ENV_FILE"
      _ADICIONOU_ENV=1
    fi
    if [ "$_TEM_WT_NAME" = "0" ]; then
      echo "WATI_INSTANCE_NAME=" >> "$ENV_FILE"
      _ADICIONOU_ENV=1
    fi
    if [ "$_TEM_WT_DEV" = "0" ]; then
      echo "WATI_DEVICE_ID=  # opcional: UUID do dispositivo conectado no WATI" >> "$ENV_FILE"
      _ADICIONOU_ENV=1
    fi
    if [ "$_TEM_WT_SEC" = "0" ]; then
      echo "WATI_WEBHOOK_SECRET=  # opcional: HMAC SHA256 p/ verificar x-webhook-signature" >> "$ENV_FILE"
      _ADICIONOU_ENV=1
    fi
  fi
fi
if [ "$_ADICIONOU_ENV" = "1" ]; then
  echo "   ✅ Atualizadas variáveis Evolux/WATI/Gemini/Segurança no .env principal (auto-adicionadas se faltavam)."
fi

# --------- .env Security (isolado) ---------
if [ ! -f "$ENV_SECURITY" ] && [ -d "$SCRIPT_DIR/TiAgente-Security" ]; then
  echo "🔐 Copiando chave Google para .env isolado do Security (se existir)..."
  GOOGLE_PREFIXADA="grep ^GOOGLE_API_KEY= \"$ENV_FILE\" 2>/dev/null | head -1 || true"
  GVAL=$(eval "$GOOGLE_PREFIXADA") || GVAL=""
  cat > "$ENV_SECURITY" <<ENVEOF
PORT=3400
AUDITS_DIR=./audits
BACKUPS_DIR=./backups
CRIADOR_WORKSPACE=../workspace
${GVAL:-#GOOGLE_API_KEY=}
SECURITY_AUTO_FIX_CRITICAL=true
SECURITY_AUTO_APPLY_NON_CRITICAL=true
ENVEOF
  chmod 600 "$ENV_SECURITY"
  echo "   ✅ .env do Security criado com SECURITY_AUTO_*."
fi

if [ -f "$ENV_SECURITY" ]; then
  _ADD_SEC=0
  if ! grep -Eq '^SECURITY_AUTO_FIX_CRITICAL=' "$ENV_SECURITY" 2>/dev/null; then
    echo "SECURITY_AUTO_FIX_CRITICAL=true" >> "$ENV_SECURITY"
    _ADD_SEC=1
  fi
  if ! grep -Eq '^SECURITY_AUTO_APPLY_NON_CRITICAL=' "$ENV_SECURITY" 2>/dev/null; then
    echo "SECURITY_AUTO_APPLY_NON_CRITICAL=true" >> "$ENV_SECURITY"
    _ADD_SEC=1
  fi
  [ "$_ADD_SEC" = "1" ] && echo "   ✅ Flags SECURITY_AUTO_* garantidas no .env do Security."
fi

# --------- Validação chaves mínimas ---------
echo ""
echo "🔑 Validação de chaves mínimas:"
_GOOGLE_OK=0; _GEMINI_OK=0; _EVOLUX_OK=0; _WA_EVOLUX_OK=0
grep -q '^GOOGLE_API_KEY=AQ\.' "$ENV_FILE" 2>/dev/null && _GOOGLE_OK=1
(grep -Eq '^GEMINI_API_KEY=AQ\.|^GEMINI_API_KEY=AIza' "$ENV_FILE" 2>/dev/null) || grep -Eq '^GEMINI_API_KEY=.+' "$ENV_FILE" 2>/dev/null && _GEMINI_OK=1
grep -Eq '^EVOLUX_API_KEY=.+' "$ENV_FILE" 2>/dev/null && [ "$(grep -E '^EVOLUX_API_KEY=' "$ENV_FILE" 2>/dev/null | head -1 | sed 's/^EVOLUX_API_KEY=//;s/  *#.*$//' | tr -d '[:space:]')" != "sua_chave_aqui" ] && _EVOLUX_OK=1
grep -Eq '^WHATSAPP_EVOLUX_API_KEY=.+' "$ENV_FILE" 2>/dev/null && _WA_EVOLUX_OK=1

if [ "$_GOOGLE_OK" = "1" ]; then
  echo "   ✅ GOOGLE_API_KEY  (Gemini/STT/TTS) configurada"
else
  echo "   ⚠️  GOOGLE_API_KEY não configurada — STT/TTS e Gemini vão usar fallback local."
fi
if [ "$_GEMINI_OK" = "1" ]; then
  _G_VAL=$(grep -E '^GEMINI_API_KEY=' "$ENV_FILE" 2>/dev/null | head -1 | sed 's/^GEMINI_API_KEY=//' | tr -d '[:space:]' | sed 's/^.\{4\}/****/' | sed 's/.\{4\}$/****/')
  [ "${#_G_VAL}" -le 8 ] && _G_VAL="***mascarado***"
  echo "   ✅ GEMINI_API_KEY   (alias Gemini)        · ${_G_VAL}"
else
  echo "   ⚠️  GEMINI_API_KEY não configurada (alias para GOOGLE_API_KEY)."
fi
if [ "$_EVOLUX_OK" = "1" ]; then
  _EV_KEY=$(grep -E '^EVOLUX_API_KEY=' "$ENV_FILE" 2>/dev/null | head -1 | sed 's/^EVOLUX_API_KEY=//;s/  *#.*$//' | tr -d '[:space:]')
  [ "${#_EV_KEY}" -gt 8 ] && _EV_KEY="$(printf '%s' "$_EV_KEY" | sed 's/^.\{4\}/****/;s/.\{4\}$/****/')"
  _EV_INST=$(grep -E '^EVOLUX_INSTANCE_ID=' "$ENV_FILE" 2>/dev/null | head -1 | sed 's/^EVOLUX_INSTANCE_ID=//;s/  *#.*$//' | tr -d '[:space:]')
  [ "${#_EV_INST}" -gt 8 ] && _EV_INST="$(printf '%s' "$_EV_INST" | sed 's/^.\{4\}/****/;s/.\{4\}$/****/')"
  echo "   ✅ EVOLUX_API_KEY + EVOLUX_INSTANCE_ID    · Key=${_EV_KEY:-vazia} · Inst=${_EV_INST:-vazia}"
elif [ "$_WA_EVOLUX_OK" = "1" ]; then
  echo "   ✅ WHATSAPP_EVOLUX_API_KEY configurada (compatibilidade legada · recomendamos migrar para EVOLUX_*)."
else
  echo "   ⚠️  Nenhuma chave Evolux encontrada (EVOLUX_API_KEY / WHATSAPP_EVOLUX_API_KEY vazias ou com valor placeholder). Envios WhatsApp vão falhar."
fi
if grep -Eq '^EVOLUX_API_URL=https?://' "$ENV_FILE" 2>/dev/null; then
  echo "   ℹ️  EVOLUX_API_URL = $(grep -E '^EVOLUX_API_URL=' "$ENV_FILE" | head -1 | sed 's/^EVOLUX_API_URL=//;s/  *#.*$//')"
fi

# --------- WATI.io validação ---------
_WATI_OK=0
_WT_VAL=$(grep -E '^WATI_API_TOKEN=' "$ENV_FILE" 2>/dev/null | head -1 | sed 's/^WATI_API_TOKEN=//;s/  *#.*$//' | tr -d '[:space:]')
if [ -n "$_WT_VAL" ] && [ "$_WT_VAL" != "sua_chave_aqui" ]; then _WATI_OK=1; fi
_WATI_INST=$(grep -E '^WATI_INSTANCE_NAME=' "$ENV_FILE" 2>/dev/null | head -1 | sed 's/^WATI_INSTANCE_NAME=//;s/  *#.*$//' | tr -d '[:space:]')

if [ "$_WATI_OK" = "1" ]; then
  _WT_LEN=${#_WT_VAL}
  if command -v awk >/dev/null 2>&1 && [ "$_WT_LEN" -gt 8 ]; then
    _WT_MASK=$(printf '%s' "$_WT_VAL" | awk '{print substr($0,1,4)"…"substr($0,length($0)-3,4)}')
  else
    _WT_MASK=$(printf '%s' "$_WT_VAL" | sed 's/^.\{4\}/****/;s/.\{4\}$/****/')
    [ "${#_WT_MASK}" -le 8 ] && _WT_MASK="***mascarado***"
  fi
  echo "   ✅ WATI.io (instância ${_WATI_INST:-não-nomeada}) · token ${_WT_MASK}"
else
  echo "   ⚠️  WATI_API_TOKEN não configurada (caso use WATI.io em vez de Evolux)."
fi
if grep -Eq '^WATI_API_URL=https?://' "$ENV_FILE" 2>/dev/null; then
  echo "   ℹ️  WATI_API_URL   = $(grep -E '^WATI_API_URL=' "$ENV_FILE" | head -1 | sed 's/^WATI_API_URL=//;s/  *#.*$//')"
fi

# --------- PID traps ---------
CRIADOR_PID=""
SECURITY_PID=""
VOICE_PID=""

mata_na_porta_wrapper() {
  _L="$1"
  shift
  for _PORTA in "$@"; do
    _PIDS=""
    if command -v lsof >/dev/null 2>&1; then
      _PIDS=$(lsof -nP -iTCP:"$_PORTA" -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $2}' | sort -u) || true
    fi
    if [ -z "$_PIDS" ] && command -v fuser >/dev/null 2>&1; then
      _PIDS=$(fuser "${_PORTA}/tcp" 2>/dev/null | tr -s ' ' '\n' | grep -E '^[0-9]+$' | sort -u) || true
    fi
    if [ -n "$_PIDS" ]; then
      for _P in $_PIDS; do
        _NOME=""
        if command -v ps >/dev/null 2>&1; then
          _NOME=" ($(ps -o comm= -p "$_P" 2>/dev/null || echo "pid $_P"))"
        fi
        echo "   · kill -TERM ${_P}${_NOME} → porta ${_PORTA}"
        kill -TERM "$_P" 2>/dev/null || true
      done
      sleep 1
      for _P in $_PIDS; do
        if kill -0 "$_P" 2>/dev/null; then
          echo "   · kill -KILL ${_P} (hard cleanup) → porta ${_PORTA}"
          kill -KILL "$_P" 2>/dev/null || true
        fi
      done
    else
      echo "   · porta ${_PORTA}: livre ✅"
    fi
  done
}
porta_em_uso() {
  _P2="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$_P2" -sTCP:LISTEN >/dev/null 2>&1 && return 0
  fi
  if command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$_P2" >/dev/null 2>&1 && return 0
  fi
  return 1
}

echo ""
echo "🧹 Limpeza prévia: matando processos antigos nas portas..."
mata_na_porta_wrapper "ambas" 3400 3000 3005
sleep 0.5

limpa_tudo() {
  echo ""
  echo "🛑 Encerrando fábrica (SIGINT/SIGTERM recebido)..."
  if [ -n "$CRIADOR_PID" ] && kill -0 "$CRIADOR_PID" 2>/dev/null; then
    echo "   - Finalizando TiAgente Criador (PID $CRIADOR_PID)..."
    kill -TERM "$CRIADOR_PID" 2>/dev/null
    sleep 1
    kill -KILL "$CRIADOR_PID" 2>/dev/null
  fi
  if [ -n "$SECURITY_PID" ] && kill -0 "$SECURITY_PID" 2>/dev/null; then
    echo "   - Finalizando TiAgente Security (PID $SECURITY_PID)..."
    kill -TERM "$SECURITY_PID" 2>/dev/null
    sleep 1
    kill -KILL "$SECURITY_PID" 2>/dev/null
  fi
  if [ -n "$VOICE_PID" ] && kill -0 "$VOICE_PID" 2>/dev/null; then
    echo "   - Finalizando TiAgente Voice REST (PID $VOICE_PID)..."
    kill -TERM "$VOICE_PID" 2>/dev/null
    sleep 1
    kill -KILL "$VOICE_PID" 2>/dev/null
  fi
  mata_na_porta_wrapper "final" 3000 3400 3005
  echo "✅ Fábrica encerrada. Até logo!"
  exit 0
}
trap limpa_tudo INT TERM HUP QUIT

# --------- Subida TiAgente Security ---------
echo ""
echo "🚀 Iniciando TiAgente Security (porta 3400)..."
SEC_LOG="$SCRIPT_DIR/log_security_$(date +%Y%m%d).log"
cd "$SCRIPT_DIR/TiAgente-Security" 2>/dev/null || true
nohup "$NODE_BIN" server.js >>"$SEC_LOG" 2>&1 &
SECURITY_PID=$!
echo "$SECURITY_PID" > /tmp/fab_security.pid
cd "$SCRIPT_DIR" 2>/dev/null || true
echo "   · PID: $SECURITY_PID · log: $SEC_LOG"

# --------- Subida TiAgente Criador ---------
echo ""
echo "🚀 Iniciando TiAgente Criador (porta 3000)..."
CRI_LOG="$SCRIPT_DIR/log_criador_$(date +%Y%m%d).log"
cd "$SCRIPT_DIR" || true
{
  while true; do
    echo "[start_factory] Ligando TiAgente..."

    "$NODE_BIN" server.js 2>&1 | tee -a "$CRI_LOG"

    EXIT_CODE=${PIPESTATUS[0]}

    echo "[start_factory] TiAgente encerrou (code=$EXIT_CODE). Reiniciando em 3s..."

    sleep 3
  done
} >>"$CRI_LOG" 2>&1 &
CRIADOR_PID=$!
echo "$CRIADOR_PID" > /tmp/fab_criador.pid
echo "   · PID: $CRIADOR_PID · log: $CRI_LOG"

# --------- Subida TiAgente Voice REST ---------
echo ""
echo "🚀 Iniciando TiAgente Voice REST (porta 3005)..."
VOICE_LOG="$SCRIPT_DIR/log_voice_$(date +%Y%m%d).log"
cd "$SCRIPT_DIR" || true
nohup "$NODE_BIN" voice_rest_server.js >>"$VOICE_LOG" 2>&1 &
VOICE_PID=$!
echo "$VOICE_PID" > /tmp/fab_voice.pid
echo "   · PID: $VOICE_PID · log: $VOICE_LOG"

# --------- Espera listen ---------
echo ""
echo "⏳ Aguardando subida (até 12s)..."
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  sleep 1
  C_UP=0; S_UP=0; V_UP=0
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1 && C_UP=1
    lsof -iTCP:3400 -sTCP:LISTEN >/dev/null 2>&1 && S_UP=1
    lsof -iTCP:3005 -sTCP:LISTEN >/dev/null 2>&1 && V_UP=1
  fi
  if command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 3000 >/dev/null 2>&1 && C_UP=1
    nc -z 127.0.0.1 3400 >/dev/null 2>&1 && S_UP=1
    nc -z 127.0.0.1 3005 >/dev/null 2>&1 && V_UP=1
  fi
  if [ "$C_UP" = "1" ] && [ "$S_UP" = "1" ] && [ "$V_UP" = "1" ]; then
    echo "   ✅ Três serviços ouvindo após ${i}s."
    break
  fi
  printf "  +%ss " "$i"
done
echo ""

# --------- Banner final ---------
C_UP_FINAL=0; S_UP_FINAL=0; V_UP_FINAL=0
(command -v lsof >/dev/null 2>&1 && lsof -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1) || (command -v nc >/dev/null 2>&1 && nc -z 127.0.0.1 3000 >/dev/null 2>&1) || true
C_UP_FINAL=$?
(command -v lsof >/dev/null 2>&1 && lsof -iTCP:3400 -sTCP:LISTEN >/dev/null 2>&1) || (command -v nc >/dev/null 2>&1 && nc -z 127.0.0.1 3400 >/dev/null 2>&1) || true
S_UP_FINAL=$?
(command -v lsof >/dev/null 2>&1 && lsof -iTCP:3005 -sTCP:LISTEN >/dev/null 2>&1) || (command -v nc >/dev/null 2>&1 && nc -z 127.0.0.1 3005 >/dev/null 2>&1) || true
V_UP_FINAL=$?

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║  🏭 FÁBRICA MULTI-EMPRESAS TIAGENTE · PRONTA!             ║"
echo "╠════════════════════════════════════════════════════════════╣"
if [ "$C_UP_FINAL" = "0" ]; then
  echo "║  ✅ TiAgente CRIADOR  → http://localhost:3000  (PID $CRIADOR_PID)    ║"
else
  echo "║  ❌ TiAgente CRIADOR  → NÃO ESTÁ OUVINDO :( (ver $CRI_LOG)"
fi
if [ "$S_UP_FINAL" = "0" ]; then
  echo "║  ✅ TiAgente SECURITY → http://localhost:3400  (PID $SECURITY_PID)    ║"
else
  echo "║  ❌ TiAgente SECURITY → NÃO ESTÁ OUVINDO :( (ver $SEC_LOG)"
fi
if [ "$V_UP_FINAL" = "0" ]; then
  echo "║  ✅ TiAgente VOICE    → http://localhost:3005  (PID $VOICE_PID)    ║"
else
  echo "║  ❌ TiAgente VOICE    → NÃO ESTÁ OUVINDO :( (ver $VOICE_LOG)"
fi
echo "╠════════════════════════════════════════════════════════════╣"
echo "║  🎙️  VOZ UI: Botão MIC na interface 3000 → envia p/ 3005 ║"
echo "║  🎙️  VOZ REST: voice_rest_server.js porta 3005           ║"
echo "║  💬 WHATSAPP: whatsapp_automation_engine.js · Evolux API  ║"
echo "║  🔗 BRIDGE: integration_bridge.js · Security + QA Autofix ║"
echo "╠════════════════════════════════════════════════════════════╣"
echo "║  💡 Uso:                                                    ║"
echo "║   • Voz UI: Botão MIC em http://localhost:3000            ║"
echo "║   • Texto:  POST :3005/api/factory/text { texto: ... }     ║"
echo "║   • Voz:    POST :3005/api/voice/process FormData audio   ║"
echo "║   • Status: GET :3005/api/status + ping Criador/Security  ║"
echo "╠════════════════════════════════════════════════════════════╣"
echo "║  💡 Próximos passos obrigatórios (se ainda não fez):       ║"
echo "║   1) Preencher GOOGLE_API_KEY em .env                      ║"
echo "║   2) Preencher WHATSAPP_EVOLUX_API_KEY + INSTANCE_ID       ║"
echo "║   3) Abrir http://localhost:3000 e usar o MIC              ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "📝 Para encerrar: pressione CTRL+C, ou execute:"
echo "     kill -INT $CRIADOR_PID $SECURITY_PID $VOICE_PID"
echo ""

# --------- Aguardando (mantém script ativo para trap) ---------
echo "⏸️  Fábrica rodando em background. Aperte CTRL+C para finalizar TUDO cleanly."
ULTIMO_AVISO_CRI=""
ULTIMO_AVISO_SEC=""
ULTIMO_AVISO_VOZ=""
while true; do
  C_VIVO=0
  S_VIVO=0
  V_VIVO=0
  PORTA_C=0
  PORTA_S=0
  PORTA_V=0
  if [ -n "$CRIADOR_PID" ] && kill -0 "$CRIADOR_PID" 2>/dev/null; then C_VIVO=1; fi
  if [ -n "$SECURITY_PID" ] && kill -0 "$SECURITY_PID" 2>/dev/null; then S_VIVO=1; fi
  if [ -n "$VOICE_PID" ] && kill -0 "$VOICE_PID" 2>/dev/null; then V_VIVO=1; fi
  porta_em_uso 3000 && PORTA_C=1
  porta_em_uso 3400 && PORTA_S=1
  porta_em_uso 3005 && PORTA_V=1

  if [ "$C_VIVO" = "0" ] && [ "$PORTA_C" = "0" ]; then
    _M="CRIADOR PID $CRIADOR_PID morto E porta 3000 sem LISTEN. Cheque $CRI_LOG"
    if [ "$ULTIMO_AVISO_CRI" != "$_M" ]; then
      echo "⚠️  TiAgente $_M"
      ULTIMO_AVISO_CRI="$_M"
    fi
  elif [ "$C_VIVO" = "0" ] && [ "$PORTA_C" = "1" ]; then
    _M="CRIADOR PID $CRIADOR_PID morreu mas porta 3000 AINDA está ativa (outro PID? rodou bem)"
    if [ "$ULTIMO_AVISO_CRI" != "$_M" ]; then
      echo "ℹ️  $_M"
      ULTIMO_AVISO_CRI="$_M"
    fi
  else
    ULTIMO_AVISO_CRI=""
  fi

  if [ "$S_VIVO" = "0" ] && [ "$PORTA_S" = "0" ]; then
    _M="SECURITY PID $SECURITY_PID morto E porta 3400 sem LISTEN. Cheque $SEC_LOG"
    if [ "$ULTIMO_AVISO_SEC" != "$_M" ]; then
      echo "⚠️  TiAgente $_M"
      ULTIMO_AVISO_SEC="$_M"
    fi
  elif [ "$S_VIVO" = "0" ] && [ "$PORTA_S" = "1" ]; then
    _M="SECURITY PID $SECURITY_PID morreu mas porta 3400 AINDA está ativa (outro PID? rodou bem)"
    if [ "$ULTIMO_AVISO_SEC" != "$_M" ]; then
      echo "ℹ️  $_M"
      ULTIMO_AVISO_SEC="$_M"
    fi
  else
    ULTIMO_AVISO_SEC=""
  fi

  if [ "$V_VIVO" = "0" ] && [ "$PORTA_V" = "0" ]; then
    _M="VOICE PID $VOICE_PID morto E porta 3005 sem LISTEN. Cheque $VOICE_LOG"
    if [ "$ULTIMO_AVISO_VOZ" != "$_M" ]; then
      echo "⚠️  TiAgente $_M"
      ULTIMO_AVISO_VOZ="$_M"
    fi
  elif [ "$V_VIVO" = "0" ] && [ "$PORTA_V" = "1" ]; then
    _M="VOICE PID $VOICE_PID morreu mas porta 3005 AINDA está ativa (outro PID? rodou bem)"
    if [ "$ULTIMO_AVISO_VOZ" != "$_M" ]; then
      echo "ℹ️  $_M"
      ULTIMO_AVISO_VOZ="$_M"
    fi
  else
    ULTIMO_AVISO_VOZ=""
  fi
  sleep 8
done
