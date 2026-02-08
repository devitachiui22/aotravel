function logSystem(tag, message) {
    const now = new Date();
    const timeString = now.toLocaleTimeString('pt-AO', { hour12: false });
    console.log(`[${timeString}] ℹ️ [${tag}] ${message}`);
}

function logError(tag, error) {
    const now = new Date();
    const timeString = now.toLocaleTimeString('pt-AO', { hour12: false });
    console.error(`[${timeString}] ❌ [${tag}] ERRO:`, error.message || error);
}

module.exports = { logSystem, logError };