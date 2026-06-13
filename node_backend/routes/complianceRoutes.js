const express = require('express');
const router = express.Router();

// Adjust the path to your models folder if necessary (assuming it is at the root)
const SessionSummary = require('../models/SessionSummary'); 

// --- Dashboard API Route ---
router.get('/dashboard', async (req, res) => {
    const { range } = req.query; 
    const now = new Date();
    let startTime = new Date();

    if (range === '1h') startTime.setHours(now.getHours() - 1);
    else if (range === '24h') startTime.setDate(now.getDate() - 1);
    else if (range === '7d') startTime.setDate(now.getDate() - 7);
    else if (range === '1m') startTime.setMonth(now.getMonth() - 1);
    else startTime = new Date(0); 

    try {
        const stats = await SessionSummary.aggregate([
            { $match: { startTime: { $gte: startTime } } },
            { $group: {
                _id: null,
                totalSessions: { $sum: 1 },
                flaggedSessions: { $sum: { $cond: [{ $in: ["$finalVerdict", ["SPOOF", "SUSPICIOUS"]] }, 1, 0] } },
                aggRisk: { $avg: "$aggregatedRisk" }
            }}
        ]);

        const sessions = await SessionSummary.aggregate([
            { $match: { startTime: { $gte: startTime } } },
            { $sort: { startTime: -1 } },
            { $limit: 50 },
            { 
                $addFields: { 
                    eventCount: { $size: { $ifNull: ["$timeline", []] } } 
                } 
            },
            { $project: { timeline: 0 } } 
        ]);

        res.json({
            stats: stats[0] || { totalSessions: 0, flaggedSessions: 0, aggRisk: 0 },
            sessions
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Single Session Detail Route ---
router.get('/sessions/:id', async (req, res) => {
    try {
        const session = await SessionSummary.findOne({ sessionId: req.params.id });
        if (!session) return res.status(404).json({ error: 'Not found' });
        res.json(session);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;