#!/bin/bash
# =========================================================
#  build_app.sh — Compila CriaSiteTiago.app macOS NATIVO
#  Inclui: Node portátil + código fonte + ícone + launcher
#  O .app É AUTO-CONTIDO (funciona em qualquer /Aplicativos)
# =========================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

APP_NAME="CriaSiteTiago"
APP_DIR="$ROOT/${APP_NAME}.app"
CONTENTS="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS/MacOS"
RES_DIR="$CONTENTS/Resources"
APP_CODE_DIR="$RES_DIR/app"        # <== TODO O PROJETO AQUI DENTRO DO BUNDLE
BINARY="$MACOS_DIR/${APP_NAME}"
INFO_PLIST="$CONTENTS/Info.plist"
PKGINFO="$CONTENTS/PkgInfo"
VERSION="1.2.0"                    # RC18: Explorer visível + Chat painel direito + Resizer drag
BUILD="120"

echo "🧱 Construindo ${APP_NAME}.app (versão ${VERSION} build ${BUILD})..."

# ---------- 0) Apagar placeholder .app que é arquivo vazio (se existir) ----------
if [ -e "$APP_DIR" ] && [ ! -d "$APP_DIR" ]; then
  rm -f "$APP_DIR"
  echo "  🗑️  Removido placeholder ${APP_NAME}.app (arquivo vazio)"
fi
rm -rf "$APP_DIR"
mkdir -p "$MACOS_DIR" "$RES_DIR" "$APP_CODE_DIR"

# ---------- 1) Copiar launcher binário (criaSiteTiago.sh) ----------
cp -p "$ROOT/criaSiteTiago.sh" "$BINARY"
chmod +x "$BINARY"
echo "  ✅ Launcher MacOS criado em: $BINARY"

# ---------- 2) Copiar TODO O PROJETO para Resources/app (app auto-contido) ----------
echo "  📦 Copiando código do projeto + node portátil para bundle..."
rsync -aH --partial \
  --exclude='CriaSiteTiago.app' \
  --exclude='CriaSiteTiago*.dmg' \
  --exclude='_mock_desktop' \
  --exclude='_icon_tmp.iconset' \
  --exclude='_icon_master_1024.png' \
  --exclude='_make_icon*.py' \
  --exclude='.trae/documents/*.md' \
  --exclude='*.log' \
  --exclude='node_modules' \
  "$ROOT/" "$APP_CODE_DIR/" 2>/dev/null || true

# Se por acaso não tiver rsync, fallback cp -R
if [ ! -f "$APP_CODE_DIR/server.js" ]; then
  cp -R "$ROOT" "$APP_CODE_DIR"
  rm -rf "$APP_CODE_DIR/CriaSiteTiago.app" "$APP_CODE_DIR"/*.dmg
fi

# Garantir permissões em node portátil + launcher interno
if ls "$APP_CODE_DIR"/node-v*-darwin-*/bin/node >/dev/null 2>&1; then
  chmod +x "$APP_CODE_DIR"/node-v*-darwin-*/bin/node
  echo "  ✅ Node portátil OK: $(ls "$APP_CODE_DIR"/node-v*-darwin-*/bin/node | head -1)"
fi
chmod +x "$APP_CODE_DIR"/*.sh 2>/dev/null || true

# Se não houver .env no bundle, copiar .env.example + pedir ao primeiro run para criar
if [ ! -f "$APP_CODE_DIR/.env" ] && [ -f "$ROOT/.env" ]; then
  cp -p "$ROOT/.env" "$APP_CODE_DIR/.env"
  echo "  ✅ GOOGLE_API_KEY copiada para dentro do bundle (.env)"
elif [ ! -f "$APP_CODE_DIR/.env" ] && [ -f "$ROOT/.env.example" ]; then
  cp -p "$ROOT/.env.example" "$APP_CODE_DIR/.env"
  echo "  ⚠️  .env não encontrado — usando .env.example (usuário precisa colocar a chave)"
fi
echo "  ✅ Projeto empacotado em: $APP_CODE_DIR ($(du -sh "$APP_CODE_DIR" | awk '{print $1}'))"

# ---------- 3) Copiar ícone ----------
if [ -f "$ROOT/app.icns" ]; then
  cp -p "$ROOT/app.icns" "$RES_DIR/AppIcon.icns"
  echo "  ✅ Ícone copiado: AppIcon.icns ($(stat -f %z "$RES_DIR/AppIcon.icns" 2>/dev/null || stat -c %s "$RES_DIR/AppIcon.icns" 2>/dev/null) B)"
else
  echo "  ⚠️  app.icns não encontrado — usando ícone padrão do Finder"
fi

# ---------- 4) Info.plist profissional ----------
cat > "$INFO_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>pt-BR</string>
    <key>CFBundleDisplayName</key>
    <string>${APP_NAME}</string>
    <key>CFBundleExecutable</key>
    <string>${APP_NAME}</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>CFBundleIdentifier</key>
    <string>com.tiago.criasitetiago</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>${APP_NAME}</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>${VERSION}</string>
    <key>CFBundleVersion</key>
    <string>${BUILD}</string>
    <key>LSApplicationCategoryType</key>
    <string>public.app-category.developer-tools</string>
    <key>LSMinimumSystemVersion</key>
    <string>12.0</string>
    <key>LSUIElement</key>
    <false/>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSHumanReadableCopyright</key>
    <string>© 2026 Tiago — IDE TiAi Autônoma estilo Trae. Build RC18.</string>
    <key>NSAppTransportSecurity</key>
    <dict>
      <key>NSAllowsArbitraryLoads</key>
      <true/>
      <key>NSAllowsLocalNetworking</key>
      <true/>
    </dict>
</dict>
</plist>
PLIST
echo "  ✅ Info.plist v${VERSION} (${BUILD}) criado"

# ---------- 5) PkgInfo ----------
echo -n "APPL????" > "$PKGINFO"

# ---------- 6) Custom icon Finder via Python/xattr ----------
if command -v SetFile >/dev/null 2>&1 && [ -f "$RES_DIR/AppIcon.icns" ]; then
  python3 - "$APP_DIR" "$RES_DIR/AppIcon.icns" <<'PY' 2>/dev/null || true
import sys, os, struct, subprocess
from pathlib import Path
app = Path(sys.argv[1]).resolve()
icns = Path(sys.argv[2]).resolve()
try: subprocess.run(["SetFile", "-a", "C", str(app)], check=True, capture_output=True)
except Exception: pass
try:
    icon_file = app / "Icon\r"
    icon_file.write_bytes(icns.read_bytes())
    try: os.chflags(str(icon_file), os.stat(str(icon_file)).st_flags | 0x8000)
    except Exception: pass
except Exception: pass
PY
fi

# ---------- 7) Touch bundle p/ Finder recarregar ----------
touch "$APP_DIR"
echo ""
echo "🚀 ${APP_NAME}.app construído com SUCESSO! (auto-contido)"
echo "   📂 Localização : $APP_DIR"
echo "   📦 Tamanho app : $(du -sh "$APP_DIR" | awk '{print $1}')"
echo "   🖥️  Como usar  :"
echo "      1) Duplo clique em ${APP_NAME}.app"
echo "      2) Arraste para a pasta 📁 /Applications p/ instalar"
echo "      3) Ou arraste pro Dock / Desktop pra ficar fácil"
echo ""
echo "💡 Tip: aparecer popup 'Não pode abrir app baixado internet'?"
echo "   Clique BOTÃO DIREITO em ${APP_NAME}.app → Abrir → Abrir novamente."
echo ""

# ---------- 8) BONUS: Criar DMG Drag & Drop profissional (se tiver espaço) ----------
read -r -t 6 -p "📀 Quer gerar o instalador .dmg Drag&Drop também? (S/n, auto-sim em 6s): " _ANS || true
case "${_ANS:-s}" in
  s|S|y|Y|"")
    DMG_NAME="${APP_NAME}-macOS-v${VERSION}.dmg"
    STAGING_DIR="$ROOT/.dmg-staging"
    echo ""
    echo "🎬 Gerando instalador DMG em: $DMG_NAME"
    rm -rf "$STAGING_DIR" "$ROOT/$DMG_NAME"
    mkdir -p "$STAGING_DIR"
    cp -R "$APP_DIR" "$STAGING_DIR/"
    ln -s /Applications "$STAGING_DIR/Applications"
    # Criar DMG com hdiutil nativo macOS
    hdiutil create \
      -volname "${APP_NAME} v${VERSION}" \
      -srcfolder "$STAGING_DIR" \
      -ov -format UDZO \
      -imagekey zlib-level=9 \
      "$ROOT/$DMG_NAME" >/dev/null
    rm -rf "$STAGING_DIR"
    echo "✅ DMG instalador gerado: $ROOT/$DMG_NAME ($(du -sh "$ROOT/$DMG_NAME" | awk '{print $1}'))"
    echo "   Como usar o DMG: duplo clique → arrasta ícone ${APP_NAME}.app para 📁 Applications"
    ;;
  *)
    echo "ℹ️  Pulando DMG (você disse não)."
    ;;
esac
echo ""
echo "🎯 Fim! Seu TiAi agora é um aplicativo macOS instalável! 🎉"
