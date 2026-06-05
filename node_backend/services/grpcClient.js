const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

const PROTO_PATH = path.join(__dirname, '../protos/aasist.proto');
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true, longs: String, enums: String, defaults: true, oneofs: true
});
const audioProto = grpc.loadPackageDefinition(packageDefinition).audio;
const client = new audioProto.AntiSpoofService(
    'localhost:50051', 
    grpc.credentials.createInsecure() 
);
const gRpcStream = client.StreamAudio();

gRpcStream.on('error', (err) => {
    console.error('gRPC Client Stream Error:', err);
});
function sendAudioToPython(sessionId, combinedBuffer) {
    gRpcStream.write({
        session_id: sessionId,
        raw_audio_data: combinedBuffer
    });
}
module.exports = { sendAudioToPython, gRpcStream };