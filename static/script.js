// ============================
// 🔥 SCADA CORE (BLINDADO)
// ============================

// evita erro de redeclare em reload
window.lastStatus = window.lastStatus || "";

// ============================
// 📡 ENVIO DE COMANDOS
// ============================

function enviar(cmd) {
    fetch('/comando', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'cmd=' + cmd
    });
}

// ============================
// 🔔 NOTIFICAÇÕES SCADA
// ============================

function notificar(texto) {

    const area = document.getElementById('notificacoes');

    if (!area) return;

    const aviso = document.createElement('div');
    aviso.className = 'notificacao';
    aviso.innerText = texto;

    area.appendChild(aviso);

    setTimeout(() => {
        aviso.remove();
    }, 3000);
}

// ============================
// 🎛 CONTROLES MANUAIS
// ============================

function ativarAuto() {
    enviar('AUTO_ON');

    document.getElementById('modo-texto').innerText = 'AUTOMÁTICO';

    notificar('🌀 Modo automático ativado');
}

function desativarAuto() {
    enviar('AUTO_OFF');

    document.getElementById('modo-texto').innerText = 'MANUAL';

    notificar('✋ Modo manual ativado');
}

// ============================
// ⚙️ VELOCIDADE / RPM
// ============================

function alterarVelocidade(valor) {

    document.getElementById('rpmValue').innerText = valor;

    enviar('SPD_' + valor);

    let gauge = document.querySelector('.gauge');

    let graus = (valor - 5) * 18;

    gauge.style.background =
        `conic-gradient(
            #00bfff ${graus}deg,
            rgba(255,255,255,0.1) ${graus}deg
        )`;

    fanSpeed(valor);
}

// ============================
// 🌪 FAN DINÂMICO
// ============================

function fanSpeed(valor) {

    let fan = document.querySelector('.fan');

    if (!fan) return;

    let tempo = 3 - (valor / 10);

    if (tempo < 0.2) tempo = 0.2;

    fan.style.animation = `spin ${tempo}s linear infinite`;
}

// ============================
// 📡 LOOP SCADA PRINCIPAL
// ============================

async function loopScada() {

    try {

        const res = await fetch('/data');
        const data = await res.json();

        if (!data.status) return;

        const status = data.status;

        console.log("SCADA:", status);

        // só reage se mudou
        if (status !== window.lastStatus) {

            window.lastStatus = status;

            notificar("STATUS: " + status);

            const elStatus = document.getElementById('statusArduino');

            if (!elStatus) return;

            // =========================
            // 🔴 ERROR
            // =========================
            if (status.includes("ERROR") || status.includes("STOP")) {

                elStatus.innerHTML = '<span class="pulse"></span> ERROR';
                elStatus.className = "offline status-error";

            }

            // =========================
            // 🟡 WARN
            // =========================
            else if (status.includes("WARN")) {

                elStatus.innerHTML = '<span class="pulse"></span> WARNING';
                elStatus.className = "status-warn";

            }

            // =========================
            // 🟢 OK / NORMAL
            // =========================
            else {

                elStatus.innerHTML = '<span class="pulse"></span> ONLINE';
                elStatus.className = "online-ok status-ok";
            }

            // =========================
            // 🧠 MODO
            // =========================

            const modo = document.getElementById('modo-texto');

            if (modo) {
                if (status.includes("AUTO")) {
                    modo.innerText = "AUTOMÁTICO";
                }

                if (status.includes("MANUAL")) {
                    modo.innerText = "MANUAL";
                }
            }
        }

    } catch (err) {
        console.log("SCADA ERROR:", err);
    }
}

// ============================
// 🔁 LOOP INICIAR
// ============================

setInterval(loopScada, 500);
loopScada();

// ============================
// 🧪 ARDUINO STATUS (fallback opcional)
// ============================

async function verificarArduino() {

    try {

        const resposta = await fetch('/status');
        const dados = await resposta.json();

        const status = document.getElementById('statusArduino');

        if (!status) return;

        if (dados.online) {
            status.classList.add('online-ok');
        } else {
            status.classList.add('offline');
        }

    } catch (e) {
        console.log("Arduino check error");
    }
}

setInterval(verificarArduino, 2000);
verificarArduino();



function stepMotor(valor) {

    const modo = document.getElementById('modo-texto').innerText;

    if (modo !== "MANUAL") {
        notificar("⚠️ Só funciona no modo manual");
        return;
    }

    posicaoAleta += valor;

    if (posicaoAleta < 0) posicaoAleta = 0;
    if (posicaoAleta > 10) posicaoAleta = 10;

    enviar('ALETA_' + posicaoAleta);

    notificar("🎛 Posição: " + posicaoAleta);
}
window.posicaoAleta = window.posicaoAleta || 5;

function stepMotor(dir) {

    const modo = document.getElementById("modo-texto");

    if (!modo) return;

    if (modo.innerText !== "MANUAL") {
        notificar("⚠️ Só funciona no modo manual");
        return;
    }

    if (dir === "UP") window.posicaoAleta++;
    if (dir === "DOWN") window.posicaoAleta--;

    window.posicaoAleta = Math.max(0, Math.min(10, window.posicaoAleta));

    enviar("ALETA_" + window.posicaoAleta);

    notificar("🎛 Posição: " + window.posicaoAleta);
}