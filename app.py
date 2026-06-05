from flask import Flask, render_template, request, jsonify
import serial
import threading
import time

app = Flask(__name__)

arduino = None
latest_data = "INIT"
connection_status = False

# 🔌 conexão serial
try:
    arduino = serial.Serial('COM9', 9600, timeout=1)
    connection_status = True
    print("Arduino conectado")
except Exception as e:
    print("Erro serial:", e)


# 🔁 leitura contínua do Arduino (ESSENCIAL)
def read_serial():
    global latest_data, connection_status

    while True:
        if arduino and arduino.is_open:
            try:
                line = arduino.readline().decode().strip()
                if line:
                    latest_data = line
                    connection_status = True
            except:
                connection_status = False
        time.sleep(0.1)


if arduino:
    thread = threading.Thread(target=read_serial, daemon=True)
    thread.start()


@app.route('/')
def home():
    return render_template('index.html')


# 📡 comando para Arduino
@app.route('/comando', methods=['POST'])
def comando():
    cmd = request.form['cmd']
    print(f'Comando: {cmd}')

    if arduino and arduino.is_open:
        arduino.write((cmd + '\n').encode())

    return 'OK'


# 📊 STATUS GERAL (SCADA)
@app.route('/status')
def status():
    return jsonify({
        "online": connection_status
    })


# 📊 DADOS EM TEMPO REAL (SCADA PRINCIPAL)
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

