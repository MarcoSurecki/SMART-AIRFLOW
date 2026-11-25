/*
  =====================================================================
   ESTEIRA INDUSTRIAL · Firmware do Arduino Uno
  =====================================================================

   LIGAÇÕES
   --------
   Motor de passo 28BYJ-48 + driver ULN2003
     IN1 -> pino 8      IN2 -> pino 9
     IN3 -> pino 10     IN4 -> pino 11
     Driver: + no 5V (de preferência fonte externa), - no GND.
     O GND da fonte externa precisa estar ligado ao GND do Arduino.

   Botão de emergência (cogumelo com trava)
     Contato entre o pino 13 e o GND (o pino usa o pull-up interno).
     Contato NF (normalmente fechado): solto = pino no GND, apertado =
     contato abre (o LED "L" da placa acende). Se o fio romper, a
     esteira entra em emergência (falha segura).
     Se usar um contato NA, troque EMERGENCIA_CONTATO_NF para false.

   Sensor de caixas (infravermelho tipo FC-51 / E18-D80NK)
     OUT -> pino 4, VCC -> 5V, GND -> GND.
     Sem sensor ligado, nada é contado.

   PROTOCOLO SERIAL (9600 baud, uma mensagem por linha)
   ---------------------------------------------------
   Recebe do painel:
     RIGHT / LEFT     sentido horário / anti-horário (com a esteira parada)
     AUTO_ON          liga a esteira (operação contínua)
     AUTO_OFF         desliga a esteira
     SPD_<5..20>      velocidade em RPM (ex.: SPD_12)
     PAUSE            parada de emergência pelo painel
     RESUME           retoma após a emergência (recusado se o
                      botão físico ainda estiver travado)
     STATUS           mostra o estado interno (diagnóstico)

   Envia para o painel:
     CAIXA            uma caixa passou pelo sensor
     EMERGENCIA       botão físico acionado (o painel entra em emergência)
     demais linhas    status, aparecem no campo SERIAL do painel
  =====================================================================
*/

// ---------------- CONFIGURAÇÃO ----------------

const byte PINOS_MOTOR[4] = {8, 9, 10, 11};
const byte PINO_EMERGENCIA = 13;
const byte PINO_SENSOR = 4;

const bool EMERGENCIA_CONTATO_NF = true;   // true = contato NF (atual), false = contato NA
const bool SENSOR_ATIVO_EM_LOW = true;     // FC-51 / E18-D80NK vão para LOW ao detectar
const bool INVERTER_SENTIDO = false;       // troque se "horário" girar ao contrário

const long PASSOS_POR_VOLTA = 2048;        // 28BYJ-48 em passo completo
const int RPM_MIN = 5;
const int RPM_MAX = 20;                    // acima de ~15 RPM o 28BYJ-48 pode perder força

const unsigned long TEMPO_MIN_ENTRE_CAIXAS_MS = 300;  // evita contar a mesma caixa duas vezes
const unsigned long DEBOUNCE_EMERGENCIA_MS = 30;

// passo completo com duas bobinas energizadas (mais torque)
const byte SEQUENCIA[4][4] = {
  {1, 1, 0, 0},
  {0, 1, 1, 0},
  {0, 0, 1, 1},
  {1, 0, 0, 1}
};

// ---------------- ESTADO ----------------

bool ligada = false;        // AUTO_ON / AUTO_OFF
bool emergencia = false;    // PAUSE ou botão físico
int sentido = 1;            // 1 = horário, -1 = anti-horário
int rpm = 10;

unsigned long intervaloPassoUs = 0;
unsigned long ultimoPassoUs = 0;
int fase = 0;

bool botaoTravado = false;            // estado já filtrado (debounce)
bool leituraBotaoAnterior = false;
unsigned long mudancaBotaoMs = 0;

bool caixaPresente = false;
unsigned long ultimaCaixaMs = 0;

char bufferSerial[24];
byte tamanhoBuffer = 0;

// ---------------- MOTOR ----------------

void calcularIntervalo() {
  intervaloPassoUs = 60000000UL / (PASSOS_POR_VOLTA * (unsigned long)rpm);
}

void aplicarFase(int f) {
  for (byte i = 0; i < 4; i++) {
    digitalWrite(PINOS_MOTOR[i], SEQUENCIA[f][i]);
  }
}

void desligarBobinas() {
  for (byte i = 0; i < 4; i++) {
    digitalWrite(PINOS_MOTOR[i], LOW);
  }
}

void darPasso() {
  int direcao = INVERTER_SENTIDO ? -sentido : sentido;
  fase = (fase + direcao + 4) % 4;
  aplicarFase(fase);
}

bool motorDeveGirar() {
  return ligada && !emergencia;
}

void atualizarMotor() {
  if (!motorDeveGirar()) return;

  unsigned long agora = micros();
  if (agora - ultimoPassoUs >= intervaloPassoUs) {
    // se atrasou muito (ex.: enquanto enviava pela serial), não tenta "compensar"
    if (agora - ultimoPassoUs > intervaloPassoUs * 4) {
      ultimoPassoUs = agora;
    } else {
      ultimoPassoUs += intervaloPassoUs;
    }
    darPasso();
  }
}

// ---------------- EMERGÊNCIA ----------------

bool lerBotaoBruto() {
  bool nivelAlto = digitalRead(PINO_EMERGENCIA) == HIGH;
  // NF: solto = contato fechado = LOW; apertado = contato aberto = HIGH
  // NA: solto = contato aberto = HIGH; apertado = contato fechado = LOW
  return EMERGENCIA_CONTATO_NF ? nivelAlto : !nivelAlto;
}

void entrarEmergencia() {
  emergencia = true;
  desligarBobinas();
}

void atualizarBotaoEmergencia() {
  bool leitura = lerBotaoBruto();

  if (leitura != leituraBotaoAnterior) {
    leituraBotaoAnterior = leitura;
    mudancaBotaoMs = millis();
  }

  if (millis() - mudancaBotaoMs < DEBOUNCE_EMERGENCIA_MS) return;
  if (leitura == botaoTravado) return;

  botaoTravado = leitura;

  if (botaoTravado) {
    entrarEmergencia();
    Serial.println("EMERGENCIA");
  } else {
    // destravar o botão NÃO religa a esteira: é preciso apertar RETOMAR no painel
    Serial.println("EMERGENCIA DESTRAVADA - APERTE RETOMAR");
  }
}

// ---------------- SENSOR DE CAIXAS ----------------

void atualizarSensor() {
  bool nivelBaixo = digitalRead(PINO_SENSOR) == LOW;
  bool detectando = SENSOR_ATIVO_EM_LOW ? nivelBaixo : !nivelBaixo;

  // conta só quando a caixa chega (borda), não enquanto ela está passando
  if (detectando && !caixaPresente && millis() - ultimaCaixaMs > TEMPO_MIN_ENTRE_CAIXAS_MS) {
    ultimaCaixaMs = millis();
    Serial.println("CAIXA");
  }
  caixaPresente = detectando;
}

// ---------------- COMANDOS ----------------

void informarBloqueio() {
  // o painel entende "EMERGENCIA" e volta para o modo de emergência
  Serial.println(botaoTravado ? "EMERGENCIA" : "PAUSADO - APERTE RETOMAR");
}

void executarComando(const char *cmd) {

  if (strcmp(cmd, "RIGHT") == 0 || strcmp(cmd, "LEFT") == 0) {
    if (ligada) {
      Serial.println("ERRO: DESLIGUE A ESTEIRA PARA TROCAR O SENTIDO");
      return;
    }
    sentido = (cmd[0] == 'R') ? 1 : -1;
    Serial.println(sentido == 1 ? "SENTIDO HORARIO" : "SENTIDO ANTI-HORARIO");
  }

  else if (strcmp(cmd, "AUTO_ON") == 0) {
    if (emergencia) {
      informarBloqueio();
      return;
    }
    ligada = true;
    ultimoPassoUs = micros();
    Serial.println("ESTEIRA LIGADA");
  }

  else if (strcmp(cmd, "AUTO_OFF") == 0) {
    ligada = false;
    desligarBobinas();
    Serial.println("ESTEIRA DESLIGADA");
  }

  else if (strncmp(cmd, "SPD_", 4) == 0) {
    rpm = constrain(atoi(cmd + 4), RPM_MIN, RPM_MAX);
    calcularIntervalo();
    Serial.print("VELOCIDADE ");
    Serial.print(rpm);
    Serial.println(" RPM");
  }

  else if (strcmp(cmd, "PAUSE") == 0) {
    entrarEmergencia();
    Serial.println("PAUSADO PELO PAINEL");
  }

  else if (strcmp(cmd, "RESUME") == 0) {
    if (botaoTravado) {
      Serial.println("EMERGENCIA");   // botão físico ainda travado: não retoma
      return;
    }
    emergencia = false;
    ultimoPassoUs = micros();
    Serial.println(ligada ? "ESTEIRA RETOMADA" : "EMERGENCIA LIBERADA");
  }

  else if (strcmp(cmd, "STATUS") == 0) {
    // diagnóstico: digite STATUS no Monitor Serial
    Serial.print("STATUS ligada=");
    Serial.print(ligada);
    Serial.print(" emergencia=");
    Serial.print(emergencia);
    Serial.print(" botao_travado=");
    Serial.print(botaoTravado);
    Serial.print(" pino13=");
    Serial.print(digitalRead(PINO_EMERGENCIA));
    Serial.print(" rpm=");
    Serial.print(rpm);
    Serial.print(" sentido=");
    Serial.println(sentido == 1 ? "horario" : "anti-horario");
  }

  else {
    Serial.print("ERRO: COMANDO DESCONHECIDO ");
    Serial.println(cmd);
  }
}

void lerSerial() {
  while (Serial.available()) {
    char c = Serial.read();

    if (c == '\n' || c == '\r') {
      if (tamanhoBuffer > 0) {
        bufferSerial[tamanhoBuffer] = '\0';
        executarComando(bufferSerial);
        tamanhoBuffer = 0;
      }
    } else if (tamanhoBuffer < sizeof(bufferSerial) - 1) {
      bufferSerial[tamanhoBuffer++] = toupper(c);
    }
  }
}

// ---------------- SETUP / LOOP ----------------

void setup() {
  Serial.begin(9600);

  for (byte i = 0; i < 4; i++) {
    pinMode(PINOS_MOTOR[i], OUTPUT);
  }
  desligarBobinas();

  pinMode(PINO_EMERGENCIA, INPUT_PULLUP);
  pinMode(PINO_SENSOR, INPUT_PULLUP);

  calcularIntervalo();

  // se ligar com o botão de emergência já travado, começa em emergência
  botaoTravado = lerBotaoBruto();
  leituraBotaoAnterior = botaoTravado;
  delay(100);

  if (botaoTravado) {
    entrarEmergencia();
    Serial.println("EMERGENCIA");
  } else {
    Serial.println("ESTEIRA PRONTA");
  }
}

void loop() {
  lerSerial();
  atualizarBotaoEmergencia();
  atualizarSensor();
  atualizarMotor();
}
