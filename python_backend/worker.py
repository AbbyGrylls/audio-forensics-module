import grpc
from concurrent import futures

import numpy as np
import onnxruntime as ort

import aasist_pb2
import aasist_pb2_grpc

print("Loading AASIST-L ONNX model...")
ort_session = ort.InferenceSession("aasist_l.onnx")
input_name = ort_session.get_inputs()[0].name
print("Model loaded successfully!")

class RealAntiSpoofWorker(aasist_pb2_grpc.AntiSpoofServiceServicer):
    def StreamAudio(self, request_iterator, context):
        for chunk in request_iterator:
            session_id = chunk.session_id
            corr_id = chunk.correlation_id 
            audio_bytes = chunk.raw_audio_data
            
            try:
                if len(audio_bytes) % 2 != 0:
                    audio_bytes = audio_bytes[:-1]
                raw_samples = np.frombuffer(audio_bytes, dtype=np.int16)
                
                if len(raw_samples) == 0:
                    print(f"[{session_id}] Warning: Received empty audio buffer chunk.")
                    continue
                TARGET_SAMPLES = 64600
                samples_float = raw_samples.astype(np.float32) / 32768.0
                if len(samples_float) > TARGET_SAMPLES:
                    samples_float = samples_float[:TARGET_SAMPLES]
                elif len(samples_float) < TARGET_SAMPLES:
                    repeats_needed = int(np.ceil(TARGET_SAMPLES / len(samples_float)))
                    samples_float = np.tile(samples_float, repeats_needed)[:TARGET_SAMPLES]
                input_tensor = np.expand_dims(samples_float, axis=0)
                raw_outputs = ort_session.run(None, {input_name: input_tensor})
                logits = None
                for output in raw_outputs:
                    if output.shape == (1, 2):
                        logits = output
                        break
                if logits is None:
                    logits = raw_outputs[-1] 
                print(f"[{session_id}] True Logits [Spoof, Authentic]: {logits}")
                exp_logits = np.exp(logits)
                probabilities = exp_logits / np.sum(exp_logits, axis=1, keepdims=True)
                
                spoof_prob = float(probabilities[0][0])
                is_auth = spoof_prob < 0.5
                print(f"[{session_id}] Evaluated! Corr: {corr_id} | Spoof Chance: {spoof_prob:.1%}")
                yield aasist_pb2.InferenceResult(
                    session_id=session_id,
                    correlation_id=corr_id,  
                    spoof_probability=spoof_prob,
                    is_authentic=is_auth
                )

            except Exception as e:
                print(f"[ERROR] Failed processing audio for {session_id} (Corr: {corr_id}): {e}")
                yield aasist_pb2.InferenceResult(
                    session_id=session_id,
                    correlation_id=corr_id,
                    spoof_probability=1.0, 
                    is_authentic=False
                )
def serve():
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=4))
    aasist_pb2_grpc.add_AntiSpoofServiceServicer_to_server(RealAntiSpoofWorker(), server)
    server.add_insecure_port('[::]:50051')
    print("Zero-Trust Python ML Worker running on port 50051...")
    server.start()
    server.wait_for_termination()

if __name__ == '__main__':
    serve()