/**
 * =================================================================================================
 * ☢️ AOTRAVEL DATABASE NUKE SCRIPT - RESET TOTAL
 * =================================================================================================
 *
 * ARQUIVO: resetDb.js
 * DESCRIÇÃO: Este script conecta ao banco Neon PostgreSQL e DESTRÓI o schema 'public'.
 *            Isso remove todas as tabelas, dados, índices e tipos.
 *            Em seguida, recria o schema 'public' vazio.
 *
 * USO: node resetDb.js
 * =================================================================================================
 */

require('dotenv').config();
const { Pool } = require('pg');

// Configuração da conexão (Mesma do src/config/db.js)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
});

async function nukeDatabase() {
    const client = await pool.connect();

    try {
        console.log('\n==================================================');
        console.log('☢️  INICIANDO PROTOCOLO DE LIMPEZA TOTAL (NUKE) ☢️');
        console.log('==================================================');
        console.log(`📡 Conectado a: ${process.env.DATABASE_URL.split('@')[1]}`); // Mostra apenas o host por segurança

        // 1. Destruir o Schema Public (Cascade leva tudo junto: tabelas, fks, triggers)
        console.log('🔥 Apagando todas as tabelas, tipos e dados...');
        await client.query('DROP SCHEMA public CASCADE;');

        // 2. Recriar o Schema Public limpo
        console.log('🏗️  Recriando schema public limpo...');
        await client.query('CREATE SCHEMA public;');

        // 3. Restaurar permissões padrão (Importante para o Neon/Postgres)
        console.log('🔑 Restaurando permissões padrão...');
        await client.query('GRANT ALL ON SCHEMA public TO public;');
        // Opcional: Grant para o usuário específico se necessário, mas 'public' geralmente cobre.

        console.log('\n==================================================');
        console.log('✅ SUCESSO: O BANCO DE DADOS ESTÁ 100% VAZIO.');
        console.log('==================================================\n');

        console.log('👉 Agora você pode rodar "npm start" para recriar as tabelas do zero via dbBootstrap.js');

    } catch (err) {
        console.error('\n❌ ERRO FATAL AO LIMPAR BANCO:', err);
    } finally {
        client.release();
        await pool.end(); // Fecha a conexão do script
        process.exit();
    }
}

// Executar
nukeDatabase();