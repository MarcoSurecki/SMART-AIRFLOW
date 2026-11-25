@echo off
REM Teste no Windows: sobe o servidor e abre o painel em tela cheia.
REM Para sair da tela cheia: Alt+F4.

cd /d "%~dp0.."

start "Servidor da esteira" venv\Scripts\python.exe app.py

REM espera o servidor subir
timeout /t 4 /nobreak > nul

start msedge --kiosk "http://localhost:5001/?kiosk" --edge-kiosk-type=fullscreen --no-first-run
