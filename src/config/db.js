/**
 * =================================================================================================
 * 🚀 AOTRAVEL SERVER PRO - DATABASE CONNECTION LAYER (TITANIUM POOL)
 * =================================================================================================
 *
 * ARQUIVO: src/config/db.js
 * DESCRIÇÃO: Gerenciamento centralizado do Pool de Conexões PostgreSQL (Neon DB).
 *            Implementa estratégias de "Keep-Alive", reconexão e tratamento de erros
 *            críticos para garantir Alta Disponibilidade (HA).
 *
 * STATUS: PRODUCTION READY - FULL VERSION
 * =================================================================================================
 */

const { Pool } = require('pg');
require('dotenv').config();

// Validação Crítica de Ambiente
if (!process.env.DATABASE_URL) {
    console.error("❌ [FATAL] A variável de ambiente 'DATABASE_URL' não está definida.");
    console.error("   Verifique seu arquivo .env ou as configurações do Render/Neon.");
    process.exit(1); // Encerra imediatamente para não rodar em estado instável
}

/**
 * CONFIGURAÇÃO DO POOL DO POSTGRESQL (NEON TECH OPTIMIZED)
 *
 * Parâmetros ajustados para alta performance e resiliência em ambiente serverless/cloud.
 */
const poolConfig = {
    connectionString: process.env.DATABASE_URL,

    // Configuração SSL Obrigatória para Neon/Render
    ssl: {
        rejectUnauthorized: false // Permite certificados self-signed (padrão em cloud DBs)
    },

    // Gerenciamento de Recursos
    max: 20,                         // Máximo de clientes simultâneos no pool
    min: 2,                          // Mantém pelo menos 2 conexões abertas (warm start)
    idleTimeoutMillis: 30000,        // 30s: Desconecta clientes ociosos para poupar recursos
    connectionTimeoutMillis: 10000,  // 10s: Tempo limite estrito para tentar conectar
    allowExitOnIdle: false           // Mantém o event loop ativo
};

// Instanciação do Pool
const pool = new Pool(poolConfig);

/**
 * MONITORAMENTO DE EVENTOS DO POOL
 */

// Evento: Conexão criada
pool.on('connect', () => {
    // Debug verbose apenas em desenvolvimento para não poluir logs de produção
    if (process.env.NODE_ENV === 'development') {
        // console.log('✅ [DB_POOL] Nova conexão cliente criada com sucesso.');
    }
});

// Evento: Erro Crítico no Backend (Idle Client Error)
// IMPORTANTE: Isso impede que o servidor Node.js crashe quando a conexão cai.
pool.on('error', (err, client) => {
    const now = new Date();
    const timeString = now.toLocaleTimeString('pt-AO', { hour12: false });
    console.error(`[${timeString}] ❌ [DB_CRITICAL] Erro inesperado no cliente inativo do Pool:`, err.message);
    // Não lançamos throw aqui. Deixamos o pool tentar reconectar ou descartar o cliente.
});

/**
 * HEALTH CHECK INICIAL (Diagnóstico de Partida)
 * Tenta uma query simples ao carregar o módulo para garantir que as credenciais funcionam.
 */
(async () => {
    try {
        const client = await pool.connect();
        const res = await client.query('SELECT NOW() as now, version()');
        const dbTime = new Date(res.rows[0].now).toLocaleTimeString('pt-AO');

        console.log('================================================================');
        console.log(`✅ [DB_CONNECTED] PostgreSQL conectado com sucesso.`);
        console.log(`   Host: ${new URL(process.env.DATABASE_URL).hostname}`);
        console.log(`   Versão: ${res.rows[0].version.split(' ')[1]}`);
        console.log(`   Hora do Banco: ${dbTime}`);
        console.log('================================================================');

        client.release(); // Libera o cliente de volta para o pool imediatamente
    } catch (err) {
        console.error('❌ [DB_FATAL] Falha na conexão inicial com o Banco de Dados!');
        console.error('   Erro:', err.message);
        console.error('   Verifique se o IP do servidor está na Allowlist do Neon ou se a URL está correta.');
        // Em produção, talvez queiramos continuar tentando, mas no boot é melhor saber logo.
    }
})();

/**
 * EXPORTAÇÃO
 * Exporta o objeto pool diretamente para uso em toda a aplicação.
 */
module.exports = pool;
