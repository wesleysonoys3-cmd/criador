#!/bin/bash
echo ""
echo "================ SERVER.JS FINAL RC25.3 ================"
cat -n /Users/tiagosantos/Desktop/criador/workspace/teste-sec-rc25-final/server.js
echo ""
echo "================ .ENV FINAL (mascarado) ================"
if [ -f /Users/tiagosantos/Desktop/criador/workspace/teste-sec-rc25-final/.env ]; then
  echo "✅ .env EXISTE. Tamanho: $(wc -c < /Users/tiagosantos/Desktop/criador/workspace/teste-sec-rc25-final/.env | tr -d ' ') bytes, $(wc -l < /Users/tiagosantos/Desktop/criador/workspace/teste-sec-rc25-final/.env | tr -d ' ') linhas"
  echo ""
  echo "─── Conteúdo (valores > 10 chars mascarados):"
  sed -E 's/=(.{10,}).*$/=\1[...MASKED...]/' /Users/tiagosantos/Desktop/criador/workspace/teste-sec-rc25-final/.env
  echo ""
  echo "─── Linhas ATIVAS (descomentadas e não-vazias):"
  grep -v '^#' /Users/tiagosantos/Desktop/criador/workspace/teste-sec-rc25-final/.env | grep -v '^\s*$' | sed -E 's/=(.{5,}).*$/=\1[...]/'
else
  echo "❌ FALHA: .env nao existe!"
fi
echo ""
echo "================ .gitignore (tem .env?) ================"
if [ -f /Users/tiagosantos/Desktop/criador/workspace/teste-sec-rc25-final/.gitignore ]; then
  cat -n /Users/tiagosantos/Desktop/criador/workspace/teste-sec-rc25-final/.gitignore
else
  echo "❌ FALHA .gitignore nao existe"
fi
echo ""
echo "================ LINHAS CONTENDO express.static (1x OK) ================"
grep -n "express.static" /Users/tiagosantos/Desktop/criador/workspace/teste-sec-rc25-final/server.js
echo ""
echo "================ LINHAS CONTENDO dotfiles (quantas?) ================"
grep -n "dotfiles" /Users/tiagosantos/Desktop/criador/workspace/teste-sec-rc25-final/server.js
