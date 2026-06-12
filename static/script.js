let sistemaPausado = false;
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
// 🔔 NOTIFICAÇÕES
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
// ⬆️⬇️ ALETAS
// ============================

function girarDireita() {

    enviar('LEFT'); // mantém invertido se teu motor está assim

    document.getElementById(
        'sentido-texto'
    ).innerText = 'HORÁRIO';

    notificar(
        '➡️ Sentido horário selecionado'
    );
}

function girarEsquerda() {

    enviar('RIGHT'); // mantém invertido se teu motor está assim

    document.getElementById(
        'sentido-texto'
    ).innerText = 'ANTI-HORÁRIO';

    notificar(
        '⬅️ Sentido anti-horário selecionado'
    );
}

function ativarAuto() {

    enviar('AUTO_ON');

    document.getElementById('modo-texto').innerText =
        'CONTÍNUO';

    document
        .querySelectorAll('.manual-only')
        .forEach(btn => btn.disabled = true);

    notificar('▶️ Esteira em operação contínua');

}

// ============================
// ✋ MANUAL
// ============================

function desativarAuto() {

    enviar('AUTO_OFF');

    document.getElementById('modo-texto').innerText =
        'PARADO';

    document
        .querySelectorAll('.manual-only')
        .forEach(btn => btn.disabled = false);

    notificar('⏹️ Operação contínua encerrada');

}

// ============================
// ⚙️ VELOCIDADE
// ============================

function alterarVelocidade(valor) {

    document.getElementById('rpmValue').innerText =
        valor;

    enviar('SPD_' + valor);

    let gauge =
        document.querySelector('.gauge');

    let graus =
        (valor - 5) * 18;

    gauge.style.background =
        `conic-gradient(
            #00bfff ${graus}deg,
            rgba(255,255,255,0.1) ${graus}deg
        )`;

    

}

// ============================
// 📡 STATUS ARDUINO
// ============================

async function verificarArduino() {

    try {

        const resposta =
            await fetch('/status');

        const dados =
            await resposta.json();

        const status =
            document.getElementById('statusArduino');

        if (!status) return;

        if (dados.online) {

            status.innerHTML =
                '<span class="pulse"></span> ONLINE';

            status.className =
                'online online-ok';

        } else {

            status.innerHTML =
                '<span class="pulse"></span> OFFLINE';

            status.className =
                'online offline';

        }

    }

    catch (e) {

        console.log(
            'Erro status Arduino'
        );

    }

}

setInterval(
    verificarArduino,
    2000
);

verificarArduino();

// ============================
// PARTICULAS
// ============================

particlesJS('particles-js', {

    particles: {

        number: {
            value: 80
        },

        color: {
            value: '#00bfff'
        },

        shape: {
            type: 'circle'
        },

        opacity: {
            value: 0.5
        },

        size: {
            value: 3
        },

        move: {

            enable: true,

            speed: 2

        },

        line_linked: {

            enable: true,

            color: '#00bfff',

            opacity: 0.2

        }
    }
});

// ============================
// CANVAS FUNDO
// ============================

const canvas =
    document.getElementById('bgCanvas');

if (canvas) {

    const ctx =
        canvas.getContext('2d');

    canvas.width =
        window.innerWidth;

    canvas.height =
        window.innerHeight;

    let points = [];

    for (let i = 0; i < 80; i++) {

        points.push({

            x: Math.random() * canvas.width,

            y: Math.random() * canvas.height,

            vx: (Math.random() - 0.5) * 0.5,

            vy: (Math.random() - 0.5) * 0.5

        });

    }

    function animate() {

        ctx.clearRect(
            0,
            0,
            canvas.width,
            canvas.height
        );

        points.forEach(p => {

            p.x += p.vx;
            p.y += p.vy;

            if (
                p.x < 0 ||
                p.x > canvas.width
            ) p.vx *= -1;

            if (
                p.y < 0 ||
                p.y > canvas.height
            ) p.vy *= -1;

            ctx.beginPath();

            ctx.arc(
                p.x,
                p.y,
                2,
                0,
                Math.PI * 2
            );

            ctx.fillStyle =
                'rgba(0,191,255,0.6)';

            ctx.fill();

        });

        requestAnimationFrame(
            animate
        );

    }

    animate();
}

// ============================
// ⏸ PAUSAR / ▶ RETOMAR
// ============================


function togglePause() {

    const btn = document.getElementById('btnPause');

    if (!btn) return;

    if (!sistemaPausado) {

        enviar('PAUSE');

        sistemaPausado = true;

        btn.innerHTML =
            '<i class="fa-solid fa-play"></i> RETOMAR';

        document.getElementById('modo-texto').innerText =
    'PAUSADO';

            notificar('⏸ Esteira pausada');

    } else {

        enviar('RESUME');

        sistemaPausado = false;

        btn.innerHTML =
            '<i class="fa-solid fa-pause"></i> PAUSAR';

        document.getElementById('modo-texto').innerText =
    'CONTÍNUO';

         notificar('▶ Esteira retomada');
    }
}