const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { logError } = require('./utils/logger');
const routes = require('./routes');
const { uploadDir } = require('./middleware/upload');
const multer = require('multer');

const app = express();

app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
    credentials: true
}));

// Rotas da API
app.use('/api', routes);

// Serve Uploads
app.use('/uploads', express.static(uploadDir));

// Health Check
app.get('/', (req, res) => res.status(200).json({
    status: "AOTRAVEL SERVER ULTIMATE ONLINE",
    version: "2026.02.10",
    db: "Connected",
    mode: "MODULARIZED"
}));

// 404
app.use((req, res) => {
    res.status(404).json({ error: "Rota não encontrada.", path: req.path, method: req.method });
});

// Error Handler
app.use((err, req, res, next) => {
    logError('GLOBAL_ERROR', err);
    if (err instanceof multer.MulterError) return res.status(400).json({ error: `Erro no upload: ${err.message}` });
    res.status(500).json({ error: "Erro interno do servidor.", message: process.env.NODE_ENV === 'development' ? err.message : undefined });
});

module.exports = app;