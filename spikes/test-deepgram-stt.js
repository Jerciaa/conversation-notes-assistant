import "dotenv/config";
import { DeepgramClient } from "@deepgram/sdk";
import fs from "fs";

const deepgram = new DeepgramClient();

async function runTranscriptionSpike() {
  // 1. Read synthetic audio into RAM (simulating live microphone buffer)
  const audioBuffer = fs.readFileSync("spikes/sample-visit.mp3");

  console.log("Sending in-memory audio to Deepgram Nova-3 for speaker diarization...");
  const startTime = Date.now();

  const response = await deepgram.listen.v1.media.transcribeFile(audioBuffer, {
    model: "nova-3",
    smart_format: true,
    diarize_model: "latest",
    utterances: true,
  });

  // 2. Immediately zero out the raw audio buffer in RAM (R3: Zero audio retention)
  audioBuffer.fill(0);

  const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n--- Transcript (Generated in ${elapsedSeconds}s) ---\n`);

  const utterances = response.results?.utterances || [];
  for (const turn of utterances) {
    console.log(`Speaker ${turn.speaker + 1}: ${turn.transcript}`);
  }
}

runTranscriptionSpike();