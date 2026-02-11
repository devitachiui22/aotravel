/**
 * =================================================================================================
 * 🚀 AOTRAVEL SERVER PRO - DATABASE CONFIGURATION LAYER
 * =================================================================================================
 *
 * ARQUIVO: src/config/db.js
 * DESCRIÇÃO: Gerenciamento centralizado do Pool de Conexões PostgreSQL (Neon DB).
 *            Este módulo garante a persistência e a estabilidade da conexão com o banco de dados,
 *            implementando tratamento de erros críticos para evitar crash do servidor Node.js.
 *
 * STATUS: PRODUCTION READY - FULL VERSION
 * =================================================================================================
 */

// Importação das dependências necessárias
const { Pool } = require('pg');
require('dotenv').config();

/**
 * CONFIGURAÇÃO DO POOL DO POSTGRESQL (NEON DB)
 *
 * Parâmetros ajustados para alta performance e resiliência em ambiente serverless/cloud.
 * - connectionString: URL de conexão fornecida via variável de ambiente.
 * - ssl: Obrigatório para conexões seguras no Neon (rejectUnauthorized: false para aceitar certificados self-signed se necessário).
 * - max: Limite de conexões simultâneas para evitar exaustão de recursos.
 * - idleTimeoutMillis: Tempo para desconectar clientes ociosos.
 * - connectionTimeoutMillis: Tempo limite para estabelecer nova conexão.
 */
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }, // Obrigatório para conexões seguras no Neon e ambientes de produção modernos
    max: 20, // Máximo de clientes no pool (Ajustado conforme server.js original)
    idleTimeoutMillis: 30000, // Tempo para fechar conexões inativas (30 segundos)
    connectionTimeoutMillis: 10000, // Tempo limite para conectar (10 segundos)
});

/**
 * LISTENER DE ERROS GLOBAIS DO BANCO DE DADOS
 *
 * Este manipulador é crítico. Em caso de perda de conexão ou erro no cliente do pool,
 * ele captura o erro e loga no console, impedindo que o processo do Node.js encerre abruptamente.
 * Isso garante a Alta Disponibilidade (High Availability) do sistema.
 */
pool.on('error', (err, client) => {
    const now = new Date();
    const timeString = now.toLocaleTimeString('pt-AO', { hour12: false });
    console.error(`[${timeString}] ❌ [DB_CRITICAL] ERRO CRÍTICO NO POOL DO POSTGRES:`, err);
    // Não lançamos o erro aqui para manter o servidor rodando e tentar reconexão automática
});

/**
 * EXPORTAÇÃO DO POOL
 *
 * O objeto pool é exportado para ser utilizado em todo o sistema (Controllers, Models, Services)
 * para execução de queries SQL.
 */
module.exports = pool;