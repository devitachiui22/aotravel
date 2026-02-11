/**
 * SERVER.JS - VERSÃO FINAL DE PRODUÇÃO
 * Localização: /backend/server.js
 * Descrição: Ponto de entrada principal configurado para arquitetura modular.
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const path = require('path');

// Importações de Módulos Internos (Ajustados para a pasta ./src/)
const db = require('./src/config/db');
const appConfig = require('./src/config/appConfig');
const { bootstrapDatabase } = require('./src/utils/dbBootstrap');
const { globalErrorHandler, notFoundHandler } = require('./src/middleware/errorMiddleware.js');
const routes = require('./src/routes');
const { setupSocketIO } = require('./src/services/socketService');

// Inicialização do Express e Servidor HTTP
const app = express();
const server = http.createServer(app);

// Configuração Robusta e Profissional do Socket.io
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        allowedHeaders: ["my-custom-header"],
        credentials: true
    },
    pingTimeout: 20000,
    pingInterval: 25000,
    transports: ['websocket', 'polling'],
    allowEIO3: true // Compatibilidade com versões anteriores se necessário
});

/**
 * Injeção de Dependência do Socket.io
 * Disponibiliza a instância 'io' globalmente para ser acessada nos Controllers
 * através de req.app.get('io')
 */
app.set('io', io);

// --- Middlewares Globais de Segurança e Parsing ---

// Habilitação de CORS para integração total com o Frontend
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Configuração de limites de carga para evitar erros em uploads de base64 ou JSONs extensos
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

/**
 * Configuração de Arquivos Estáticos (Uploads)
 * O caminho é resolvido dinamicamente para garantir que as imagens sejam servidas corretamente
 */
app.use('/uploads', express.static(appConfig.uploadDir || path.join(__dirname, 'src/uploads')));

// --- Definição de Rotas ---

/**
 * Agregador de Rotas Principal (Modularizado)
 * Centraliza auth, profile, ride, wallet, admin e chat
 */
app.use(routes);

// --- Tratamento de Erros e Rotas Inexistentes ---

// Middleware para capturar rotas não definidas (404)
app.use(notFoundHandler);

// Middleware global de exceções (Catch-all) para estabilidade do servidor
app.use(globalErrorHandler);

// --- Inicialização e Bootstrapping do Sistema ---

/**
 * Função auto-executável para garantir a ordem de subida dos serviços:
 * 1. Bootstrap do Banco de Dados (Criação de tabelas/schemas)
 * 2. Inicialização dos eventos de Socket.io
 * 3. Ativação do servidor na porta configurada
 */
(async function startServer() {
    try {
        console.log("--- Iniciando Processo de Boot ---");

        // Valida conexão e estrutura do banco de dados
        await bootstrapDatabase();
        console.log("✅ Banco de Dados: Tabelas e Schemas verificados.");

        // Configura a lógica de escuta e eventos do Socket
        setupSocketIO(io);
        console.log("✅ Socket.io: Eventos configurados com sucesso.");

        // Definição da Porta (Prioridade para appConfig ou variável de ambiente)
        const PORT = appConfig.port || process.env.PORT || 3000;

        // Escuta em 0.0.0.0 para permitir conexões externas e via rede local
        server.listen(PORT, '0.0.0.0', () => {
            console.log("--------------------------------------------------");
            console.log(`🚀 SERVIDOR RODANDO COM SUCESSO NA PORTA: ${PORT}`);
            console.log(`📡 MODO: Produção / Modularizado`);
            console.log(`🌍 ACESSO: http://localhost:${PORT}`);
            console.log("--------------------------------------------------");
        });

    } catch (err) {
        console.error("❌ ERRO CRÍTICO DURANTE O BOOT DO SERVIDOR:");
        console.error(err.message);
        console.error(err.stack);

        // Finaliza o processo com erro para evitar estado inconsistente
        process.exit(1);
    }
})();

// Exportação do servidor para possíveis testes automatizados
module.exports = { app, server, io };
