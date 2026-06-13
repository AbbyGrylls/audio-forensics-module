const mongoose = require('mongoose');

const EvaluationChunkSchema = new mongoose.Schema({
    correlationId: { type: String, required: true },
    spoofProbability: { type: Number, required: true }, // Rule 2: Probability maintained
    status: { type: String, required: true },
    timestamp: { type: Date, required: true }
}, { _id: false }); 

const sessionSummarySchema = new mongoose.Schema({
    sessionId: { type: String, required: true, unique: true, index: true },
    modelVersion: { type: String, required: true },
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    
    peakSpoofProbability: { type: Number, required: true }, // Rule 2: Probability maintained
    aggregatedRisk: { type: Number, required: true },       // Rule 3: The Exception Applied
    finalVerdict: { type: String, enum: ['BONAFIDE', 'SUSPICIOUS', 'SPOOF'], required: true },
    
    timeline: [EvaluationChunkSchema]
});

module.exports = mongoose.model('SessionSummary', sessionSummarySchema);