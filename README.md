<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0f172a&height=300&section=header&text=AOtravel%20Titanium&fontSize=70&fontColor=ffffff&fontAlign=50&desc=Backend%20Architecture%20v11.0.0-GOLD&descAlign=50&descAlignY=60" alt="AOtravel Header" width="100%"/>

<br/>

[![Status](https://img.shields.io/badge/SYSTEM_STATUS-OPERATIONAL-success?style=for-the-badge&logo=statuspage&logoColor=white)](https://render.com)
[![Version](https://img.shields.io/badge/CORE_VERSION-11.0.0_ARMORED-702575?style=for-the-badge&logo=git&logoColor=white)](https://github.com)
[![License](https://img.shields.io/badge/LICENSE-PROPRIETARY-000000?style=for-the-badge&logo=balance-scale&logoColor=white)](https://aotravel.ao)

<br/>
<br/>

<p align="center" width="60%">
  <samp>
    "Engenharia de precisão para um ecossistema financeiro e de mobilidade. 
    Projetado para resiliência, segurança ACID e escala horizontal."
  </samp>
</p>

<br/>

</div>

---

## ⚡ **System Architecture**

O **AOtravel Titanium** não é apenas um backend; é um orquestrador de eventos distribuídos. A arquitetura foi desenhada seguindo os princípios de **Clean Architecture** e **Fail-Safe Systems**, priorizando a integridade dos dados acima de tudo.

<div align="center">

| **Core Principle** | **Implementation Strategy** |
| :--- | :--- |
| **Resiliência de Rede** | `Socket.IO` com *Heartbeats* agressivos e *Auto-Reconnection* para redes 3G/4G instáveis. |
| **Integridade Financeira** | Ledger de dupla entrada (Double-Entry) com transações atômicas (`BEGIN`...`COMMIT`). |
| **Auto-Cura (Self-Healing)** | O sistema detecta corrupção de schema no boot e aplica correções automaticamente. |
| **Segurança Militar** | Migração transparente de hash, RBAC estrito e Sessões Persistentes criptografadas. |

</div>

---

## 💎 **Core Modules**

<div align="center">

### `MÓDULO 01` • **RIDE & DISPATCH ENGINE**
*Gerenciamento logístico e geoespacial de alta frequência.*

| Componente | Função Técnica |
| :--- | :--- |
| ![Radar](https://img.shields.io/badge/RADAR-SOCKET.IO-black?style=flat-square) | Rastreamento em tempo real de motoristas via WebSockets. |
| ![Algo](https://img.shields.io/badge/ALGORITHM-GEOSPATIAL-blue?style=flat-square) | Cálculo de *Haversine* para matching de proximidade (Raio 15km). |
| ![Pricing](https://img.shields.io/badge/PRICING-DYNAMIC-green?style=flat-square) | Tarifação baseada em variáveis de tempo, distância e categoria. |

<br/>

### `MÓDULO 02` • **TITANIUM WALLET**
*Core bancário digital integrado com conformidade BNA.*

| Componente | Função Técnica |
| :--- | :--- |
| ![ACID](https://img.shields.io/badge/DB-ACID_TRANSACTIONS-purple?style=flat-square) | Garantia de consistência total em movimentações financeiras. |
| ![P2P](https://img.shields.io/badge/TRANSFER-P2P_INSTANT-orange?style=flat-square) | Transferências internas com resolução de ID via Telefone/QR. |
| ![Audit](https://img.shields.io/badge/SECURITY-AUDIT_LOGS-red?style=flat-square) | Rastreabilidade imutável de cada centavo movimentado. |

</div>

---

## 🚀 **Exclusive Differentiators**
### *The "Augusto Neves" Signature*

O que coloca este backend anos à frente das soluções tradicionais de mercado?

> **📡 Network-Agnostic Stability**
> <br/> A maioria dos apps falha quando o motorista entra em uma zona de sombra. O AOtravel mantém o estado da transação em cache e sincroniza assim que o `ping` retorna, sem perda de dados (State Recovery).

> **🛡️ Database Self-Healing**
> <br/> O `dbBootstrap.js` atua como um médico do sistema. A cada reinicialização, ele verifica a saúde das tabelas, índices e colunas. Se algo estiver faltando, ele recria cirurgicamente sem afetar os dados existentes.

> **📱 Device Fingerprinting**
> <br/> O sistema de autenticação (`authController.js`) não confia apenas na senha. Ele vincula a sessão ao hardware do dispositivo, bloqueando tentativas de *Account Takeover* mesmo se a senha for vazada.

---

## 🔮 **Future Horizons (Roadmap)**

<div align="center">

| Q3 2026 | Q4 2026 | Q1 2027 |
| :---: | :---: | :---: |
| **Fintech 2.0** | **AI Dispatch** | **Super App** |
| Microcrédito baseado em Score<br>Integração Visa/Mastercard Direta | Previsão de Demanda (ML)<br>Detecção de Fraude Neural | Módulo de Delivery<br>Marketplace de Serviços |

</div>

### **Expandable Features Ready-to-Code:**
1.  **Frota Corporativa:** Gestão de vouchers para empresas.
2.  **Gamification:** Sistema de XP e Níveis para motoristas (já preparado no DB).
3.  **Voice Commerce:** Pedir corridas via comando de voz (integração futura).

---

## 🛠️ **Technology Stack**

A fundação tecnológica escolhida para performance extrema.

<div align="center">

![NodeJS](https://img.shields.io/badge/Runtime-Node.js_v20-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/API-Express_Framework-000000?style=for-the-badge&logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/Database-PostgreSQL_16-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![SocketIO](https://img.shields.io/badge/Realtime-Socket.IO-010101?style=for-the-badge&logo=socket.io&logoColor=white)
![Security](https://img.shields.io/badge/Security-Bcrypt_&_JWT-critical?style=for-the-badge&logo=authentik&logoColor=white)

</div>

---

## 📂 **Project Anatomy**

Estrutura de diretórios organizada para escalabilidade máxima.

```bash
📦 src
 ┣ 📂 config         # ⚙️ Constantes Globais & DB Pool
 ┣ 📂 controllers    # 🧠 Lógica de Negócios (The Brain)
 ┣ 📂 middleware     # 🛡️ Camada de Segurança & Interceptação
 ┣ 📂 routes         # 🚦 Definição de Endpoints API
 ┣ 📂 services       # 🔌 Motores Complexos (Wallet, Socket)
 ┗ 📂 utils          # 🛠️ Ferramentas & Self-Healing Scripts
<div align="center">
<br/>
![alt text](https://img.shields.io/badge/DEPLOY-RENDER.COM-black?style=for-the-badge&logo=render&logoColor=white)
<br/>
<br/>
<img src="https://readme-typing-svg.herokuapp.com?font=Fira+Code&pause=1000&color=3F51B5&center=true&vCenter=true&width=435&lines=Architected+by+Augusto+Neves;Software+Engineer;UI%2FUX+Designer" alt="Typing SVG" />
</div>
