<div align="center">

# 🚀 AOtravel App
### O Futuro da Mobilidade & Finanças em Angola

![Version](https://img.shields.io/badge/version-11.0.0--GOLD--ARMORED-blueviolet?style=for-the-badge)
![Status](https://img.shields.io/badge/status-PRODUCTION%20READY-success?style=for-the-badge)
![Stack](https://img.shields.io/badge/Node.js-PostgreSQL-blue?style=for-the-badge&logo=node.js)
![Realtime](https://img.shields.io/badge/Socket.IO-Titanium%20Engine-orange?style=for-the-badge)

<p align="center">
  <em>"Mais do que um aplicativo de transporte. Um ecossistema financeiro sobre rodas."</em>
</p>

</div>

---

## 🎨 A Visão (Design & Arquitetura)

Desenvolvido sob a filosofia **"Titanium Architecture"**, o backend do AOtravel não foi apenas codificado; ele foi **arquitetado** para resistir à instabilidade de redes móveis (3G/4G), garantir integridade financeira absoluta (ACID) e escalar horizontalmente.

Combinamos a agilidade de um **App de Mobilidade** com a segurança rigorosa de uma **Fintech**, tudo em um único monólito modularizado e resiliente.

---

## 💎 Funcionalidades Estelares

### 🚕 Módulo de Mobilidade (Ride Engine)
O coração pulsante do sistema. Não apenas conecta A ao B, mas orquestra a logística.

*   **📍 Radar em Tempo Real (Socket.IO):** Rastreamento de motoristas com atualização de alta frequência (High-Frequency GPS Updates) e baixo consumo de dados.
*   **🧠 Algoritmo de Dispatch Inteligente:** Encontra o motorista ideal baseado em raio geográfico, rating e tipo de veículo, reduzindo o tempo de espera (ETA).
*   **💰 Precificação Dinâmica Híbrida:** Calcula tarifas baseadas em distância (Haversine), tempo e demanda, com suporte para negociação (Offer/Bid) em futuras versões.
*   **🛡️ Segurança da Viagem:** Monitoramento da rota e botão de pânico integrado.

### 🏦 Módulo Financeiro (Titanium Wallet)
Um banco digital completo dentro do app.

*   **🔐 Transações ACID (Atomicity):** Garantia de que o dinheiro nunca se perde. Ou a transação acontece totalmente, ou nada acontece. Zero inconsistência.
*   **💸 Pagamentos P2P Instantâneos:** Transferências entre usuários via número de telefone ou QR Code.
*   **🧾 Pagamento de Serviços (Integração Local):** Liquidação de faturas de serviços essenciais (ENDE, EPAL, ZAP, UNITEL) direto do saldo da carteira.
*   **🏦 Saques & Depósitos:** Integração (simulada) com gateways bancários (MCX/GPE) e gestão de IBANs.
*   **💳 Cartões Virtuais:** Geração e gestão de cartões para uso seguro.

### 👮 Módulo de Segurança & Compliance (KYC)
*   **🆔 Verificação de Identidade (KYC Level 2):** Upload e análise de BI e Carta de Condução com auditoria administrativa.
*   **📱 Device Fingerprinting:** Rastreamento de sessões por dispositivo e IP para prevenir fraudes e Account Takeover.
*   **🛑 Kill Switch Administrativo:** Bloqueio instantâneo de contas e congelamento de carteiras suspeitas.

---

## 🚀 Diferenciais Competitivos (O "Toque Augusto Neves")

O que torna o AOtravel único no mercado angolano e global?

| Diferencial | Descrição |
| :---        | :---      |
| **📡 Modo "Network-Resilient"** | O Socket.IO foi configurado com *Heartbeats* agressivos e reconexão inteligente para suportar as oscilações das redes móveis locais sem perder o estado da corrida. |
| **🛡️ Auto-Healing Database** | O sistema detecta colunas faltantes no banco de dados e aplica correções (Schema Repair) automaticamente no boot, sem downtime. |
| **💾 Double-Entry Ledger** | Sistema de contabilidade de dupla entrada para a Wallet. Cada centavo é rastreado da origem ao destino. Auditabilidade total. |
| **⚡ Smart Caching (Lazy Load)** | Carregamento inteligente de dados de perfil e estatísticas para garantir que o app abra em milissegundos. |
| **🇦🇴 Localização Profunda** | Validação nativa de números de telefone (+244), IBANs (AO06) e integração cultural nos fluxos de UX. |

---

## 🔮 Roadmap de Expansão (O Futuro)

Para onde vamos? O céu não é o limite.

### 1. AOtravel Super Delivery 🍔📦
*   Expansão do `rideRoutes` para suportar `delivery_type`.
*   Gestão de frotas de motoboys.
*   Rastreamento de encomendas em tempo real.

### 2. Integração IoT (Hardware) 🚗
*   Leitura OBD-II para telemetria do veículo (combustível, manutenção).
*   Bloqueio remoto do veículo em caso de roubo via API do Backend.

### 3. Fintech 2.0 (Microcrédito) 📈
*   Análise de score de crédito baseado no histórico de corridas e pagamentos.
*   Oferta de micro-empréstimos para motoristas (manutenção/combustível) descontados automaticamente dos ganhos.

### 4. Inteligência Artificial (AI Core) 🤖
*   **Previsão de Demanda:** Usar ML para posicionar motoristas antes que o passageiro chame.
*   **Detecção de Fraude:** IA analisando padrões de GPS e transações financeiras anômalas.

---

## 🛠️ Stack Tecnológica

<div align="center">

| Categoria | Tecnologia | Uso |
| :---      | :---       | :--- |
| **Core**     | ![NodeJS](https://img.shields.io/badge/-Node.js-339933?style=flat&logo=node.js&logoColor=white) | Runtime de alta performance |
| **Framework* | ![Express](https://img.shields.io/badge/-Express-000000?style=flat&logo=express&logoColor=white) | API RESTful e Roteamento |
| **Database** | ![Postgres](https://img.shields.io/badge/-PostgreSQL-4169E1?style=flat&logo=postgresql&logoColor=white) | Neon Tech (Cloud Serverless) |
| **Realtime** | ![SocketIO](https://img.shields.io/badge/-Socket.IO-010101?style=flat&logo=socket.io&logoColor=white) | Comunicação Bidirecional |
| **Security** | ![Bcrypt](https://img.shields.io/badge/-Bcrypt-red?style=flat) | Hashing e Criptografia |

</div>

---

## 📂 Estrutura do Projeto (Clean Architecture)

```bash
backend/
├── src/
│   ├── config/          # Configurações Globais (App, DB)
│   ├── controllers/     # Lógica de Negócios (Titanium Logic)
│   ├── middleware/      # Guardiões (Auth, Upload, Error)
│   ├── routes/          # Definição de Endpoints API
│   ├── services/        # Motores Complexos (Wallet, Socket)
│   └── utils/           # Ferramentas e Bootstraps
├── uploads/             # Persistência de Mídia
├── server.js            # Ponto de Entrada (Bootstrapper)
└── .env                 # Segredos de Ambiente
