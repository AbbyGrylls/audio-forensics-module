const WebSocket = require('ws');
const { sendAudioToPython, gRpcStream } = require('../services/grpcClient');

const liveSessions = new Map();

gRpcStream.on('data', (result) => {
    const { session_id, spoof_probability, is_authentic } = result;
    const session = liveSessions.get(session_id);
    if (session && session.socket.readyState === WebSocket.OPEN) {
        session.socket.send(JSON.stringify({
            spoof_probability,
            is_authentic
        }));
    }
});

function initAudioSocket(server) {
    const wss = new WebSocket.Server({ server, path: '/ws/audio' });
    wss.on('connection', (ws, req) => {
        const sessionId = Math.random().toString(36).substring(7);
        console.log(`New client connected: ${sessionId}`);
        liveSessions.set(sessionId, {
            socket: ws,
            audioBuffer: []
        });
        ws.on('message', (chunk) => {
            const session = liveSessions.get(sessionId);
            if (!session) return;
            session.audioBuffer.push(chunk);
            if (session.audioBuffer.length === 20) {
                const combined4SecBuffer = Buffer.concat(session.audioBuffer);
                sendAudioToPython(sessionId, combined4SecBuffer);
                session.audioBuffer = session.audioBuffer.slice(10);
            }
        });
        ws.on('close', () => {
            console.log(`Client disconnected: ${sessionId}`);
            liveSessions.delete(sessionId);
        });
    });
}
module.exports = initAudioSocket;