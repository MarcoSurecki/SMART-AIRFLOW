/*
  TESTE DE PINOS · descobre o que está ligado em cada pino do Arduino Uno

  Abra o Monitor Serial em 9600 baud e siga as mensagens.

  1) Ao ligar, verifica quais pinos estão ligados ao GND (ex.: botão de
     emergência com contato fechado). Esses pinos NÃO são ligados como
     saída, para não dar curto.
  2) Liga um pino por vez durante 2 segundos. Observe a sua placa driver
     e anote qual LED / bobina do motor acende em cada pino.
  3) Depois fica 10 segundos só LENDO os pinos: aperte e solte o botão de
     emergência nesse momento e veja qual pino muda.

  IMPORTANTE: deixe o botão de emergência SOLTO (destravado) durante a
  etapa 2.

  Pinos 0 e 1 não são testados (são da comunicação serial).
*/

const byte PINOS[] = {2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, A0, A1, A2, A3, A4, A5};
const byte QTD = sizeof(PINOS);

bool ligadoAoGnd[QTD];

void imprimirPino(byte p) {
  if (p >= A0) {
    Serial.print('A');
    Serial.print(p - A0);
  } else {
    Serial.print(p);
  }
}

void todosComoEntrada() {
  for (byte i = 0; i < QTD; i++) {
    pinMode(PINOS[i], INPUT_PULLUP);
  }
  delay(5);
}

void setup() {
  Serial.begin(9600);
  delay(500);
  Serial.println();
  Serial.println("===== TESTE DE PINOS =====");

  todosComoEntrada();
  Serial.print("Pinos ligados ao GND (nao serao acionados): ");
  bool algum = false;
  for (byte i = 0; i < QTD; i++) {
    ligadoAoGnd[i] = digitalRead(PINOS[i]) == LOW;
    if (ligadoAoGnd[i]) {
      imprimirPino(PINOS[i]);
      Serial.print(' ');
      algum = true;
    }
  }
  Serial.println(algum ? "" : "nenhum");
}

void testarSaidas() {
  Serial.println();
  Serial.println("--- ETAPA 2: ligando um pino por vez (botao de emergencia SOLTO) ---");

  for (byte i = 0; i < QTD; i++) {
    if (ligadoAoGnd[i]) continue;

    for (byte j = 0; j < QTD; j++) {
      if (!ligadoAoGnd[j]) {
        pinMode(PINOS[j], OUTPUT);
        digitalWrite(PINOS[j], LOW);
      }
    }

    Serial.print(">>> PINO ");
    imprimirPino(PINOS[i]);
    Serial.println(" LIGADO");

    digitalWrite(PINOS[i], HIGH);
    delay(2000);
    digitalWrite(PINOS[i], LOW);
  }
}

void monitorarEntradas() {
  Serial.println();
  Serial.println("--- ETAPA 3: 10 s lendo os pinos. APERTE e SOLTE o botao de emergencia agora ---");

  todosComoEntrada();
  bool anterior[QTD];
  for (byte i = 0; i < QTD; i++) anterior[i] = digitalRead(PINOS[i]);

  unsigned long inicio = millis();
  while (millis() - inicio < 10000) {
    for (byte i = 0; i < QTD; i++) {
      bool v = digitalRead(PINOS[i]);
      if (v != anterior[i]) {
        anterior[i] = v;
        Serial.print("    PINO ");
        imprimirPino(PINOS[i]);
        Serial.println(v ? " mudou para 1 (aberto)" : " mudou para 0 (ligado ao GND)");
      }
    }
    delay(20);
  }
  Serial.println("----- reiniciando o teste -----");
}

void loop() {
  testarSaidas();
  monitorarEntradas();

  // atualiza a lista de pinos ligados ao GND antes de repetir
  todosComoEntrada();
  for (byte i = 0; i < QTD; i++) {
    ligadoAoGnd[i] = digitalRead(PINOS[i]) == LOW;
  }
  delay(2000);
}
