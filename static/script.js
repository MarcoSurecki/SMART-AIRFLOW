// =====================================================
// ESTEIRA INDUSTRIAL · IHM
// Comandos enviados ao Arduino (inalterados):
//   LEFT, RIGHT, AUTO_ON, AUTO_OFF, SPD_<n>, PAUSE, RESUME
// =====================================================

const estado = {
    ligada: false,     // AUTO_ON / AUTO_OFF
    pausada: false,    // PAUSE / RESUME
    sentido: 1,        // 1 = horário (→), -1 = anti-horário (←)
    rpm: 10,
    inicioOperacao: null,
    acumulado: 0
};

const $ = (id) => document.getElementById(id);
const rodando = () => estado.ligada && !estado.pausada;

// =====================================================
// COMUNICAÇÃO
// =====================================================

function enviar(cmd) {
    return fetch('/comando', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'cmd=' + encodeURIComponent(cmd)
    })
        .then(r => r.text())
        .then(txt => {
            if (txt !== 'OK') registrar('Arduino offline · comando não enviado', 'err');
        })
        .catch(() => registrar(`Sem resposta do servidor (${cmd})`, 'err'));
}

// =====================================================
// SOM (Web Audio, sem arquivos)
// =====================================================

const som = { on: true, ctx: null, hum: null };

function audio() {
    if (!som.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        som.ctx = new AC();
    }
    if (som.ctx.state === 'suspended') som.ctx.resume();
    return som.ctx;
}

function tom(freq, dur = 0.06, type = 'square', vol = 0.04, delay = 0) {
    if (!som.on) return;
    const ac = audio();
    if (!ac) return;
    const t0 = ac.currentTime + delay;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(ac.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
}

const clique = () => tom(1400, 0.03, 'square', 0.025);
const somLigar = () => { tom(440, 0.09); tom(660, 0.09, 'square', 0.04, 0.1); tom(880, 0.16, 'square', 0.04, 0.2); };
const somDesligar = () => { tom(660, 0.09); tom(440, 0.09, 'square', 0.04, 0.1); tom(330, 0.18, 'square', 0.04, 0.2); };
const somScan = () => tom(2300, 0.05, 'sine', 0.02);

function somAlarme() {
    for (let i = 0; i < 6; i++) tom(i % 2 ? 620 : 880, 0.18, 'sawtooth', 0.045, i * 0.2);
}

function atualizarZumbido() {
    const ac = som.ctx;
    if (!ac) return;
    if (!som.hum) {
        const o = ac.createOscillator();
        const f = ac.createBiquadFilter();
        const g = ac.createGain();
        o.type = 'sawtooth';
        f.type = 'lowpass';
        f.frequency.value = 240;
        g.gain.value = 0;
        o.connect(f); f.connect(g); g.connect(ac.destination);
        o.start();
        som.hum = { o, g };
    }
    const alvo = som.on && rodando() ? 0.03 : 0;
    som.hum.g.gain.setTargetAtTime(alvo, ac.currentTime, 0.4);
    som.hum.o.frequency.setTargetAtTime(35 + estado.rpm * 2.5, ac.currentTime, 0.3);
}

// =====================================================
// LOG DE EVENTOS
// =====================================================

function hora() {
    return new Date().toLocaleTimeString('pt-BR', { hour12: false });
}

const ultimosAvisos = new Map();

function registrar(texto, tipo = 'info') {
    // não repete o mesmo aviso em menos de 4 s
    const agora = Date.now();
    if (agora - (ultimosAvisos.get(texto) || 0) < 4000) return;
    ultimosAvisos.set(texto, agora);

    const area = $('notificacoes');
    if (!area) return;

    const aviso = document.createElement('div');
    aviso.className = 'notificacao ' + tipo;
    aviso.innerHTML = `<time>${hora()}</time><span></span>`;
    aviso.lastChild.textContent = texto;
    area.appendChild(aviso);

    while (area.children.length > 5) area.firstChild.remove();

    setTimeout(() => {
        aviso.classList.add('sai');
        setTimeout(() => aviso.remove(), 400);
    }, 4000);
}

// =====================================================
// PAINEL
// =====================================================

function atualizarPainel() {
    let modo = 'PARADO', lamp = '', cls = '';
    if (estado.pausada) { modo = 'PARADA DE EMERGÊNCIA'; lamp = 'lamp-red'; cls = 'pause'; }
    else if (estado.ligada) { modo = 'CONTÍNUO'; lamp = 'lamp-green'; cls = 'run'; }

    $('modo-texto').textContent = estado.pausada ? 'PAUSADO' : modo;
    $('lampModo').className = 'lamp ' + lamp;
    $('beltState').textContent = modo;
    $('beltState').className = 'belt-state ' + cls;

    $('btnLigar').disabled = estado.ligada || estado.pausada;
    $('btnDesligar').disabled = !estado.ligada || estado.pausada;

    const horario = estado.sentido === 1;
    $('sentido-texto').textContent = horario ? 'HORÁRIO' : 'ANTI-HORÁRIO';
    $('lampDireita').className = 'lamp ' + (horario ? 'lamp-green' : '');
    $('lampEsquerda').className = 'lamp ' + (horario ? '' : 'lamp-green');
    document.querySelectorAll('.manual-only')
        .forEach(b => b.disabled = estado.ligada || estado.pausada);

    const flow = $('flowIndicator');
    flow.classList.toggle('active', rodando());
    flow.classList.toggle('reverse', !horario);

    $('btnPause').classList.toggle('engaged', estado.pausada);
    $('btnPauseText').textContent = estado.pausada ? 'RETOMAR' : 'PAUSAR';

    document.body.classList.toggle('running', rodando());
    document.body.classList.toggle('alarm', estado.pausada);

    atualizarZumbido();
}

// =====================================================
// AÇÕES
// =====================================================

function girarDireita() {
    clique();
    enviar('RIGHT');
    estado.sentido = 1;
    registrar('Sentido horário selecionado');
    atualizarPainel();
}

function girarEsquerda() {
    clique();
    enviar('LEFT');
    estado.sentido = -1;
    registrar('Sentido anti-horário selecionado');
    atualizarPainel();
}

function ativarAuto() {
    somLigar();
    enviar('AUTO_ON');
    estado.ligada = true;
    estado.acumulado = 0;
    estado.inicioOperacao = Date.now();
    registrar('Esteira ligada · operação contínua', 'ok');
    atualizarPainel();
}

function desativarAuto() {
    somDesligar();
    enviar('AUTO_OFF');
    estado.ligada = false;
    estado.inicioOperacao = null;
    estado.acumulado = 0;
    registrar('Esteira desligada');
    atualizarPainel();
}

function togglePause() {
    if (!estado.pausada) {
        somAlarme();
        enviar('PAUSE');
        estado.pausada = true;
        if (estado.inicioOperacao) {
            estado.acumulado += Date.now() - estado.inicioOperacao;
            estado.inicioOperacao = null;
        }
        registrar('PARADA DE EMERGÊNCIA acionada', 'err');
    } else {
        clique();
        enviar('RESUME');
        estado.pausada = false;
        if (estado.ligada) estado.inicioOperacao = Date.now();
        registrar('Esteira retomada', 'ok');
    }
    atualizarPainel();
}

let timerVelocidade = null;

function alterarVelocidade(valor) {
    estado.rpm = Number(valor);
    $('rpmValue').textContent = valor;
    moverPonteiro(estado.rpm);
    tom(300 + estado.rpm * 40, 0.02, 'square', 0.015);
    atualizarZumbido();

    clearTimeout(timerVelocidade);
    timerVelocidade = setTimeout(() => {
        enviar('SPD_' + valor);
        registrar(`Velocidade ajustada para ${valor} RPM`);
    }, 150);
}

// =====================================================
// VELOCÍMETRO (SVG)
// =====================================================

function criarGauge() {
    const svg = $('gauge');
    const NS = 'http://www.w3.org/2000/svg';
    const cx = 100, cy = 100, r = 80;
    const ang = v => (-120 + (v - 5) / 15 * 240) * Math.PI / 180;
    const pt = (v, rr) => [cx + rr * Math.sin(ang(v)), cy - rr * Math.cos(ang(v))];

    const el = (tag, attrs, parent = svg) => {
        const e = document.createElementNS(NS, tag);
        for (const k in attrs) e.setAttribute(k, attrs[k]);
        parent.appendChild(e);
        return e;
    };

    const arco = (v1, v2, rr) => {
        const [x1, y1] = pt(v1, rr), [x2, y2] = pt(v2, rr);
        const large = (v2 - v1) / 15 * 240 > 180 ? 1 : 0;
        return `M${x1} ${y1} A${rr} ${rr} 0 ${large} 1 ${x2} ${y2}`;
    };

    el('path', { d: arco(5, 20, r), stroke: '#1c2026', 'stroke-width': 14, fill: 'none' });
    [[5, 14, '#35d45a'], [14, 17.5, '#ffab00'], [17.5, 20, '#e53935']].forEach(([a, b, c]) =>
        el('path', { d: arco(a, b, r), stroke: c, 'stroke-width': 5, fill: 'none', opacity: 0.9 }));

    for (let v = 5; v <= 20; v += 0.5) {
        const major = v % 5 === 0;
        const inteiro = Number.isInteger(v);
        const [x1, y1] = pt(v, r - 8);
        const [x2, y2] = pt(v, major ? r - 22 : inteiro ? r - 16 : r - 12);
        el('line', { x1, y1, x2, y2, stroke: major ? '#e9edf1' : '#6b737d', 'stroke-width': major ? 2.5 : 1 });
        if (major) {
            const [tx, ty] = pt(v, r - 34);
            el('text', {
                x: tx, y: ty + 4, fill: '#9aa3ad', 'font-size': 11,
                'font-family': 'Consolas, monospace', 'text-anchor': 'middle'
            }).textContent = v;
        }
    }

    const g = el('g', { id: 'needle' });
    el('polygon', { points: '96.5,104 103.5,104 100,26', fill: '#ff3b30' }, g);
    el('circle', { cx, cy, r: 9, fill: '#2a2f36', stroke: '#596069', 'stroke-width': 2 });
    el('circle', { cx, cy, r: 3, fill: '#ff3b30' });

    moverPonteiro(estado.rpm);
}

function moverPonteiro(v) {
    const n = $('needle');
    if (n) n.style.transform = `rotate(${-120 + (v - 5) / 15 * 240}deg)`;
}

// =====================================================
// STATUS / SERIAL / RELÓGIO
// =====================================================

async function verificarArduino() {
    const el = $('statusArduino');
    try {
        const dados = await (await fetch('/status')).json();
        const online = !!dados.online;
        if (el.dataset.online !== String(online)) {
            registrar(online ? 'Arduino conectado' : 'Arduino desconectado', online ? 'ok' : 'err');
        }
        el.dataset.online = online;
        el.className = 'conn ' + (online ? 'ok' : 'fail');
        el.innerHTML = online
            ? '<span class="lamp lamp-green"></span> ONLINE'
            : '<span class="lamp lamp-red"></span> OFFLINE';
    } catch (e) {
        el.className = 'conn fail';
        el.innerHTML = '<span class="lamp lamp-red"></span> SEM SERVIDOR';
    }
}

async function lerSerial() {
    try {
        const dados = await (await fetch('/data')).json();
        $('serialMsg').textContent = dados.status || '—';
    } catch (e) { /* ignora */ }
}

function formatar(ms) {
    const s = Math.floor(ms / 1000);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
}

function atualizarRelogio() {
    $('relogio').textContent = hora();
    let ms = estado.acumulado;
    if (estado.inicioOperacao) ms += Date.now() - estado.inicioOperacao;
    $('tempoOperacao').textContent = formatar(ms);
}

// =====================================================
// CENA 2.5D DA ESTEIRA (canvas)
// projeção oblíqua: x = comprimento, z = profundidade, h = altura
// =====================================================

const OX = 0.55, OY = 0.42;
const PX_POR_RPM = 9;

const S = {
    cv: null, ctx: null, dpr: 1, s: 1, LW: 1000, LH: 380,
    GY: 335, BH: 120, D: 110, X0: 30, X1: 900, TUN: 110, XS: 600,
    vel: 0, offset: 0, t: 0,
    boxes: [], dust: [],
    lastScan: '------', scanFlash: 0, cortina: 0
};

const CORES_CAIXA = ['#c8935a', '#b98448', '#d4a56c', '#a8763f', '#c18a4e'];

function P(x, z, h) { return [x + z * OX, S.GY - h - z * OY]; }

function poly(pts, fill, stroke, lw = 1) {
    const c = S.ctx;
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.closePath();
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.stroke(); }
}

function linha(a, b, cor, w = 1) {
    const c = S.ctx;
    c.beginPath();
    c.moveTo(a[0], a[1]);
    c.lineTo(b[0], b[1]);
    c.strokeStyle = cor;
    c.lineWidth = w;
    c.stroke();
}

function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
    const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
    const b = Math.min(255, Math.round((n & 255) * f));
    return `rgb(${r},${g},${b})`;
}

// caixa sólida: x..x+w, z..z+d, h..h+hh (faces: lateral direita, topo, frente)
function cuboid(x, z, h, w, d, hh, base) {
    poly([P(x + w, z, h), P(x + w, z + d, h), P(x + w, z + d, h + hh), P(x + w, z, h + hh)], shade(base, 0.68));
    poly([P(x, z, h + hh), P(x + w, z, h + hh), P(x + w, z + d, h + hh), P(x, z + d, h + hh)], shade(base, 1.25));
    poly([P(x, z, h), P(x + w, z, h), P(x + w, z, h + hh), P(x, z, h + hh)], base);
}

function circulo(x, y, r, fill, stroke, lw = 1) {
    const c = S.ctx;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.stroke(); }
}

// ---------- configuração ----------

function layoutCena() {
    const cv = S.cv;
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    if (W < 50 || H < 50) return;   // ainda sem layout
    S.dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(W * S.dpr);
    cv.height = Math.round(H * S.dpr);
    // cena projetada para 380 de altura e pelo menos 900 de largura
    S.s = Math.min(H / 380, W / 900);
    S.LW = W / S.s;
    S.LH = H / S.s;
    S.GY = 335 + (S.LH - 380) * 0.55;
    S.X0 = 30;
    S.X1 = S.LW - 40 - S.D * OX;
    S.XS = S.X0 + (S.X1 - S.X0) * 0.6;
    criarCaixas();
    criarPoeira();
}

function novaCaixa(b) {
    b.w = 60 + Math.random() * 45;
    b.d = 45 + Math.random() * 40;
    b.h = 36 + Math.random() * 42;
    b.z0 = (S.D - b.d) / 2 + (Math.random() - 0.5) * 14;
    b.cor = CORES_CAIXA[Math.floor(Math.random() * CORES_CAIXA.length)];
    b.code = 'LT-' + (1000 + Math.floor(Math.random() * 9000));
    b.scanned = false;
    return b;
}

const gapCaixa = () => 70 + Math.random() * 110;

function criarCaixas() {
    S.boxes = [];
    let x = S.X0 + S.TUN + 25;
    while (x < S.X1 + 150) {
        const b = novaCaixa({});
        b.x = x;
        S.boxes.push(b);
        x += b.w + gapCaixa();
    }
}

function criarPoeira() {
    S.dust = [];
    for (let i = 0; i < 70; i++) {
        S.dust.push({
            x: Math.random() * S.LW,
            y: Math.random() * S.LH,
            vx: (Math.random() - 0.5) * 6,
            vy: -2 - Math.random() * 5,
            r: 0.6 + Math.random() * 1.4,
            f: Math.random() * Math.PI * 2
        });
    }
}

function moverCaixas(dx) {
    for (const b of S.boxes) b.x += dx;

    if (dx > 0) {
        const limite = S.X1 - S.TUN + 4;
        for (const b of S.boxes) {
            if (b.x > limite) {
                const minX = Math.min(...S.boxes.map(o => o.x));
                novaCaixa(b);
                b.x = minX - b.w - gapCaixa();
            }
        }
    } else if (dx < 0) {
        const limite = S.X0 + S.TUN - 4;
        for (const b of S.boxes) {
            if (b.x + b.w < limite) {
                const maxR = Math.max(...S.boxes.map(o => o.x + o.w));
                novaCaixa(b);
                b.x = maxR + gapCaixa();
            }
        }
    }

    // leitura no scanner
    if (Math.abs(S.vel) > 1) {
        for (const b of S.boxes) {
            if (!b.scanned && b.x < S.XS && b.x + b.w > S.XS) {
                b.scanned = true;
                S.lastScan = b.code;
                S.scanFlash = 1;
                somScan();
            }
        }
    }
}

// ---------- desenho ----------

function desenharFundo() {
    const c = S.ctx, { LW, LH } = S;

    const g = c.createLinearGradient(0, 0, 0, LH);
    g.addColorStop(0, '#07080a');
    g.addColorStop(0.6, '#121418');
    g.addColorStop(1, '#0b0c0e');
    c.fillStyle = g;
    c.fillRect(0, 0, LW, LH);

    // painéis da parede
    c.strokeStyle = 'rgba(255,255,255,0.025)';
    c.lineWidth = 1;
    for (let x = 0; x < LW; x += 140) {
        c.beginPath(); c.moveTo(x, 0); c.lineTo(x, S.GY - 65); c.stroke();
    }

    // pintura na parede
    c.save();
    c.fillStyle = 'rgba(245,196,0,0.045)';
    c.font = '900 110px "Segoe UI", Arial, sans-serif';
    c.fillText('LINHA 01', 40, S.GY - 215);
    c.restore();

    // piso
    const fy = S.GY - (S.D + 80) * OY;
    const gp = c.createLinearGradient(0, fy, 0, LH);
    gp.addColorStop(0, '#16191d');
    gp.addColorStop(1, '#0d0f11');
    c.fillStyle = gp;
    c.fillRect(0, fy, LW, LH - fy);

    c.save();
    c.beginPath(); c.rect(0, fy, LW, LH - fy); c.clip();
    for (let z = -60; z <= S.D + 80; z += 30) linha(P(-500, z, 0), P(LW + 500, z, 0), 'rgba(255,255,255,0.035)');
    for (let x = -300; x < LW + 300; x += 90) linha(P(x, -80, 0), P(x, S.D + 80, 0), 'rgba(255,255,255,0.035)');
    c.restore();

    // faixa de segurança no piso
    poly([P(S.X0 - 20, -44, 0), P(S.X1 + 20, -44, 0), P(S.X1 + 20, -32, 0), P(S.X0 - 20, -32, 0)], 'rgba(245,196,0,0.55)');
    for (let x = S.X0 - 20; x < S.X1 + 10; x += 26) {
        poly([P(x, -44, 0), P(x + 12, -44, 0), P(x + 20, -32, 0), P(x + 8, -32, 0)], 'rgba(15,15,15,0.85)');
    }

    // sombra da esteira
    c.save();
    c.filter = 'blur(10px)';
    poly([P(S.X0 - 10, -20, 0), P(S.X1 + 10, -20, 0), P(S.X1 + 10, S.D + 22, 0), P(S.X0 - 10, S.D + 22, 0)], 'rgba(0,0,0,0.6)');
    c.restore();
}

function posicoesPernas() {
    const a = S.X0 + S.TUN + 30, b = S.X1 - S.TUN - 42;
    const n = Math.max(2, Math.round((b - a) / 190) + 1);
    const out = [];
    for (let i = 0; i < n; i++) out.push(a + (b - a) * i / (n - 1));
    return out;
}

function desenharEstruturaTraseira() {
    const { BH, D } = S;
    for (const x of posicoesPernas()) cuboid(x, D - 10, 0, 12, 10, BH - 30, '#3a4047');

    // poste traseiro do pórtico
    cuboid(S.XS - 5, D + 8, 0, 10, 8, BH + 122, '#c99b00');

    // trilho traseiro
    poly([P(S.X0, D + 2, BH - 26), P(S.X1, D + 2, BH - 26), P(S.X1, D + 2, BH + 10), P(S.X0, D + 2, BH + 10)], '#353b42');
    linha(P(S.X0, D + 2, BH + 10), P(S.X1, D + 2, BH + 10), '#5d656f', 1.5);
}

function desenharCorreia() {
    const c = S.ctx, { BH, D, X0, X1 } = S;

    const a = P(X0, 0, BH), b = P(X0, D, BH);
    const g = c.createLinearGradient(a[0], a[1], b[0], b[1]);
    g.addColorStop(0, '#1f2226');
    g.addColorStop(1, '#141619');
    poly([P(X0, 0, BH), P(X1, 0, BH), P(X1, D, BH), P(X0, D, BH)], g);

    // taliscas da correia (movem com o offset)
    const esp = 24;
    const ini = ((S.offset % esp) + esp) % esp;
    for (let x = X0 + ini; x < X1; x += esp) {
        linha(P(x, 2, BH), P(x, D - 2, BH), 'rgba(255,255,255,0.07)', 2);
    }

    // linha do laser sobre a correia
    c.save();
    c.shadowColor = '#ff2a2a';
    c.shadowBlur = 10;
    linha(P(S.XS, 0, BH + 0.5), P(S.XS, D, BH + 0.5), `rgba(255,50,50,${0.55 + 0.25 * Math.sin(S.t * 20)})`, 2);
    c.restore();
}

function desenharCaixa(b) {
    const c = S.ctx;
    const jit = Math.abs(S.vel) > 1 ? Math.sin(S.t * 45 + b.x * 0.1) * 0.5 : 0;
    const h0 = S.BH + jit;
    const { x, z0, w, d, h } = b;

    cuboid(x, z0, h0, w, d, h, b.cor);

    // fita adesiva
    const zm = z0 + d / 2;
    poly([P(x, zm - 5, h0 + h), P(x + w, zm - 5, h0 + h), P(x + w, zm + 5, h0 + h), P(x, zm + 5, h0 + h)], 'rgba(240,215,165,0.55)');
    poly([P(x + w, zm - 5, h0 + h), P(x + w, zm + 5, h0 + h), P(x + w, zm + 5, h0 + h - 16), P(x + w, zm - 5, h0 + h - 16)], 'rgba(200,170,120,0.5)');

    // contorno da face frontal
    poly([P(x, z0, h0), P(x + w, z0, h0), P(x + w, z0, h0 + h), P(x, z0, h0 + h)], null, 'rgba(0,0,0,0.35)');

    // etiqueta com código de barras
    if (w > 55 && h > 34) {
        const [lx, ly] = P(x + 7, z0, h0 + 30);
        c.fillStyle = '#efe9dc';
        c.fillRect(lx, ly, 42, 22);
        c.fillStyle = '#1b1b1b';
        for (let i = 0; i < 16; i++) c.fillRect(lx + 3 + i * 2.2, ly + 3, i % 3 ? 1 : 1.6, 9);
        c.font = '7px Consolas, monospace';
        c.fillText(b.code, lx + 3, ly + 19);
    }

    // símbolo "este lado para cima"
    const [sx, sy] = P(x + w - 16, z0, h0 + h - 8);
    c.fillStyle = 'rgba(40,25,10,0.55)';
    c.font = 'bold 10px Arial';
    c.fillText('↑↑', sx, sy + 8);

    // feixe do laser cruzando a caixa
    if (x < S.XS && x + w > S.XS) {
        c.save();
        c.shadowColor = '#ff2a2a';
        c.shadowBlur = 10;
        linha(P(S.XS, z0, h0), P(S.XS, z0, h0 + h), '#ff4a4a', 2);
        linha(P(S.XS, z0, h0 + h), P(S.XS, z0 + d, h0 + h), '#ff4a4a', 2);
        c.restore();
    }
}

function desenharCaixas() {
    const c = S.ctx, { BH } = S;
    c.save();
    c.beginPath();
    c.rect(S.X0, 0, S.X1 + S.D * OX - S.X0 + 10, S.LH);
    c.clip();

    for (const b of S.boxes) {
        poly([P(b.x + 3, b.z0 - 2, BH), P(b.x + b.w + 9, b.z0 - 2, BH), P(b.x + b.w + 9, b.z0 + b.d + 5, BH), P(b.x + 3, b.z0 + b.d + 5, BH)], 'rgba(0,0,0,0.45)');
    }
    [...S.boxes].sort((a, b) => b.z0 - a.z0).forEach(desenharCaixa);

    c.restore();
}

function desenharPortico() {
    const c = S.ctx, { BH, D, XS } = S;
    const on = rodando();

    // lâmina do laser
    poly([P(XS, 0, BH + 98), P(XS, D, BH + 98), P(XS, D, BH), P(XS, 0, BH)], `rgba(255,40,40,${on ? 0.10 : 0.05})`);

    // travessa e cabeça do scanner
    cuboid(XS - 7, -18, BH + 112, 14, D + 34, 12, '#c99b00');
    cuboid(XS - 13, D / 2 - 15, BH + 98, 26, 30, 14, '#2a2e33');
    c.save();
    c.shadowColor = '#ff2a2a';
    c.shadowBlur = 12;
    linha(P(XS, D / 2 - 13, BH + 98), P(XS, D / 2 + 13, BH + 98), '#ff3030', 3);
    c.restore();

    // listras na travessa
    for (let z = -16; z < D + 14; z += 14) {
        poly([P(XS - 7, z, BH + 112), P(XS - 7, z + 6, BH + 112), P(XS - 7, z + 10, BH + 124), P(XS - 7, z + 4, BH + 124)], 'rgba(20,20,20,0.6)');
    }
}

function desenharFrente() {
    const c = S.ctx, { BH, X0, X1, XS } = S;

    // correia de retorno e roletes
    poly([P(X0, 0, BH - 50), P(X1, 0, BH - 50), P(X1, 0, BH - 45), P(X0, 0, BH - 45)], '#121417');
    const ang = S.offset / 6;
    for (let x = X0 + S.TUN + 30; x < X1 - S.TUN - 10; x += 64) {
        const [rx, ry] = P(x, 0, BH - 57);
        circulo(rx, ry, 7, '#59616b', '#15171a', 2);
        c.save();
        c.translate(rx, ry);
        c.rotate(ang);
        c.fillStyle = '#15171a';
        c.fillRect(-1, -6, 2, 12);
        c.restore();
        circulo(rx, ry, 2, '#aab2bb');
    }

    // trilho frontal
    cuboid(X0, -6, BH - 30, X1 - X0, 6, 38, '#4a525c');
    linha(P(X0, -6, BH + 8), P(X1, -6, BH + 8), '#9aa3ad', 1.5);

    // faixa zebrada no trilho
    poly([P(X0, -6, BH - 30), P(X1, -6, BH - 30), P(X1, -6, BH - 23), P(X0, -6, BH - 23)], '#d4a800');
    for (let x = X0; x < X1; x += 18) {
        poly([P(x, -6, BH - 30), P(x + 7, -6, BH - 30), P(x + 14, -6, BH - 23), P(x + 7, -6, BH - 23)], '#141414');
    }

    // parafusos
    for (let x = X0 + 20; x < X1; x += 46) {
        const [bx, by] = P(x, -6, BH + 1);
        circulo(bx, by, 2.2, '#8a939d', '#2a2e33');
        const [bx2, by2] = P(x, -6, BH - 16);
        circulo(bx2, by2, 2.2, '#8a939d', '#2a2e33');
    }

    // setas de fluxo pintadas no trilho
    const cx = (X0 + S.TUN + XS) / 2;
    const dir = Math.sign(S.vel) || estado.sentido;
    for (let i = 0; i < 5; i++) {
        const fase = ((S.t * 2.5 - i * 0.25 * dir) % 1 + 1) % 1;
        const alpha = Math.abs(S.vel) > 1 ? 0.25 + 0.75 * Math.max(0, Math.sin(fase * Math.PI)) : 0.18;
        const x = cx + (i - 2) * 16;
        const [px, py] = P(x, -6, BH - 8);
        c.save();
        c.strokeStyle = `rgba(53,212,90,${alpha})`;
        c.shadowColor = '#35d45a';
        c.shadowBlur = alpha > 0.5 ? 8 : 0;
        c.lineWidth = 3;
        c.beginPath();
        c.moveTo(px - 4 * dir, py - 6);
        c.lineTo(px + 4 * dir, py);
        c.lineTo(px - 4 * dir, py + 6);
        c.stroke();
        c.restore();
    }

    // texto no trilho
    c.fillStyle = 'rgba(230,235,240,0.55)';
    c.font = '700 10px Consolas, monospace';
    const [tx, ty] = P(XS + 30, -6, BH - 12);
    c.fillText('TRANSPORTADOR M-01', tx, ty);

    // pernas frontais
    for (const x of posicoesPernas()) {
        cuboid(x, -4, 0, 12, 8, BH - 30, '#434a52');
        cuboid(x - 4, -8, 0, 20, 14, 3, '#2a2e33');
    }

    desenharMotor();

    // poste frontal do pórtico + display
    cuboid(XS - 5, -18, 0, 10, 8, BH + 122, '#d4a400');
    for (let h = 10; h < BH + 110; h += 22) {
        poly([P(XS - 5, -18, h), P(XS + 5, -18, h + 8), P(XS + 5, -18, h + 14), P(XS - 5, -18, h + 6)], 'rgba(20,20,20,0.7)');
    }
    desenharDisplayScanner();
}

function desenharMotor() {
    const c = S.ctx, { BH } = S;
    const xm = S.X1 - S.TUN - 160;
    const on = Math.abs(S.vel) > 1;

    cuboid(xm + 40, -22, BH - 56, 34, 16, 26, '#3a4047');
    cuboid(xm, -36, BH - 102, 112, 26, 48, '#2c5d8f');

    // aletas
    for (let h = BH - 97; h < BH - 58; h += 5) {
        linha(P(xm + 38, -36, h), P(xm + 108, -36, h), 'rgba(10,25,45,0.55)', 1.5);
    }

    // tampa do ventilador girando
    const [fx, fy] = P(xm + 18, -36, BH - 78);
    circulo(fx, fy, 15, '#1c2a3a', '#0e1620', 2);
    c.save();
    c.translate(fx, fy);
    c.rotate(S.offset / 3);
    c.fillStyle = 'rgba(150,175,200,0.75)';
    for (let i = 0; i < 5; i++) {
        c.rotate(Math.PI * 2 / 5);
        c.beginPath();
        c.ellipse(0, -7, 2.6, 6, 0.4, 0, Math.PI * 2);
        c.fill();
    }
    c.restore();
    circulo(fx, fy, 3, '#9aa3ad');
    c.strokeStyle = 'rgba(0,0,0,0.5)';
    for (let r = 6; r <= 14; r += 4) { c.beginPath(); c.arc(fx, fy, r, 0, Math.PI * 2); c.stroke(); }

    // placa e LED
    const [px, py] = P(xm + 46, -36, BH - 62);
    c.fillStyle = '#d9dee4';
    c.fillRect(px, py, 40, 12);
    c.fillStyle = '#1b1b1b';
    c.font = '700 8px Consolas, monospace';
    c.fillText('MOTOR M-01', px + 2, py + 9);

    const [lx, ly] = P(xm + 100, -36, BH - 66);
    c.save();
    if (on) { c.shadowColor = '#35d45a'; c.shadowBlur = 10; }
    circulo(lx, ly, 3.5, on ? '#6dff8a' : '#1e3a24', '#0a0a0a');
    c.restore();
}

function desenharDisplayScanner() {
    const c = S.ctx;
    const [x, y] = P(S.XS + 8, -18, S.BH + 92);
    const f = S.scanFlash;

    c.save();
    c.fillStyle = '#0a0c0e';
    c.strokeStyle = f > 0 ? `rgba(53,212,90,${0.4 + f * 0.6})` : '#333a42';
    c.lineWidth = 2;
    c.shadowColor = '#35d45a';
    c.shadowBlur = 14 * f;
    c.fillRect(x, y, 86, 36);
    c.strokeRect(x, y, 86, 36);
    c.restore();

    c.fillStyle = '#8b939e';
    c.font = '700 8px Consolas, monospace';
    c.fillText('SCANNER S-01', x + 6, y + 11);
    c.fillStyle = f > 0.2 ? '#7dff98' : '#35d45a';
    c.font = '700 14px Consolas, monospace';
    c.fillText((f > 0 ? '✓ ' : '  ') + S.lastScan, x + 4, y + 28);
}

function desenharTunel(x0, interno, rotulo) {
    const c = S.ctx, { BH, D, TUN } = S;
    const z = -12, d = D + 24, h = BH - 34, hh = 160;
    const base = '#363d45';

    // lateral, topo, frente
    poly([P(x0 + TUN, z, h), P(x0 + TUN, z + d, h), P(x0 + TUN, z + d, h + hh), P(x0 + TUN, z, h + hh)], shade(base, 0.7));

    if (interno) {
        // abertura com cortina de tiras
        poly([P(x0 + TUN, 2, BH - 2), P(x0 + TUN, D - 2, BH - 2), P(x0 + TUN, D - 2, BH + 98), P(x0 + TUN, 2, BH + 98)], '#050607');
        const sw = S.cortina;
        for (let zz = 4; zz < D - 6; zz += 9) {
            const balanco = sw * (10 + Math.sin(S.t * 9 + zz) * 3);
            poly([
                P(x0 + TUN, zz, BH + 98),
                P(x0 + TUN, zz + 7, BH + 98),
                P(x0 + TUN + balanco, zz + 7, BH),
                P(x0 + TUN + balanco, zz, BH)
            ], 'rgba(130,150,165,0.32)', 'rgba(0,0,0,0.3)');
        }
    }

    poly([P(x0, z, h + hh), P(x0 + TUN, z, h + hh), P(x0 + TUN, z + d, h + hh), P(x0, z + d, h + hh)], shade(base, 1.3));
    poly([P(x0, z, h), P(x0 + TUN, z, h), P(x0 + TUN, z, h + hh), P(x0, z, h + hh)], base);

    // faixa zebrada no topo da frente
    poly([P(x0, z, h + hh - 14), P(x0 + TUN, z, h + hh - 14), P(x0 + TUN, z, h + hh), P(x0, z, h + hh)], '#d4a800');
    c.save();
    c.beginPath();
    const r0 = P(x0, z, h + hh);
    c.rect(r0[0], r0[1], TUN, 14);
    c.clip();
    for (let x = x0 - 14; x < x0 + TUN; x += 16) {
        poly([P(x, z, h + hh - 14), P(x + 8, z, h + hh - 14), P(x + 22, z, h + hh), P(x + 14, z, h + hh)], '#141414');
    }
    c.restore();

    // grade de ventilação
    for (let i = 0; i < 6; i++) {
        linha(P(x0 + 18, z, h + 22 + i * 6), P(x0 + TUN - 18, z, h + 22 + i * 6), 'rgba(0,0,0,0.45)', 2);
    }

    // rótulo
    const [lx, ly] = P(x0 + TUN / 2, z, h + hh - 40);
    c.fillStyle = '#0d0f11';
    c.fillRect(lx - 40, ly - 14, 80, 24);
    c.fillStyle = rotulo === 'ENTRADA' ? '#35d45a' : '#ffab00';
    c.font = '800 13px "Segoe UI", Arial, sans-serif';
    c.textAlign = 'center';
    c.fillText(rotulo, lx, ly + 3);
    c.textAlign = 'left';

    // contorno
    poly([P(x0, z, h), P(x0 + TUN, z, h), P(x0 + TUN, z, h + hh), P(x0, z, h + hh)], null, 'rgba(255,255,255,0.06)');
}

function desenharGiroflex() {
    const c = S.ctx;
    const topo = S.BH - 34 + 160;
    const [bx, by] = P(S.X0 + S.TUN / 2, S.D / 2, topo);

    cuboid(S.X0 + S.TUN / 2 - 9, S.D / 2 - 6, topo, 18, 12, 6, '#22262b');

    const cy = by - 18;
    let cor = '#5a4300', ativo = false, vel = 5;
    if (estado.pausada) { cor = '#ff2a2a'; ativo = true; vel = 11; }
    else if (rodando()) { cor = '#ffab00'; ativo = true; }

    if (ativo) {
        c.save();
        c.globalCompositeOperation = 'lighter';
        const ang = S.t * vel;
        for (let k = 0; k < 2; k++) {
            const a = ang + k * Math.PI;
            const dx = Math.cos(a), dy = Math.sin(a) * 0.3;
            const L = 260;
            const g = c.createRadialGradient(bx, cy, 0, bx, cy, L);
            g.addColorStop(0, cor + 'aa');
            g.addColorStop(1, cor + '00');
            c.fillStyle = g;
            c.beginPath();
            c.moveTo(bx, cy);
            c.lineTo(bx + dx * L - dy * L * 0.35, cy + dy * L + dx * L * 0.12);
            c.lineTo(bx + dx * L + dy * L * 0.35, cy + dy * L - dx * L * 0.12);
            c.closePath();
            c.fill();
        }
        const pulso = 0.5 + 0.5 * Math.abs(Math.cos(ang));
        const gg = c.createRadialGradient(bx, cy, 0, bx, cy, 70);
        gg.addColorStop(0, cor + Math.round(80 + pulso * 100).toString(16));
        gg.addColorStop(1, cor + '00');
        c.fillStyle = gg;
        c.fillRect(bx - 70, cy - 70, 140, 140);
        c.restore();
    }

    // cúpula
    const gd = c.createRadialGradient(bx - 3, cy - 4, 1, bx, cy, 12);
    gd.addColorStop(0, ativo ? '#fff3d0' : '#8a6a10');
    gd.addColorStop(1, cor);
    c.fillStyle = gd;
    c.beginPath();
    c.moveTo(bx - 10, by - 6);
    c.lineTo(bx - 10, cy);
    c.arc(bx, cy, 10, Math.PI, 0);
    c.lineTo(bx + 10, by - 6);
    c.closePath();
    c.fill();
}

function desenharTorreSinal() {
    const c = S.ctx;
    const topo = S.BH - 34 + 160;
    const [bx, by] = P(S.X1 - S.TUN / 2, S.D / 2, topo);

    c.fillStyle = '#9aa3ad';
    c.fillRect(bx - 1.5, by - 18, 3, 18);

    const pisca = Math.floor(S.t * 3) % 2 === 0;
    const luzes = [
        { cor: '#e53935', on: estado.pausada && pisca },
        { cor: '#ffab00', on: !estado.ligada && !estado.pausada },
        { cor: '#35d45a', on: rodando() }
    ];

    luzes.forEach((l, i) => {
        const y = by - 18 - (3 - i) * 13;
        c.save();
        if (l.on) { c.shadowColor = l.cor; c.shadowBlur = 22; }
        c.fillStyle = l.on ? l.cor : shade(l.cor, 0.25);
        c.fillRect(bx - 7, y, 14, 12);
        c.fillStyle = l.on ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.06)';
        c.fillRect(bx - 5, y + 2, 3, 8);
        c.restore();
    });
    c.fillStyle = '#2a2e33';
    c.fillRect(bx - 8, by - 18 - 3 * 13 - 4, 16, 4);
}

function desenharLuzes(dt) {
    const c = S.ctx, { LW, LH } = S;
    const lampadas = [LW * 0.22, LW * 0.5, LW * 0.78];

    c.save();
    c.globalCompositeOperation = 'lighter';
    for (const lx of lampadas) {
        const g = c.createLinearGradient(0, 0, 0, LH);
        g.addColorStop(0, 'rgba(255,240,205,0.13)');
        g.addColorStop(1, 'rgba(255,240,205,0)');
        c.fillStyle = g;
        c.beginPath();
        c.moveTo(lx - 24, 6);
        c.lineTo(lx + 24, 6);
        c.lineTo(lx + 190, LH);
        c.lineTo(lx - 190, LH);
        c.closePath();
        c.fill();
    }

    // poeira no ar
    for (const p of S.dust) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.f += dt;
        if (p.y < -5) { p.y = LH + 5; p.x = Math.random() * LW; }
        if (p.x < -5) p.x = LW + 5;
        if (p.x > LW + 5) p.x = -5;
        const perto = Math.min(...lampadas.map(l => Math.abs(p.x - l) - p.y * 0.45));
        if (perto > 30) continue;
        const a = (0.35 + 0.35 * Math.sin(p.f * 2)) * (perto < 0 ? 1 : 1 - perto / 30);
        c.fillStyle = `rgba(255,240,210,${a})`;
        c.beginPath();
        c.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        c.fill();
    }
    c.restore();

    for (const lx of lampadas) {
        c.fillStyle = '#1b1e22';
        c.fillRect(lx - 32, 0, 64, 7);
        c.save();
        c.shadowColor = '#fff3d0';
        c.shadowBlur = 16;
        c.fillStyle = '#fff6dd';
        c.fillRect(lx - 26, 6, 52, 2.5);
        c.restore();
    }
}

function desenharAlarme() {
    if (!estado.pausada) return;
    const c = S.ctx, { LW, LH } = S;
    const p = 0.5 + 0.5 * Math.sin(S.t * 7);

    c.fillStyle = `rgba(229,57,53,${0.05 + 0.08 * p})`;
    c.fillRect(0, 0, LW, LH);

    const w = 380, h = 38, x = (LW - w) / 2, y = 54;
    c.fillStyle = 'rgba(0,0,0,0.8)';
    c.fillRect(x, y, w, h);
    c.strokeStyle = `rgba(229,57,53,${0.6 + 0.4 * p})`;
    c.lineWidth = 2;
    c.strokeRect(x, y, w, h);
    c.fillStyle = `rgba(255,80,70,${0.7 + 0.3 * p})`;
    c.font = '900 17px "Segoe UI", Arial, sans-serif';
    c.textAlign = 'center';
    c.fillText('⚠  PARADA DE EMERGÊNCIA  ⚠', LW / 2, y + 25);
    c.textAlign = 'left';
}

function desenharVinheta() {
    const c = S.ctx, { LW, LH } = S;
    const g = c.createRadialGradient(LW / 2, LH / 2, LH * 0.4, LW / 2, LH / 2, LW * 0.7);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.6)');
    c.fillStyle = g;
    c.fillRect(0, 0, LW, LH);
}

function desenharCena(dt) {
    const c = S.ctx;
    c.setTransform(S.dpr * S.s, 0, 0, S.dpr * S.s, 0, 0);

    desenharFundo();
    desenharEstruturaTraseira();
    desenharCorreia();
    desenharCaixas();
    desenharPortico();
    desenharFrente();

    const entradaEsq = estado.sentido === 1;
    desenharTunel(S.X0, true, entradaEsq ? 'ENTRADA' : 'SAÍDA');
    desenharTunel(S.X1 - S.TUN, false, entradaEsq ? 'SAÍDA' : 'ENTRADA');
    desenharGiroflex();
    desenharTorreSinal();

    desenharLuzes(dt);
    desenharAlarme();
    desenharVinheta();
}

let ultimo = performance.now();

function quadro(agora) {
    const dt = Math.min((agora - ultimo) / 1000, 0.1);
    ultimo = agora;
    S.t += dt;

    // aceleração/desaceleração suave
    const alvo = rodando() ? estado.rpm * PX_POR_RPM * estado.sentido : 0;
    S.vel += (alvo - S.vel) * Math.min(1, dt * 2.5);
    if (Math.abs(S.vel) < 0.3 && alvo === 0) S.vel = 0;

    const dx = S.vel * dt;
    S.offset += dx;
    moverCaixas(dx);

    S.scanFlash = Math.max(0, S.scanFlash - dt * 1.2);

    const xa = S.X0 + S.TUN;
    const passando = S.boxes.some(b => b.x < xa + 12 && b.x + b.w > xa - 12) && Math.abs(S.vel) > 1;
    S.cortina += ((passando ? 1 : 0) - S.cortina) * Math.min(1, dt * 6);

    desenharCena(dt);
    requestAnimationFrame(quadro);
}

// =====================================================
// BOOT
// =====================================================

async function boot() {
    const linhas = $('bootLines');
    const barra = $('bootFill');
    const espera = ms => new Promise(r => setTimeout(r, ms));
    const add = (rotulo, res, cls = '') => {
        const d = document.createElement('div');
        d.textContent = res ? `> ${rotulo} `.padEnd(34, '.') + ' ' + res : `> ${rotulo}`;
        if (cls) d.className = cls;
        linhas.appendChild(d);
    };

    add('CARREGANDO INTERFACE', 'OK'); barra.style.width = '25%'; await espera(320);
    add('RENDERIZANDO LINHA 01', 'OK'); barra.style.width = '50%'; await espera(320);

    let online = null;
    try {
        online = !!(await (await fetch('/status')).json()).online;
        add('SERVIDOR', 'OK');
    } catch (e) {
        add('SERVIDOR', 'FALHA', 'err');
    }
    barra.style.width = '75%'; await espera(320);

    if (online !== null) add('ARDUINO', online ? 'ONLINE' : 'OFFLINE', online ? '' : 'err');
    barra.style.width = '100%'; await espera(300);

    add('SISTEMA PRONTO'); await espera(500);
    $('boot').classList.add('hide');
}

// =====================================================
// INICIALIZAÇÃO
// =====================================================

document.addEventListener('DOMContentLoaded', () => {
    $('btnDireita').addEventListener('click', girarDireita);
    $('btnEsquerda').addEventListener('click', girarEsquerda);
    $('btnLigar').addEventListener('click', ativarAuto);
    $('btnDesligar').addEventListener('click', desativarAuto);
    $('btnPause').addEventListener('click', togglePause);
    $('sliderVelocidade').addEventListener('input', e => alterarVelocidade(e.target.value));

    const passo = (d) => {
        const sl = $('sliderVelocidade');
        const v = Math.min(20, Math.max(5, Number(sl.value) + d));
        if (v === Number(sl.value)) return;
        sl.value = v;
        alterarVelocidade(v);
    };
    $('btnMenos').addEventListener('click', () => passo(-1));
    $('btnMais').addEventListener('click', () => passo(1));
    $('btnSom').addEventListener('click', () => {
        som.on = !som.on;
        $('somTexto').textContent = som.on ? 'ON' : 'OFF';
        if (som.on) clique();
        atualizarZumbido();
    });

    criarGauge();

    S.cv = $('scene');
    S.ctx = S.cv.getContext('2d');
    layoutCena();

    let resizeTimer;
    new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(layoutCena, 100);
    }).observe(S.cv);

    atualizarPainel();
    registrar('Painel iniciado');

    verificarArduino();
    lerSerial();
    atualizarRelogio();
    setInterval(verificarArduino, 2000);
    setInterval(lerSerial, 1000);
    setInterval(atualizarRelogio, 1000);

    requestAnimationFrame(quadro);
    boot();
});
