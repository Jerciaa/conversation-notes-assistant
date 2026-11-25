import { Communicate } from "edge-tts-universal";
import fs from "fs";

const turns = [
  {
    voice: "en-IN-NeerjaNeural",
    text: "Good morning Rahul. I see you are here for your primary care follow-up. How have your blood pressure readings been at home this past week?"
  },
  {
    voice: "en-IN-PrabhatNeural",
    text: "Good morning doctor. They have been around 132 over 84 in the mornings, and I have been taking my Amlodipine 5 milligrams every day after breakfast. No dizziness or headaches."
  },
  {
    voice: "en-IN-NeerjaNeural",
    text: "That is solid progress. Let us continue Amlodipine 5 milligrams once daily, keep a low-salt diet, and recheck your fasting lipid panel in four weeks."
  }
];

async function buildSampleAudio() {
  const buffers = [];
  for (const turn of turns) {
    const tts = new Communicate(turn.text, { voice: turn.voice });
    for await (const chunk of tts.stream()) {
      if (chunk.type === "audio" && chunk.data) {
        buffers.push(chunk.data);
      }
    }
  }
  fs.writeFileSync("spikes/sample-visit.mp3", Buffer.concat(buffers));
  console.log("Created spikes/sample-visit.mp3 (" + Buffer.concat(buffers).length + " bytes)");
}

buildSampleAudio();