# Esteira Industrial

Protótipo de esteira transportadora controlada por um **Arduino Uno** e operada por um **painel IHM (Interface Homem-Máquina)** que roda no navegador. O painel liga e desliga a esteira, ajusta a velocidade e o sentido de giro, conta as caixas que passam pelo sensor e trata a parada de emergência, tanto pelo botão físico quanto pela tela.

## Funcionalidades

- **Liga / desliga** a esteira em operação contínua.
- **Velocidade ajustável** de 5 a 20 RPM, com indicador tipo manômetro.
- **Sentido de giro** horário ou anti-horário. Só muda com a esteira parada, por segurança.
- **Contador de caixas** com sensor ultrassônico: total e caixas por minuto, com botão para zerar.
- **Parada de emergência** por botão cogumelo com trava (contato NF, falha segura: fio rompido = emergência) ou pelo botão na tela.
- **Indicador de conexão** com o Arduino e reconexão automática se o cabo USB for desconectado.
- **Animação** da esteira (canvas), que acompanha o estado real (parada, girando, sentido).
- **Modo quiosque** para tela de toque de 7" (1024x600), abrindo sozinho ao ligar o computador.

## Arquitetura

```
┌──────────────────┐   HTTP (localhost:5001)   ┌──────────────┐   Serial USB 9600   ┌───────────────┐
│ Navegador        │ ────────────────────────▶ │ Servidor     │ ──────────────────▶ │ Arduino Uno   │
│ painel IHM       │ ◀──────────────────────── │ Flask (app.py)│ ◀────────────────── │ (esteira.ino) │
│ HTML / CSS / JS  │   estado em JSON          └──────────────┘                     └───────┬───────┘
└──────────────────┘                                                                        │
                                                          motor de passo · botão de emergência · sensor HC-SR04
```

1. O operador toca num botão do painel. O JavaScript envia o comando para o servidor (`POST /comando`).
2. O servidor Flask repassa o comando ao Arduino pela porta serial.
3. O Arduino aciona o motor e envia de volta mensagens como `CAIXA` (uma caixa passou) e `EMERGENCIA` (botão físico acionado).
4. O painel consulta `GET /estado` várias vezes por segundo e atualiza a tela.

O estado da esteira fica guardado no servidor. Assim a tela mostra o estado real mesmo depois de recarregar a página.

## Componentes

| Componente | Função |
|---|---|
| Arduino Uno | Controla o motor, lê o botão e o sensor |
| Motor de passo 28BYJ-48 + placa driver | Movimenta a correia |
| Botão de emergência cogumelo com trava (contato NF) | Parada de emergência física |
| Sensor ultrassônico HC-SR04 | Detecta e conta as caixas |
| Computador ou Raspberry Pi + tela de 7" (opcional) | Roda o servidor e o painel |

## Ligações

| Componente | Pino do componente | Arduino |
|---|---|---|
| Driver do motor | IN1 / IN2 / IN3 / IN4 | 8 / 9 / 10 / 11 |
| Driver do motor | + / − | 5V / GND |
| Botão de emergência | contato NF | entre o pino 13 e o GND (pull-up interno) |
| HC-SR04 | VCC / GND | 5V / GND |
| HC-SR04 | TRIG | 4 |
| HC-SR04 | ECHO | 2 (pino com interrupção, mede sem travar o motor) |

Os parâmetros (distâncias de detecção, limites de RPM, tipo de contato do botão etc.) ficam no início de [`arduino/esteira/esteira.ino`](arduino/esteira/esteira.ino), todos comentados.

## Como executar

### 1. Arduino

1. Abra `arduino/esteira/esteira.ino` na Arduino IDE.
2. Selecione a placa **Arduino Uno** e a porta correta.
3. Clique em **Carregar**.

### 2. Servidor e painel (Windows)

Requer Python 3.

```bash
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Abra **http://localhost:5001** no navegador.

A porta serial do Arduino é encontrada automaticamente. Para forçar uma porta específica, defina a variável de ambiente `ESTEIRA_PORTA` (ex.: `COM5` ou `/dev/ttyACM0`).

Para testar em tela cheia (modo quiosque) no Windows: `kiosk\testar_windows.bat` (sair com Alt+F4).

### 3. Linux / Raspberry Pi com tela de 7" (opcional)

```bash
bash kiosk/instalar_linux.sh
```

O script instala as dependências, dá permissão de acesso à porta serial e configura o painel para abrir em tela cheia quando o sistema liga. Depois é só reiniciar.

## Protocolo serial

Comunicação a 9600 baud, uma mensagem por linha.

**Painel → Arduino**

| Comando | Ação |
|---|---|
| `AUTO_ON` / `AUTO_OFF` | Liga / desliga a esteira |
| `RIGHT` / `LEFT` | Sentido horário / anti-horário (com a esteira parada) |
| `SPD_<5..20>` | Velocidade em RPM (ex.: `SPD_12`) |
| `PAUSE` | Parada de emergência pelo painel |
| `RESUME` | Retoma após a emergência (recusado se o botão físico ainda estiver travado) |
| `STATUS` | Mostra o estado interno (diagnóstico) |

**Arduino → Painel**

| Mensagem | Significado |
|---|---|
| `CAIXA` | Uma caixa passou pelo sensor |
| `EMERGENCIA` | Botão físico acionado |
| demais linhas | Mensagens de status, exibidas no campo SERIAL do painel |

## Estrutura do projeto

```
├── app.py                  Servidor Flask: comunicação serial e API do painel
├── requirements.txt        Dependências Python (Flask, pyserial)
├── arduino/
│   └── esteira/esteira.ino Firmware do Arduino
├── templates/
│   └── index.html          Página do painel IHM
├── static/
│   ├── style.css           Visual do painel
│   ├── script.js           Lógica da tela e animação da esteira
│   └── img/logo.png
└── kiosk/                  Scripts de modo quiosque (Windows e Linux)
```

## Tecnologias

- **Arduino (C++)**: controle do motor de passo, leitura do sensor e do botão.
- **Python + Flask**: servidor web e ponte com a porta serial (pyserial).
- **HTML, CSS e JavaScript**: painel IHM, com a animação da esteira desenhada em canvas.
