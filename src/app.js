/**
 * =================================================================================================
 * 🌐 EXPRESS APPLICATION SETUP - TITANIUM (REVISÃO 2026.02.10)
 * =================================================================================================
 */
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { logError } = require('./utils/logger');
const routes = require('./routes'); // Centralizador de rotas
const { uploadDir } = require('./middleware/upload');
const multer = require('multer');

const app = express();

// --- CONFIGURAÇÃO DE PAYLOAD (100MB PARA IMAGENS BI/CHAT) ---
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// --- POLÍTICA DE SEGURANÇA CORS ---
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'x-session-token'],
    credentials: true
}));

// Servir arquivos de upload publicamente
app.use('/uploads', express.static(uploadDir));

// --- MAPEAMENTO DE ROTAS ---
app.use('/api', routes);

// Health Check do Render
app.get('/', (req, res) => {
    res.status(200).json({
        status: "AOTRAVEL SERVER ULTIMATE ONLINE",
        version: "2026.02.10",
        db: "Synchronized",
        architecture: "Modular/Titanium"
    });
});

// Middleware 404
app.use((req, res) => {
    res.status(404).json({
        error: "Endpoint não encontrado.",
        path: req.path
    });
});

// --- GESTOR DE ERROS GLOBAL ---
app.use((err, req, res, next) => {
    logError('GLOBAL_CRITICAL', err);

    if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: `Erro no upload: ${err.message}` });
    }

    res.status(500).json({
        error: "Erro interno do servidor.",
        message: process.env.NODE_ENV === 'development' ? err.message : "Contate o suporte Titan."
    });
});

module.exports = app;
