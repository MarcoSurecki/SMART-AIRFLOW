#!/bin/bash
# Prepara o Linux para rodar o painel da esteira. Rode uma vez:
#   bash kiosk/instalar_linux.sh

set -e

PASTA="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PASTA"

echo "== Instalando pacotes do sistema =="
sudo apt update
sudo apt install -y python3-venv python3-pip curl
sudo apt install -y chromium-browser || sudo apt install -y chromium

echo "== Criando o ambiente Python =="
python3 -m venv venv
venv/bin/pip install -r requirements.txt

echo "== Permissão para usar a porta serial do Arduino =="
sudo usermod -aG dialout "$USER"

echo "== Abrir o painel automaticamente ao ligar =="
chmod +x kiosk/iniciar_painel.sh
mkdir -p "$HOME/.config/autostart"
sed "s|CAMINHO_DO_PROJETO|$PASTA|" kiosk/painel-esteira.desktop \
    > "$HOME/.config/autostart/painel-esteira.desktop"

echo
echo "Pronto. Reinicie o computador (necessário para a permissão da serial)."
echo "Para testar sem reiniciar o sistema: bash kiosk/iniciar_painel.sh"
