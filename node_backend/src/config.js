const { createClient } = require('redis');

const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redisClient.on('error', (err) => console.error('[REDIS] Client Error', err));
redisClient.connect().then(() => console.log('[REDIS] Client Connected'));

module.exports = {
    JWT_SECRET: process.env.JWT_SECRET,
    MAX_CONCURRENT_SESSIONS: 500,
    SESSION_TTL_MS: 30 * 60 * 1000,
    CHUNK_THRESHOLD: 20,
    STRIDE_CHUNKS: 10,
    MAX_BUFFER_CHUNKS: 100,
    MAX_IN_FLIGHT_GRPC: 1,
    MAX_DLQ_SIZE: 5000,
    redisClient // Renamed from redisPublisher
};