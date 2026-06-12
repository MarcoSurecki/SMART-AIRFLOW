from flask import Flask, render_template, request, jsonify
import serial
import threading
import time

app = Flask(__name__)

arduino = None
latest_data = "BAGGAGE CONTROL SYSTEM"
connection_status = False

PORTA = "/dev/ttyACM0"
BAUDRATE = 9600


def conectar_arduino():
    global arduino, connection_status

    try:
        arduino = serial.Serial(PORTA, BAUDRATE, timeout=1)
        connection_status = True
        print(f"Arduino conectado em {PORTA}")
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

            if arduino.in_waiting:

                linha = arduino.readline().decode(
                    errors='ignore'
                ).strip()

                if linha:
                    latest_data = linha
                    connection_status = True

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

    cmd = request.form.get('cmd')

    print("Comando:", cmd)

    try:

        if arduino and arduino.is_open:

            arduino.write(
                (cmd + '\n').encode()
            )

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


@app.route('/data')
def data():

    return jsonify({
        "status": latest_data
    })


if __name__ == '__main__':

    app.run(
        host='0.0.0.0',
        port=5000,
        debug=False,
        threaded=True
    )

