require('dotenv').config();
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');

const initAudioSocket = require('./src/initAudioSocket');
const { initVectorStore } = require('./services/copilotService');

// Import the new modular routes
const complianceRoutes = require('./routes/complianceRoutes');
const copilotRoutes = require('./routes/copilotRoutes');

const app = express();
app.use(express.json());

// --- Mount Routers ---
app.use('/api/compliance', complianceRoutes);
app.use('/api/copilot', copilotRoutes);

// --- Server Init ---
const server = http.createServer(app);
initAudioSocket(server);

// Database Connection
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('DB Connection Failed', err));

const PORT = process.env.PORT || 3000;

// Initialize the Vector Store before accepting network traffic
async function startServer() {
    try {
        // Load system rules into RAM for local AI
        await initVectorStore();
        
        server.listen(PORT, () => {
            console.log(`Gateway server running on port ${PORT}`);
        });
    } catch (error) {
        console.error("Failed to start the server:", error);
        process.exit(1);
    }
}

startServer();