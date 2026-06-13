const WebSocket = require('ws');
const crypto = require('crypto');
const { sendAudioToPython, gRpcStream } = require('../services/grpcClient');
const { redisClient, CHUNK_THRESHOLD, STRIDE_CHUNKS, MAX_BUFFER_CHUNKS, MAX_IN_FLIGHT_GRPC } = require('./config');
const { liveSessions, createSession, cleanupSession, pushToDLQ } = require('./sessionManager');

// --- gRPC Result Handler ---
gRpcStream.on('data', (result) => {
    const { session_id, correlation_id, spoof_probability, is_authentic } = result;
    const session = liveSessions.get(session_id);
    if (!session) return;

    if (session.inFlightGrpcRequests > 0) session.inFlightGrpcRequests--;

    const correlationId = correlation_id || `corr_fallback_${crypto.randomBytes(16).toString('hex')}`;
    const safeSpoofProbability = Math.min(1, Math.max(0, parseFloat(spoof_probability) || 0));
    const safeIsAuthentic = Boolean(is_authentic);
    console.log(`[EVALUATION] Session: ${session_id} | Correlation: ${correlationId} | Spoof Prob: ${(safeSpoofProbability * 100).toFixed(1)}%`);

    if (session.agentSocket?.readyState === WebSocket.OPEN) {
        session.agentSocket.send(JSON.stringify({
            correlationId,
            spoof_probability: safeSpoofProbability,
            status: safeIsAuthentic ? 'BONAFIDE' : 'SPOOF',
            message: safeIsAuthentic ? 'Verified Human Voice' : 'Potential AI Voice Clone Detected'
        }));
    }

    setImmediate(async () => {
        const auditChunk = {
            correlationId,
            spoofProbability: safeSpoofProbability * 100, // Store as percentage 0-100
            status: safeIsAuthentic ? 'BONAFIDE' : 'SPOOF',
            timestamp: new Date().toISOString(),
        };
        try {
            // Push chunk to this specific session's Redis list
            await redisClient.rPush(`session:${session_id}:chunks`, JSON.stringify(auditChunk));
            // Keep model version in a lightweight key (refreshes TTL)
            await redisClient.set(`session:${session_id}:model`, session.modelTrackingVersion, { EX: 86400 });
        } catch {
            pushToDLQ({ sessionId: session_id, type: 'chunk', data: auditChunk });
        }
    });
});

// --- Caller Handler ---
function handleCaller(ws, decodedToken) {
    const sessionId = decodedToken.sessionId || crypto.randomBytes(16).toString('hex');
   
    console.log(`[INGRESS] Authenticated caller session established: ${sessionId}`);
    createSession(sessionId, ws);

    ws.send(JSON.stringify({ event: 'SESSION_CREATED', sessionId, message: 'Audio stream ready.' }));

    ws.on('message', (chunk) => {
        const session = liveSessions.get(sessionId);
        if (!session) return;
        session.lastActivity = Date.now();
        session.audioBuffer.push(chunk);

        if (session.audioBuffer.length > MAX_BUFFER_CHUNKS) {
            console.warn(`[DOS-PROTECTION] Truncating oversized buffer for session: ${sessionId}`);
            session.audioBuffer = session.audioBuffer.slice(-MAX_BUFFER_CHUNKS);
        }

        if (session.audioBuffer.length >= CHUNK_THRESHOLD) {
            session.hasReachedThreshold = true;
            if (session.inFlightGrpcRequests >= MAX_IN_FLIGHT_GRPC) {
                console.warn(`[BACKPRESSURE] Skipping stride for ${sessionId}.`);
                session.audioBuffer = session.audioBuffer.slice(STRIDE_CHUNKS);
                return;
            }
            const audioToSend = Buffer.concat(session.audioBuffer.slice(0, CHUNK_THRESHOLD));
            const correlationId = `corr_${crypto.randomBytes(16).toString('hex')}`;
            session.inFlightGrpcRequests++;
            sendAudioToPython(sessionId, correlationId, audioToSend);
            session.audioBuffer = session.audioBuffer.slice(STRIDE_CHUNKS);
        }
    });

    ws.on('close', () => {
        console.log(`[INGRESS] Telephony connection dropped for session: ${sessionId}`);
        const session = liveSessions.get(sessionId);
        if (!session) return;

        if (session.hasReachedThreshold && session.audioBuffer.length > 0) {
            const tailBuffer = Buffer.concat(session.audioBuffer);
            sendAudioToPython(sessionId, `corr_${crypto.randomBytes(16).toString('hex')}`, tailBuffer);
            
            setTimeout(async () => {
                cleanupSession(sessionId);
                console.log(`[MEMORY] Session fully purged: ${sessionId}`);
                
                // Signal the Bridge Worker to aggregate this session
                try {
                    await redisClient.rPush('queue:sessions_to_aggregate', sessionId);
                } catch (e) {
                    pushToDLQ({ sessionId, type: 'queue_trigger' });
                }
            }, 3000);
        } else {
            console.log(`[MEMORY] Call < 4s. Discarding map silently for: ${sessionId}`);
            cleanupSession(sessionId);
        }
    });
}

function handleAgent(ws, targetSessionId) {
    console.log(`[AGENT] Dashboard connected monitoring session: ${targetSessionId}`);
    setTimeout(() => {
        const session = liveSessions.get(targetSessionId);
        if (session) {
            session.agentSocket = ws;
            ws.send(JSON.stringify({ status: 'SYSTEM', message: 'Linked to active call telemetry.' }));
        } else {
            ws.send(JSON.stringify({ status: 'ERROR', message: 'Session not found.' }));
            ws.close();
        }
    }, 500);
    ws.on('close', () => console.log(`[AGENT] Disconnected from: ${targetSessionId}`));
}

module.exports = { handleCaller, handleAgent };