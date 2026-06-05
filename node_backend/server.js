require('dotenv').config()
const http=require('http')
const express = require('express')
const mongoose = require('mongoose')

const initAudioSocket = require('./sockets/audioStream');

const app = express()
app.use(express.json());

const server = http.createServer(app)
initAudioSocket(server);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Gateway server running on port ${PORT}`);
});