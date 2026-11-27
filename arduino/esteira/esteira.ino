/*
  =====================================================================
   ESTEIRA INDUSTRIAL · Firmware do Arduino Uno
  =====================================================================

   LIGAÇÕES
   --------
   Motor de passo 28BYJ-48 + placa driver do motor
     IN1 -> pino 8      IN2 -> pino 9
     IN3 -> pino 10     IN4 -> pino 11
     Driver: + no 5V do Arduino, - no GND.

   Botão de emergência (cogumelo com trava)
     Contato entre o pino 13 e o GND (o pino usa o pull-up interno).
     Contato NF (normalmente fechado): solto = pino no GND,
     travado = contato abre e o pino vai para HIGH. Fio rompido =
     emergência (falha segura). Conferido na placa: solto pino13=0,
     travado pino13=1.
     Se usar um contato NA, troque EMERGENCIA_CONTATO_NF para false.

   Sensor de caixas (ultrassônico HC-SR04)
     VCC -> 5V, TRIG -> pino 4, ECHO -> pino 2, GND -> GND.
     Conta uma caixa quando algo chega a menos de DIST_DETECTA_CM
     do sensor. Sem sensor ligado, nada é contado.

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

const byte PINOS_MOTOR[4] = {8, 9, 10, 11};   // pinos de saída para IN1, IN2, IN3 e IN4 do driver do motor
const byte PINO_EMERGENCIA = 13;              // pino de entrada do botão de emergência
const byte PINO_TRIG = 4;                     // pino de saída do TRIG do sensor (dispara a medida)
const byte PINO_ECHO = 2;                     // pino de entrada do ECHO; o pino 2 tem interrupção e mede o eco sem travar o motor

const bool EMERGENCIA_CONTATO_NF = true;      // tipo do contato do botão: true = NF (usado), false = NA

const int DIST_DETECTA_CM = 8;                // abaixo dessa distância (cm) tem caixa na frente do sensor
const int DIST_LIBERA_CM = 12;                // acima dessa distância (cm) a caixa já saiu da frente
const unsigned long INTERVALO_MEDIDA_MS = 60; // tempo entre uma medida e outra do sensor (o HC-SR04 pede ~60 ms)
const byte LEITURAS_PARA_CONTAR = 2;          // quantas leituras "perto" seguidas para contar uma caixa (ignora ruído)
const unsigned long TEMPO_LIBERA_MS = 500;    // tempo sem ver a caixa para liberar a contagem da próxima
const bool INVERTER_SENTIDO = false;          // troque para true se o "horário" girar ao contrário

const long PASSOS_POR_VOLTA = 2048;           // passos para o eixo do 28BYJ-48 dar uma volta (passo completo)
const int RPM_MIN = 5;                        // velocidade mínima permitida
const int RPM_MAX = 20;                       // velocidade máxima permitida (acima disso o motor perde força)

const unsigned long TEMPO_MIN_ENTRE_CAIXAS_MS = 300;  // tempo mínimo entre duas contagens (evita contar duas vezes)
const unsigned long DEBOUNCE_EMERGENCIA_MS = 30;      // tempo que o botão precisa ficar estável para valer

const byte SEQUENCIA[4][4] = {                // ordem de acionamento das bobinas (passo completo, 2 bobinas por vez)
  {1, 1, 0, 0},                               // fase 0: bobinas A e B ligadas
  {0, 1, 1, 0},                               // fase 1: bobinas B e C ligadas
  {0, 0, 1, 1},                               // fase 2: bobinas C e D ligadas
  {1, 0, 0, 1}                                // fase 3: bobinas D e A ligadas
};

// ---------------- ESTADO ----------------

bool ligada = false;                  // true quando o painel mandou ligar (AUTO_ON)
bool emergencia = false;              // true quando há parada de emergência (botão físico ou PAUSE)
int sentido = 1;                      // sentido de giro: 1 = horário, -1 = anti-horário
int rpm = 10;                         // velocidade atual em RPM (começa em 10)

unsigned long intervaloPassoUs = 0;   // tempo entre um passo e outro, em microssegundos
unsigned long ultimoPassoUs = 0;      // momento em que foi dado o último passo
int fase = 0;                         // linha da SEQUENCIA aplicada agora (0 a 3)

bool botaoTravado = false;            // estado do botão já filtrado pelo debounce
bool leituraBotaoAnterior = false;    // última leitura do botão (para saber se mudou)
unsigned long mudancaBotaoMs = 0;     // momento da última mudança na leitura do botão

bool caixaPresente = false;           // true enquanto tem uma caixa na frente do sensor
unsigned long ultimaCaixaMs = 0;      // momento da última caixa contada
unsigned long ultimaMedidaMs = 0;     // momento do último disparo do sensor
unsigned long ultimoPertoMs = 0;      // última vez que o sensor viu algo perto
byte leiturasPerto = 0;               // quantas leituras "perto" seguidas aconteceram
int distanciaCm = -1;                 // última distância medida (-1 = ainda sem leitura)

volatile unsigned long inicioEcoUs = 0;   // momento em que o ECHO subiu (alterada na interrupção)
volatile unsigned long duracaoEcoUs = 0;  // tempo que o ECHO ficou em HIGH (alterada na interrupção)
volatile bool ecoNovo = false;            // avisa que chegou uma medida nova (alterada na interrupção)

char bufferSerial[24];                // guarda os caracteres do comando que está chegando
byte tamanhoBuffer = 0;               // quantos caracteres já estão no buffer

// ---------------- MOTOR ----------------

void calcularIntervalo() {                                                    // calcula o tempo entre passos a partir do RPM
  intervaloPassoUs = 60000000UL / (PASSOS_POR_VOLTA * (unsigned long)rpm);     // 1 minuto em µs dividido pelos passos por minuto
}

void aplicarFase(int f) {                        // liga/desliga as bobinas conforme a fase f
  for (byte i = 0; i < 4; i++) {                 // percorre os 4 pinos do motor
    digitalWrite(PINOS_MOTOR[i], SEQUENCIA[f][i]); // escreve 1 ou 0 da tabela em cada pino
  }
}

void desligarBobinas() {                         // desliga todas as bobinas (motor solto, não esquenta)
  for (byte i = 0; i < 4; i++) {                 // percorre os 4 pinos do motor
    digitalWrite(PINOS_MOTOR[i], LOW);           // coloca o pino em nível baixo
  }
}

void darPasso() {                                        // avança o motor um passo
  int direcao = INVERTER_SENTIDO ? -sentido : sentido;   // inverte o sentido se a fiação estiver ao contrário
  fase = (fase + direcao + 4) % 4;                       // próxima fase, sempre entre 0 e 3
  aplicarFase(fase);                                     // aplica a nova fase nas bobinas
}

bool motorDeveGirar() {                // diz se o motor pode girar agora
  return ligada && !emergencia;        // só gira ligado e sem emergência
}

void atualizarMotor() {                                  // chamada no loop: dá o passo quando chega a hora
  if (!motorDeveGirar()) return;                         // parado ou em emergência: não faz nada

  unsigned long agora = micros();                        // lê o tempo atual em microssegundos
  if (agora - ultimoPassoUs >= intervaloPassoUs) {       // já passou o tempo de um passo?
    if (agora - ultimoPassoUs > intervaloPassoUs * 4) {  // atrasou muito (ex.: enviando pela serial)?
      ultimoPassoUs = agora;                             // recomeça a contagem sem tentar compensar (evita tranco)
    } else {                                             // atraso pequeno
      ultimoPassoUs += intervaloPassoUs;                 // marca o próximo passo mantendo a velocidade certa
    }
    darPasso();                                          // dá o passo
  }
}

// ---------------- EMERGÊNCIA ----------------

bool lerBotaoBruto() {                                      // lê o botão e diz se está acionado (sem debounce)
  bool nivelAlto = digitalRead(PINO_EMERGENCIA) == HIGH;    // true se o pino 13 está em HIGH
  return EMERGENCIA_CONTATO_NF ? nivelAlto : !nivelAlto;    // NF: HIGH = travado; NA: LOW = travado
}

void entrarEmergencia() {      // coloca a esteira em emergência
  emergencia = true;           // marca a emergência
  desligarBobinas();           // para o motor na hora
}

void atualizarBotaoEmergencia() {                              // chamada no loop: trata o botão com debounce
  bool leitura = lerBotaoBruto();                              // lê o botão agora

  if (leitura != leituraBotaoAnterior) {                       // a leitura mudou desde a última vez?
    leituraBotaoAnterior = leitura;                            // guarda a nova leitura
    mudancaBotaoMs = millis();                                 // guarda quando mudou
  }

  if (millis() - mudancaBotaoMs < DEBOUNCE_EMERGENCIA_MS) return;  // ainda não ficou 30 ms estável: espera
  if (leitura == botaoTravado) return;                             // não mudou de estado: nada a fazer

  botaoTravado = leitura;                                      // aceita o novo estado do botão

  if (botaoTravado) {                                          // botão foi travado
    entrarEmergencia();                                        // para a esteira
    Serial.println("EMERGENCIA");                              // avisa o painel
  } else {                                                     // botão foi destravado
    Serial.println("EMERGENCIA DESTRAVADA - APERTE RETOMAR");  // avisa o painel (não religa sozinho)
  }
}

// ---------------- SENSOR DE CAIXAS ----------------

void medirEco() {                              // interrupção: chamada sempre que o pino ECHO muda
  if (digitalRead(PINO_ECHO) == HIGH) {        // ECHO subiu: o som acabou de sair
    inicioEcoUs = micros();                    // guarda o momento do início
  } else {                                     // ECHO desceu: o eco voltou
    duracaoEcoUs = micros() - inicioEcoUs;     // calcula quanto tempo ficou em HIGH
    ecoNovo = true;                            // avisa que tem medida nova
  }
}

void dispararSensor() {              // manda o sensor fazer uma medida
  digitalWrite(PINO_TRIG, HIGH);     // liga o TRIG
  delayMicroseconds(10);             // espera 10 µs (pulso mínimo do HC-SR04)
  digitalWrite(PINO_TRIG, LOW);      // desliga o TRIG: o sensor emite o ultrassom
}

void atualizarSensor() {                                       // chamada no loop: mede e conta as caixas
  if (ecoNovo) {                                               // chegou uma medida nova?
    noInterrupts();                                            // pausa as interrupções para copiar com segurança
    unsigned long duracao = duracaoEcoUs;                      // copia o tempo do eco
    ecoNovo = false;                                           // marca a medida como lida
    interrupts();                                              // volta as interrupções

    distanciaCm = (duracao > 0 && duracao < 30000UL) ? (int)(duracao / 58) : 999;  // converte em cm (sem eco = 999, longe)

    bool perto = distanciaCm > 0 && distanciaCm < DIST_DETECTA_CM;  // tem caixa na frente?
    bool longe = distanciaCm > DIST_LIBERA_CM;                      // a frente do sensor está livre?

    if (perto) {                                               // leitura perto
      ultimoPertoMs = millis();                                // guarda quando viu a caixa
      if (leiturasPerto < 255) leiturasPerto++;                // soma uma leitura perto (sem passar de 255)
    } else {                                                   // leitura longe
      leiturasPerto = 0;                                       // zera a sequência de leituras perto
    }

    if (!caixaPresente && leiturasPerto >= LEITURAS_PARA_CONTAR) {  // não tinha caixa e já teve leituras perto suficientes
      caixaPresente = true;                                    // marca que a caixa chegou
      if (millis() - ultimaCaixaMs > TEMPO_MIN_ENTRE_CAIXAS_MS) {  // passou o tempo mínimo desde a última caixa?
        ultimaCaixaMs = millis();                              // guarda quando contou
        Serial.println("CAIXA");                               // avisa o painel: +1 caixa
      }
    } else if (caixaPresente && longe && millis() - ultimoPertoMs > TEMPO_LIBERA_MS) {  // caixa saiu e ficou 500 ms sem ver
      caixaPresente = false;                                   // libera para contar a próxima
    }
  }

  if (millis() - ultimaMedidaMs >= INTERVALO_MEDIDA_MS) {      // já passou o tempo para outra medida?
    ultimaMedidaMs = millis();                                 // guarda quando disparou
    dispararSensor();                                          // dispara o sensor
  }
}

// ---------------- COMANDOS ----------------

void informarBloqueio() {                                                  // avisa por que não pode ligar
  Serial.println(botaoTravado ? "EMERGENCIA" : "PAUSADO - APERTE RETOMAR"); // botão travado ou parada pela tela
}

void executarComando(const char *cmd) {                        // executa o comando recebido do painel

  if (strcmp(cmd, "RIGHT") == 0 || strcmp(cmd, "LEFT") == 0) { // comando de sentido
    if (ligada) {                                              // esteira ligada?
      Serial.println("ERRO: DESLIGUE A ESTEIRA PARA TROCAR O SENTIDO");  // não deixa inverter girando
      return;                                                  // sai sem trocar
    }
    sentido = (cmd[0] == 'R') ? 1 : -1;                        // RIGHT = horário, LEFT = anti-horário
    Serial.println(sentido == 1 ? "SENTIDO HORARIO" : "SENTIDO ANTI-HORARIO");  // confirma para o painel
  }

  else if (strcmp(cmd, "AUTO_ON") == 0) {                      // comando ligar
    if (emergencia) {                                          // em emergência?
      informarBloqueio();                                      // avisa o motivo
      return;                                                  // não liga
    }
    ligada = true;                                             // liga a esteira
    ultimoPassoUs = micros();                                  // começa a contar o tempo do motor agora
    Serial.println("ESTEIRA LIGADA");                          // confirma para o painel
  }

  else if (strcmp(cmd, "AUTO_OFF") == 0) {                     // comando desligar
    ligada = false;                                            // desliga a esteira
    desligarBobinas();                                         // solta o motor
    Serial.println("ESTEIRA DESLIGADA");                       // confirma para o painel
  }

  else if (strncmp(cmd, "SPD_", 4) == 0) {                     // comando de velocidade (SPD_n)
    rpm = constrain(atoi(cmd + 4), RPM_MIN, RPM_MAX);          // lê o número depois de "SPD_" e limita entre 5 e 20
    calcularIntervalo();                                       // recalcula o tempo entre passos
    Serial.print("VELOCIDADE ");                               // confirma para o painel...
    Serial.print(rpm);                                         // ...o valor...
    Serial.println(" RPM");                                    // ...e a unidade
  }

  else if (strcmp(cmd, "PAUSE") == 0) {                        // emergência pelo botão da tela
    entrarEmergencia();                                        // para a esteira
    Serial.println("PAUSADO PELO PAINEL");                     // confirma para o painel
  }

  else if (strcmp(cmd, "RESUME") == 0) {                       // comando retomar
    if (botaoTravado) {                                        // botão físico ainda travado?
      Serial.println("EMERGENCIA");                            // continua em emergência
      return;                                                  // não retoma
    }
    emergencia = false;                                        // sai da emergência
    ultimoPassoUs = micros();                                  // reinicia o tempo do motor
    Serial.println(ligada ? "ESTEIRA RETOMADA" : "EMERGENCIA LIBERADA");  // confirma para o painel
  }

  else if (strcmp(cmd, "STATUS") == 0) {                       // diagnóstico (digitar STATUS no Monitor Serial)
    Serial.print("STATUS ligada=");                            // mostra se está ligada
    Serial.print(ligada);
    Serial.print(" emergencia=");                              // mostra se está em emergência
    Serial.print(emergencia);
    Serial.print(" botao_travado=");                           // mostra o estado do botão
    Serial.print(botaoTravado);
    Serial.print(EMERGENCIA_CONTATO_NF ? " contato=NF" : " contato=NA");  // mostra o tipo de contato
    Serial.print(" pino13=");                                  // mostra a leitura direta do pino 13
    Serial.print(digitalRead(PINO_EMERGENCIA));
    Serial.print(" distancia_cm=");                            // mostra a última distância do sensor
    Serial.print(distanciaCm);
    Serial.print(" rpm=");                                     // mostra a velocidade
    Serial.print(rpm);
    Serial.print(" sentido=");                                 // mostra o sentido
    Serial.println(sentido == 1 ? "horario" : "anti-horario");
  }

  else {                                                       // qualquer outro texto
    Serial.print("ERRO: COMANDO DESCONHECIDO ");               // avisa que não entendeu...
    Serial.println(cmd);                                       // ...e mostra o que chegou
  }
}

void lerSerial() {                                             // chamada no loop: lê os comandos da USB
  while (Serial.available()) {                                 // enquanto tiver caractere chegando
    char c = Serial.read();                                    // lê um caractere

    if (c == '\n' || c == '\r') {                              // fim da linha: comando completo
      if (tamanhoBuffer > 0) {                                 // ignora linha vazia
        bufferSerial[tamanhoBuffer] = '\0';                    // fecha o texto (fim de string em C)
        executarComando(bufferSerial);                         // executa o comando
        tamanhoBuffer = 0;                                     // limpa o buffer para o próximo
      }
    } else if (tamanhoBuffer < sizeof(bufferSerial) - 1) {     // ainda cabe no buffer?
      bufferSerial[tamanhoBuffer++] = toupper(c);              // guarda o caractere em maiúscula
    }
  }
}

// ---------------- SETUP / LOOP ----------------

void setup() {                                     // roda uma vez quando a placa liga
  Serial.begin(9600);                              // abre a serial a 9600 baud (mesma do painel)

  for (byte i = 0; i < 4; i++) {                   // percorre os 4 pinos do motor
    pinMode(PINOS_MOTOR[i], OUTPUT);               // configura como saída
  }
  desligarBobinas();                               // começa com o motor desligado

  pinMode(PINO_EMERGENCIA, INPUT_PULLUP);          // botão como entrada com resistor interno ligado ao 5V
  pinMode(PINO_TRIG, OUTPUT);                      // TRIG como saída
  digitalWrite(PINO_TRIG, LOW);                    // TRIG começa desligado
  pinMode(PINO_ECHO, INPUT);                       // ECHO como entrada
  attachInterrupt(digitalPinToInterrupt(PINO_ECHO), medirEco, CHANGE);  // chama medirEco() a cada mudança do ECHO

  calcularIntervalo();                             // calcula o tempo entre passos para 10 RPM

  botaoTravado = lerBotaoBruto();                  // lê o botão ao ligar
  leituraBotaoAnterior = botaoTravado;             // usa essa leitura como ponto de partida do debounce
  delay(100);                                      // espera a serial estabilizar

  if (botaoTravado) {                              // ligou com o botão já travado?
    entrarEmergencia();                            // começa em emergência
    Serial.println("EMERGENCIA");                  // avisa o painel
  } else {                                         // botão solto
    Serial.println(EMERGENCIA_CONTATO_NF ? "ESTEIRA PRONTA (BOTAO NF)" : "ESTEIRA PRONTA (BOTAO NA)");  // avisa que está pronta
  }
}

void loop() {                    // repete sem parar
  lerSerial();                   // 1) lê os comandos do painel
  atualizarBotaoEmergencia();    // 2) verifica o botão de emergência
  atualizarSensor();             // 3) mede a distância e conta as caixas
  atualizarMotor();              // 4) dá o passo do motor quando for a hora
}
