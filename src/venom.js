/**
 * =================================================================================================
 * 🕷️ AOTRAVEL VENOM - DEBUGGER ABSOLUTO v1.0.0
 * =================================================================================================
 * 
 * Este arquivo é um MONITOR ABSOLUTO que captura TODOS os logs de:
 * - Socket.IO (conexões, eventos, salas)
 * - Banco de Dados (queries, erros, conexões)
 * - Controllers (auth, rides, wallet, socket)
 * - Requisições HTTP
 * - Processos internos
 * 
 * COMO USAR:
 * 1. Adicione no início do server.js: require('./src/venom')();
 * 2. O venom vai gerar logs COLORIDOS e DETALHADOS
 * 3. Todos os erros serão capturados com stack trace completo
 * 
 * =================================================================================================
 */

const util = require('util');
const { performance } = require('perf_hooks');

// Cores insanas para identificação visual
const colors = {
  // Cores base
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  
  // Cores vibrantes
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  
  // Cores de fundo para destaque
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  
  // Efeitos especiais
  blink: '\x1b[5m',
  
  // Cores para categorias específicas
  socket: '\x1b[35m', // Magenta
  db: '\x1b[36m',     // Ciano
  http: '\x1b[34m',   // Azul
  error: '\x1b[31m',  // Vermelho
  success: '\x1b[32m', // Verde
  warning: '\x1b[33m', // Amarelo
  ride: '\x1b[38;5;208m', // Laranja
  auth: '\x1b[38;5;129m', // Roxo
  venom: '\x1b[38;5;196m'  // Vermelho sangue
};

// Estatísticas do Venom
const venomStats = {
  startTime: Date.now(),
  socketEvents: { total: 0, byType: {} },
  dbQueries: { total: 0, errors: 0 },
  httpRequests: { total: 0, byMethod: {} },
  errors: { total: 0, byType: {} },
  lastError: null
};

// Interceptar console.log para adicionar timestamps e cores
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const originalConsoleInfo = console.info;

// Timestamp formatador
function getTimestamp() {
  const now = new Date();
  return `${colors.dim}[${now.toLocaleTimeString()}.${now.getMilliseconds().toString().padStart(3, '0')}]${colors.reset}`;
}

// Log com categoria
function venomLog(category, color, ...args) {
  const timestamp = getTimestamp();
  const categoryTag = `${color}[${category}]${colors.reset}`;
  const message = args.map(arg => {
    if (typeof arg === 'object') {
      try {
        return JSON.stringify(arg, null, 2);
      } catch {
        return util.inspect(arg, { depth: null, colors: true });
      }
    }
    return arg;
  }).join(' ');
  
  originalConsoleLog(`${timestamp} ${categoryTag} ${message}`);
}

// Sobrescrever console methods
console.log = function(...args) {
  venomLog('INFO', colors.white, ...args);
};

console.error = function(...args) {
  venomStats.errors.total++;
  venomStats.lastError = args[0];
  venomLog('❌ ERRO', colors.error, ...args);
  if (args[0]?.stack) {
    venomLog('STACK', colors.error, args[0].stack);
  }
};

console.warn = function(...args) {
  venomLog('⚠️ AVISO', colors.warning, ...args);
};

console.info = function(...args) {
  venomLog('ℹ️ INFO', colors.blue, ...args);
};

// =================================================================================================
// 1. 🕷️ VENOM SOCKET MONITOR - CAPTURA TODOS OS EVENTOS DO SOCKET.IO
// =================================================================================================
function injectSocketVenom(io) {
  if (!io) return;
  
  venomLog('🕷️ VENOM', colors.venom, 'INJETANDO MONITOR NO SOCKET.IO...');
  
  // Monitorar novas conexões
  const originalOn = io.on;
  io.on = function(event, callback) {
    if (event === 'connection') {
      return originalOn.call(this, event, function(socket) {
        venomLog('🔌 SOCKET', colors.socket, `NOVA CONEXÃO: ${socket.id} | Transport: ${socket.conn.transport}`);
        
        // Monitorar todos os eventos do socket
        const originalSocketOn = socket.on;
        socket.on = function(ev, handler) {
          venomLog('🎧 SOCKET', colors.socket, `Registrando listener: ${ev} no socket ${socket.id}`);
          
          return originalSocketOn.call(this, ev, function(...args) {
            venomStats.socketEvents.total++;
            venomStats.socketEvents.byType[ev] = (venomStats.socketEvents.byType[ev] || 0) + 1;
            
            venomLog(`📡 SOCKET EVENT: ${ev}`, colors.socket, {
              socketId: socket.id,
              args: args.length === 1 ? args[0] : args,
              timestamp: new Date().toISOString()
            });
            
            // Monitorar erros nos handlers
            try {
              const result = handler.apply(this, args);
              if (result && result.catch) {
                result.catch(err => {
                  venomLog('❌ SOCKET ERROR', colors.error, `Erro no handler de ${ev}:`, err);
                });
              }
              return result;
            } catch (err) {
              venomLog('❌ SOCKET ERROR', colors.error, `Erro no handler de ${ev}:`, err);
              throw err;
            }
          });
        };
        
        // Monitorar join de salas
        const originalJoin = socket.join;
        socket.join = function(room, fn) {
          venomLog('🚪 SOCKET', colors.socket, `Socket ${socket.id} entrando na sala: ${room}`);
          return originalJoin.call(this, room, fn);
        };
        
        // Monitorar leave de salas
        const originalLeave = socket.leave;
        socket.leave = function(room, fn) {
          venomLog('🚪 SOCKET', colors.socket, `Socket ${socket.id} saindo da sala: ${room}`);
          return originalLeave.call(this, room, fn);
        };
        
        // Monitorar disconnect
        socket.on('disconnect', (reason) => {
          venomLog('🔌 SOCKET', colors.socket, `Socket ${socket.id} desconectado: ${reason}`);
        });
        
        callback(socket);
      });
    }
    return originalOn.call(this, event, callback);
  };
  
  venomLog('✅ VENOM', colors.success, 'Socket.IO monitor injetado com sucesso');
}

// =================================================================================================
// 2. 🕷️ VENOM DATABASE MONITOR - CAPTURA TODAS AS QUERIES
// =================================================================================================
function injectDatabaseVenom(pool) {
  if (!pool) return;
  
  venomLog('🕷️ VENOM', colors.venom, 'INJETANDO MONITOR NO BANCO DE DADOS...');
  
  const originalQuery = pool.query;
  
  pool.query = function(text, params, callback) {
    const startTime = performance.now();
    const queryId = Math.random().toString(36).substring(7);
    
    // Log da query
    const queryPreview = typeof text === 'string' 
      ? text.substring(0, 200) + (text.length > 200 ? '...' : '')
      : 'Complex query';
    
    venomLog(`🗄️ DB QUERY [${queryId}]`, colors.db, {
      query: queryPreview,
      params: params ? JSON.stringify(params).substring(0, 100) : 'none',
      timestamp: new Date().toISOString()
    });
    
    venomStats.dbQueries.total++;
    
    // Executar query e medir tempo
    return originalQuery.call(this, text, params, function(err, result) {
      const duration = performance.now() - startTime;
      
      if (err) {
        venomStats.dbQueries.errors++;
        venomLog(`❌ DB ERROR [${queryId}]`, colors.error, {
          error: err.message,
          code: err.code,
          duration: `${duration.toFixed(2)}ms`,
          query: queryPreview
        });
      } else {
        venomLog(`✅ DB SUCCESS [${queryId}]`, colors.success, {
          rows: result?.rowCount || 0,
          duration: `${duration.toFixed(2)}ms`,
          slow: duration > 100 ? '⚠️ LENTA' : '✅ rápida'
        });
      }
      
      if (callback) {
        callback(err, result);
      }
    });
  };
  
  venomLog('✅ VENOM', colors.success, 'Database monitor injetado com sucesso');
}

// =================================================================================================
// 3. 🕷️ VENOM HTTP MONITOR - CAPTURA TODAS AS REQUISIÇÕES
// =================================================================================================
function injectHttpVenom(app) {
  if (!app) return;
  
  venomLog('🕷️ VENOM', colors.venom, 'INJETANDO MONITOR HTTP...');
  
  app.use((req, res, next) => {
    const startTime = performance.now();
    const requestId = Math.random().toString(36).substring(7);
    
    venomStats.httpRequests.total++;
    venomStats.httpRequests.byMethod[req.method] = (venomStats.httpRequests.byMethod[req.method] || 0) + 1;
    
    venomLog(`🌐 HTTP [${requestId}]`, colors.http, {
      method: req.method,
      url: req.url,
      ip: req.ip || req.connection.remoteAddress,
      headers: {
        'user-agent': req.headers['user-agent'],
        'x-session-token': req.headers['x-session-token'] ? 'presente' : 'ausente'
      }
    });
    
    // Monitorar resposta
    const originalJson = res.json;
    res.json = function(data) {
      const duration = performance.now() - startTime;
      
      venomLog(`📦 HTTP RESPONSE [${requestId}]`, colors.http, {
        statusCode: res.statusCode,
        duration: `${duration.toFixed(2)}ms`,
        success: res.statusCode < 400,
        dataPreview: data ? JSON.stringify(data).substring(0, 200) : 'no data'
      });
      
      return originalJson.call(this, data);
    };
    
    next();
  });
  
  venomLog('✅ VENOM', colors.success, 'HTTP monitor injetado com sucesso');
}

// =================================================================================================
// 4. 🕷️ VENOM PROCESS MONITOR - CAPTURA EVENTOS DO SISTEMA
// =================================================================================================
function injectProcessVenom() {
  venomLog('🕷️ VENOM', colors.venom, 'INJETANDO MONITOR DE PROCESSO...');
  
  // Monitorar uncaught exceptions
  process.on('uncaughtException', (err) => {
    venomLog('💥 UNCAUGHT EXCEPTION', colors.error, {
      error: err.message,
      stack: err.stack,
      memory: process.memoryUsage()
    });
  });
  
  // Monitorar unhandled rejections
  process.on('unhandledRejection', (reason, promise) => {
    venomLog('💥 UNHANDLED REJECTION', colors.error, {
      reason: reason,
      promise: promise
    });
  });
  
  // Monitorar warnings
  process.on('warning', (warning) => {
    venomLog('⚠️ PROCESS WARNING', colors.warning, {
      name: warning.name,
      message: warning.message,
      stack: warning.stack
    });
  });
  
  venomLog('✅ VENOM', colors.success, 'Process monitor injetado com sucesso');
}

// =================================================================================================
// 5. 🕷️ VENOM STATS REPORT - RELATÓRIO PERIÓDICO
// =================================================================================================
function startVenomReporter() {
  setInterval(() => {
    const uptime = Math.floor((Date.now() - venomStats.startTime) / 1000);
    const memory = process.memoryUsage();
    
    venomLog('📊 VENOM STATS', colors.venom, '='.repeat(60));
    venomLog('📊 VENOM STATS', colors.venom, `Uptime: ${uptime}s | Memória RSS: ${(memory.rss / 1024 / 1024).toFixed(2)}MB`);
    venomLog('📊 VENOM STATS', colors.venom, `Socket Events: ${venomStats.socketEvents.total} | Tipos: ${Object.keys(venomStats.socketEvents.byType).length}`);
    venomLog('📊 VENOM STATS', colors.venom, `DB Queries: ${venomStats.dbQueries.total} | Erros: ${venomStats.dbQueries.errors}`);
    venomLog('📊 VENOM STATS', colors.venom, `HTTP Requests: ${venomStats.httpRequests.total} | Métodos: ${JSON.stringify(venomStats.httpRequests.byMethod)}`);
    venomLog('📊 VENOM STATS', colors.venom, `Erros Totais: ${venomStats.errors.total}`);
    
    if (venomStats.lastError) {
      venomLog('📊 VENOM STATS', colors.venom, `Último erro: ${venomStats.lastError?.message || venomStats.lastError}`);
    }
    
    venomLog('📊 VENOM STATS', colors.venom, '='.repeat(60));
  }, 30000); // Relatório a cada 30 segundos
}

// =================================================================================================
// 6. 🕷️ VENOM INJECTOR - FUNÇÃO PRINCIPAL
// =================================================================================================
function injectVenom() {
  console.log('\n' + '='.repeat(80));
  console.log(`${colors.bgRed}${colors.bright}🕷️  AOTRAVEL VENOM - DEBUGGER ABSOLUTO ATIVADO 🕷️${colors.reset}`);
  console.log('='.repeat(80) + '\n');
  
  venomLog('🕷️ VENOM', colors.venom, 'INJETANDO MONITORES EM TODOS OS MÓDULOS...');
  
  // Aguardar todos os módulos carregarem
  setTimeout(() => {
    try {
      // Tentar injetar no pool do banco
      const pool = require('./config/db');
      injectDatabaseVenom(pool);
    } catch (e) {
      venomLog('⚠️ VENOM', colors.warning, 'Pool do banco não encontrado ainda');
    }
    
    try {
      // Tentar injetar no io global
      if (global.io) {
        injectSocketVenom(global.io);
      }
    } catch (e) {
      venomLog('⚠️ VENOM', colors.warning, 'Socket.IO não encontrado ainda');
    }
    
    // Monitor de processo sempre funciona
    injectProcessVenom();
    
    // Iniciar relator
    startVenomReporter();
    
  }, 2000); // Aguardar 2 segundos para tudo carregar
  
  venomLog('🕷️ VENOM', colors.venom, 'VENOM INJETADO - AGUARDANDO CONEXÕES...');
}

// =================================================================================================
// 7. 🕷️ EXPORTAR FUNÇÃO PRINCIPAL
// =================================================================================================
module.exports = injectVenom;
