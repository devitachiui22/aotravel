/**
 * =================================================================================================
 * 💾 DATABASE CONFIGURATION - NEON POSTGRESQL (REVISÃO 2026.02.10)
 * =================================================================================================
 */
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { 
        rejectUnauthorized: false 
    },
    max: 20,                       
    idleTimeoutMillis: 30000,      
    connectionTimeoutMillis: 10000, 
});

pool.on('error', (err) => {
    console.error('❌ [DATABASE] Erro fatal no pool de conexões:', err.message);
});

// Exportação obrigatória para desestruturação: const { pool } = require(...)
module.exports = { pool };
