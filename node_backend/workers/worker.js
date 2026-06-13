require('dotenv').config();
const mongoose = require('mongoose');
const { createClient } = require('redis');
const SessionSummary = require('../models/SessionSummary');

function computeAggregatedStatus(timeline) {
    if (!timeline || !timeline.length) return { label: 'BONAFIDE', peak: 0, agg: 0 };

    const maxScore = Math.max(...timeline.map(c => c.spoofProbability));
    const aggScore = timeline.reduce((a, b) => a + b.spoofProbability, 0) / timeline.length;
    
    // Check for sustained suspicion (2 chunks in a row over 65%)
    let maxCons = 0, cur = 0;
    timeline.forEach((c) => { 
        if (c.spoofProbability >= 65) { maxCons = Math.max(maxCons, ++cur); } // Lowered from 70 to 65
        else { cur = 0; }
    });

    if (maxCons >= 2 || maxScore >= 85) { // Lowered peak from 90 to 85
        return { label: 'SPOOF', peak: maxScore, agg: aggScore };
    }
    
    // SUSPICIOUS: If it spikes over 50%, or the overall aggregate is elevated
    if (maxScore >= 50 || (aggScore >= 30 && aggScore <= 60)) {
        return { label: 'SUSPICIOUS', peak: maxScore, agg: aggScore };
    }
    
    return { label: 'BONAFIDE', peak: maxScore, agg: aggScore };
}

async function startWorker() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('[WORKER] Connected to MongoDB');
    
    const redisSubscriber = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    await redisSubscriber.connect();
    console.log('[WORKER] Subscribed to Aggregation Queue via BRPOP');

    // Infinite queue processing loop
    while (true) {
        try {
            // Blocks until a sessionId is pushed into the queue (timeout 0 = wait forever)
            const result = await redisSubscriber.brPop('queue:sessions_to_aggregate', 0);
            
            if (result) {
                const sessionId = result.element;
                console.log(`[WORKER] Picked up session for aggregation: ${sessionId}`);
                await aggregateAndSave(redisSubscriber, sessionId);
            }
        } catch (error) {
            console.error('[WORKER] Queue processing error:', error);
            // Brief sleep to prevent tight loop if Redis reconnecting
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

async function aggregateAndSave(redis, sessionId) {
    const chunksKey = `session:${sessionId}:chunks`;
    const modelKey = `session:${sessionId}:model`;

    try {
        // 1. Fetch chunks and model version from Redis
        const rawChunks = await redis.lRange(chunksKey, 0, -1);
        const modelVersion = await redis.get(modelKey) || 'UNKNOWN';

        if (!rawChunks || rawChunks.length === 0) {
            console.log(`[WORKER] No chunks found for ${sessionId}, discarding.`);
            await redis.del([chunksKey, modelKey]);
            return;
        }

        // 2. Parse Data
        const timeline = rawChunks.map(chunk => JSON.parse(chunk));
        
        // 3. Apply your mathematical logic
        const verdictData = computeAggregatedStatus(timeline);

        // 4. Save the Rich Document
        await SessionSummary.create({
            sessionId: sessionId,
            modelVersion: modelVersion,
            startTime: timeline[0].timestamp,
            endTime: timeline[timeline.length - 1].timestamp,
            peakSpoofProbability: parseFloat(verdictData.peak.toFixed(1)),
            aggregatedRisk: parseFloat(verdictData.agg.toFixed(1)),
            finalVerdict: verdictData.label,
            timeline: timeline
        });

        console.log(`[WORKER] Successfully aggregated and saved to MongoDB: ${sessionId} [Verdict: ${verdictData.label}]`);

        // 5. Clean up Redis
        await redis.del([chunksKey, modelKey]);

    } catch (error) {
        console.error(`[WORKER] Failed to aggregate session ${sessionId}:`, error);
        // Note: You can add logic here to push the sessionId to a "failed_aggregation" DLQ
    }
}

startWorker();