const WebSocket = require('ws');
const { SESSION_TTL_MS, MAX_DLQ_SIZE, redisClient } = require('./config');

const liveSessions = new Map();
const deadLetterQueue = [];

// --- Session CRUD ---
function createSession(sessionId, socket) {
    liveSessions.set(sessionId, {
        socket,
        agentSocket: null,
        audioBuffer: [],
        lastActivity: Date.now(),
        modelTrackingVersion: 'AASIST-L_v1.0.0',
        hasReachedThreshold: false,
        inFlightGrpcRequests: 0,
    });
}

function cleanupSession(sessionId) {
    const session = liveSessions.get(sessionId);
    if (!session) return;
    if (session.socket?.readyState === WebSocket.OPEN) session.socket.close();
    if (session.agentSocket?.readyState === WebSocket.OPEN) session.agentSocket.close();
    liveSessions.delete(sessionId);
}

// --- DLQ ---
function pushToDLQ(payload) {
    if (deadLetterQueue.length < MAX_DLQ_SIZE) {
        deadLetterQueue.push(payload);
    } else {
        console.error(`[CRITICAL FATAL] DLQ Overflow! Log lost for: ${payload.correlationId}`);
    }
}

// --- Background Workers ---
setInterval(() => {
    const now = Date.now();
    for (const [sessionId, session] of liveSessions.entries()) {
        if (now - session.lastActivity > SESSION_TTL_MS) {
            console.warn(`[DOS-PROTECTION] Evicting stale session: ${sessionId}`);
            cleanupSession(sessionId);
        }
    }
}, 60000);

setInterval(async () => {
    if (deadLetterQueue.length === 0) return;
    console.log(`[DLQ-WORKER] Flushing ${deadLetterQueue.length} logs to Redis...`);
    const retryBatch = [...deadLetterQueue];
    deadLetterQueue.length = 0;
    for (const payload of retryBatch) {
        try {
            await redisClient.rPush('telephony-audit-logs', JSON.stringify(payload));
        } catch {
            pushToDLQ(payload);
        }
    }
}, 10000);

module.exports = { liveSessions, createSession, cleanupSession, pushToDLQ };