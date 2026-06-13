const express = require('express');
const router = express.Router();
const { askCopilot } = require('../services/copilotService');

// POST endpoint for the AI Copilot chat interface
router.post('/ask', async (req, res) => {
    try {
        const { question } = req.body;

        if (!question || typeof question !== 'string') {
            return res.status(400).json({ error: 'A valid question string is required in the request body.' });
        }

        console.log(`[Copilot API] Received query: "${question}"`);
        
        // Execute the local RAG pipeline
        const aiAnswer = await askCopilot(question);

        return res.status(200).json({ answer: aiAnswer });
    } catch (error) {
        console.error('[Copilot API] Error generating response:', error);
        return res.status(500).json({ error: 'Internal server error running local AI compilation.' });
    }
});

module.exports = router;