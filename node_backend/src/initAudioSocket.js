const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const { JWT_SECRET, MAX_CONCURRENT_SESSIONS } = require('./config');
const { liveSessions } = require('./sessionManager');
const { handleCaller, handleAgent } = require('./handlers');

function initAudioSocket(server) {
    const wss = new WebSocket.Server({ noServer: true, maxPayload: 64 * 1024 });

    server.on('upgrade', (request, socket, head) => {
        try {
            if (liveSessions.size >= MAX_CONCURRENT_SESSIONS) {
                socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
                socket.destroy();
                return;
            }
            const url = new URL(request.url, `http://${request.headers.host}`);
            const targetSessionId = url.searchParams.get('sessionId');

            if (url.pathname === '/ws/agent') {
                if (!targetSessionId) { socket.write('HTTP/1.1 400 Bad Request\r\n\r\n'); socket.destroy(); return; }
                wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request, null, 'agent', targetSessionId));
                return;
            }

            if (url.pathname === '/ws/audio') {
                const token = url.searchParams.get('token');
                if (!token) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
                const decoded = jwt.verify(token, JWT_SECRET);
                wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request, decoded, 'caller', null));
                return;
            }

            socket.destroy();
        } catch (err) {
            console.error(`[SECURITY ALERT] Rejected upgrade: ${err.message}`);
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            socket.destroy();
        }
    });

    wss.on('connection', (ws, request, decodedToken, role, targetSessionId) => {
        if (role === 'caller') handleCaller(ws, decodedToken);
        if (role === 'agent')  handleAgent(ws, targetSessionId);
    });
}

module.exports = initAudioSocket;