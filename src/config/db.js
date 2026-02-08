/**
 * =================================================================================================
 * 💾 DATABASE CONFIGURATION - NEON POSTGRESQL (REVISÃO 2026.02.10)
 * =================================================================================================
 */
const { Pool } = require('pg');
require('dotenv').config();

// Configuração robusta para o cluster Neon com SSL obrigatório
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    },
    max: 20,                       // Máximo de conexões simultâneas
    idleTimeoutMillis: 30000,      // Fecha conexões inativas após 30s
    connectionTimeoutMillis: 10000, // Limite de 10s para estabelecer conexão
});

// Monitor de Conexão
pool.on('connect', () => {
    // Conexão estabelecida com sucesso
});

pool.on('error', (err) => {
    console.error('❌ [DATABASE] Erro fatal no pool de conexões:', err.message);
});

// Exportação como objeto para manter consistência modular
module.exports = { pool };
