#!/bin/bash
# Inicia o servidor da esteira e abre o painel em tela cheia (modo quiosque).
# Usado na inicialização do Linux (ver painel-esteira.desktop).

PASTA="$(cd "$(dirname "$0")/.." && pwd)"
URL="http://localhost:5001/?kiosk"
LOG="$PASTA/kiosk/servidor.log"

cd "$PASTA" || exit 1

# Python do ambiente virtual (se existir)
if [ -x "$PASTA/venv/bin/python" ]; then
    PY="$PASTA/venv/bin/python"
else
    PY="python3"
fi

# tela sem descanso / sem apagar (X11)
xset s off      2>/dev/null
xset -dpms      2>/dev/null
xset s noblank  2>/dev/null

# sobe o servidor se ainda não estiver rodando
if ! curl -s -o /dev/null "$URL"; then
    "$PY" -u app.py > "$LOG" 2>&1 &
fi

# espera o servidor responder (até 30 s)
for _ in $(seq 1 30); do
    curl -s -o /dev/null "$URL" && break
    sleep 1
done

# navegador disponível (Raspberry Pi OS usa chromium-browser, outros chromium)
NAVEGADOR=""
for n in chromium-browser chromium google-chrome; do
    if command -v "$n" > /dev/null; then NAVEGADOR="$n"; break; fi
done

if [ -z "$NAVEGADOR" ]; then
    echo "Chromium não encontrado. Instale com: sudo apt install chromium-browser"
    exit 1
fi

"$NAVEGADOR" \
    --kiosk \
    --noerrordialogs \
    --disable-infobars \
    --disable-session-crashed-bubble \
    --disable-translate \
    --disable-pinch \
    --overscroll-history-navigation=0 \
    --check-for-update-interval=31536000 \
    --window-size=1024,600 \
    "$URL"
