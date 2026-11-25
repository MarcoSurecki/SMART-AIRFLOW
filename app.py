from flask import Flask, render_template, request, jsonify
import serial
from serial.tools import list_ports
import os
import threading
import time
from collections import deque

app = Flask(__name__)

arduino = None
latest_data = "ESTEIRA INDUSTRIAL"
connection_status = False

# A porta é encontrada sozinha (Windows: COMx, Linux: /dev/ttyACMx).
# Para forçar uma porta: variável de ambiente ESTEIRA_PORTA (ex.: /dev/ttyACM0).
PORTA_PADRAO = "COM14" if os.name == "nt" else "/dev/ttyACM0"
BAUDRATE = 9600

# fabricantes comuns de placas Arduino e clones (Arduino, CH340, FTDI, CP210x)
VIDS_ARDUINO = {0x2341, 0x2A03, 0x1A86, 0x0403, 0x10C4}


def encontrar_porta():
    if os.environ.get("ESTEIRA_PORTA"):
        return os.environ["ESTEIRA_PORTA"]

    for p in list_ports.comports():
        if p.vid in VIDS_ARDUINO or "arduino" in (p.description or "").lower():
            return p.device

    return PORTA_PADRAO


# ---------------- ESTADO DA ESTEIRA ----------------
# Fica no servidor para a tela mostrar o estado real mesmo depois
# de recarregar a página. O Arduino reinicia quando a serial é aberta,
# então ao conectar tudo volta ao padrão do firmware.

esteira = {"ligada": False, "sentido": 1, "rpm": 10}


def estado_inicial_esteira():
    esteira.update(ligada=False, sentido=1, rpm=10)


def registrar_comando(cmd):
    if cmd == "AUTO_ON" and not emergencia:
        esteira["ligada"] = True
    elif cmd == "AUTO_OFF":
        esteira["ligada"] = False
    elif cmd in ("RIGHT", "LEFT") and not esteira["ligada"]:
        esteira["sentido"] = 1 if cmd == "RIGHT" else -1
    elif cmd.startswith("SPD_"):
        try:
            esteira["rpm"] = max(5, min(20, int(cmd[4:])))
        except ValueError:
            pass

# ---------------- CONTADOR DE CAIXAS ----------------
# O Arduino envia a linha "CAIXA" a cada caixa detectada pelo sensor.

total_caixas = 0
horarios_caixas = deque()      # horários das caixas do último minuto
trava_contador = threading.Lock()


def registrar_caixa():
    global total_caixas
    with trava_contador:
        total_caixas += 1
        horarios_caixas.append(time.time())


# ---------------- PARADA DE EMERGÊNCIA ----------------
# Pode vir do painel (comandos PAUSE / RESUME) ou do botão físico
# no Arduino, que envia "EMERGENCIA" ao ser acionado e, se houver
# rearme físico, "EMERGENCIA_OFF".

MSG_EMERGENCIA = {"EMERGENCIA", "EMERGENCIA_ON", "ESTOP", "ESTOP_ON"}
MSG_LIBERADA = {"EMERGENCIA_OFF", "ESTOP_OFF", "RETOMADO"}

emergencia = False
emergencia_origem = ""          # "painel" ou "fisico"


def definir_emergencia(ativa, origem):
    global emergencia, emergencia_origem
    if ativa != emergencia:
        print(f"Emergência {'ACIONADA' if ativa else 'liberada'} ({origem})")
    emergencia = ativa
    emergencia_origem = origem


def conectar_arduino():
    global arduino, connection_status

    porta = encontrar_porta()

    try:
        arduino = serial.Serial(porta, BAUDRATE, timeout=1)
        connection_status = True
        # o Arduino reinicia ao abrir a serial: volta tudo ao padrão
        estado_inicial_esteira()
        definir_emergencia(False, "")
        print(f"Arduino conectado em {porta}")
        return True

    except Exception as e:
        connection_status = False
        arduino = None
        print("Arduino offline:", e)
        return False


def monitor_serial():
    global latest_data, connection_status, arduino

    while True:

        # tenta reconectar
        if arduino is None or not arduino.is_open:
            conectar_arduino()
            time.sleep(2)
            continue

        try:

            # lê todas as linhas pendentes para não perder caixas
            while arduino.in_waiting:

                linha = arduino.readline().decode(
                    errors='ignore'
                ).strip()

                if not linha:
                    continue

                connection_status = True

                msg = linha.upper()

                if msg == "CAIXA":
                    registrar_caixa()
                    continue

                if msg in MSG_EMERGENCIA:
                    definir_emergencia(True, "fisico")
                elif msg in MSG_LIBERADA:
                    definir_emergencia(False, "fisico")
                elif msg.startswith("EMERGENCIA DESTRAVADA"):
                    # botão físico destravado: se a parada veio dele,
                    # libera a tela e manda o Arduino retomar o motor
                    if emergencia and emergencia_origem == "fisico":
                        definir_emergencia(False, "fisico")
                        arduino.write(b"RESUME\n")

                latest_data = linha

        except Exception as e:

            print("Perda de conexão:", e)

            connection_status = False

            try:
                arduino.close()
            except:
                pass

            arduino = None

        time.sleep(0.1)


threading.Thread(
    target=monitor_serial,
    daemon=True
).start()


@app.route('/')
def home():
    return render_template('index.html')


@app.route('/comando', methods=['POST'])
def comando():

    global connection_status

    cmd = (request.form.get('cmd') or '').strip().upper()

    print("Comando:", cmd)

    # o estado de emergência do painel vale mesmo com o Arduino offline
    if cmd == "PAUSE":
        definir_emergencia(True, "painel")
    elif cmd == "RESUME":
        definir_emergencia(False, "painel")

    try:

        if arduino and arduino.is_open:

            arduino.write(
                (cmd + '\n').encode()
            )

            # só guarda o estado se o comando chegou ao Arduino
            registrar_comando(cmd)

            return 'OK'

    except Exception as e:

        print("Erro envio:", e)

        connection_status = False

    return 'ERRO'


@app.route('/status')
def status():

    return jsonify({
        "online": connection_status
    })


@app.route('/estado')
def estado():
    """Estado consultado pela tela várias vezes por segundo."""

    agora = time.time()

    with trava_contador:
        while horarios_caixas and agora - horarios_caixas[0] > 60:
            horarios_caixas.popleft()
        total = total_caixas
        por_minuto = len(horarios_caixas)

    return jsonify({
        "online": connection_status,
        "emergencia": emergencia,
        "emergencia_origem": emergencia_origem,
        "ligada": esteira["ligada"],
        "sentido": esteira["sentido"],
        "rpm": esteira["rpm"],
        "serial": latest_data,
        "total": total,
        "por_minuto": por_minuto
    })


@app.route('/contador')
def contador():

    agora = time.time()

    with trava_contador:

        while horarios_caixas and agora - horarios_caixas[0] > 60:
            horarios_caixas.popleft()

        return jsonify({
            "total": total_caixas,
            "por_minuto": len(horarios_caixas)
        })


@app.route('/contador/zerar', methods=['POST'])
def zerar_contador():

    global total_caixas

    with trava_contador:
        total_caixas = 0
        horarios_caixas.clear()

    return 'OK'


@app.route('/data')
def data():

    return jsonify({
        "status": latest_data
    })


if __name__ == '__main__':

    app.run(
        host='0.0.0.0',
        port=5001,
        debug=False,
        threaded=True
    )

