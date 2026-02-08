// src/config/db.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

pool.on('connect', () => {
    // Log silencioso de conexão bem-sucedida
});

pool.on('error', (err) => {
    console.error('❌ [DATABASE] Erro crítico no Pool:', err.message);
});

// EXPORTAÇÃO CORRETA: Exportamos um objeto contendo o pool
module.exports = { pool };
