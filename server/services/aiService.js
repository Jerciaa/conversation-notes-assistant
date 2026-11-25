export async function transcribeAudioBuffer(audioBuffer, mimetype = "audio/mpeg") {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    throw new Error("Missing DEEPGRAM_API_KEY in .env");
  }

  const contentType =
    mimetype && mimetype.startsWith("audio/") ? mimetype : "audio/mpeg";

  const response = await fetch(
    "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&diarize=true&utterances=true&punctuate=true",
    {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": contentType,
      },
      body: audioBuffer,
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Deepgram STT error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const words = data?.results?.channels?.[0]?.alternatives?.[0]?.words || [];
  const utterances = data?.results?.utterances || [];

  const uniqueWordSpeakers = new Set(
    words.map((w) => w.speaker).filter((s) => s !== undefined && s !== null)
  );

  if (words.length > 0 && uniqueWordSpeakers.size > 1) {
    const lines = [];
    let currentSpeaker = null;
    let currentWords = [];

    for (const w of words) {
      const speakerLabel = `Speaker ${(w.speaker ?? 0) + 1}`;
      if (speakerLabel !== currentSpeaker) {
        if (currentSpeaker !== null && currentWords.length > 0) {
          lines.push(`${currentSpeaker}: ${currentWords.join(" ")}`);
        }
        currentSpeaker = speakerLabel;
        currentWords = [w.punctuated_word || w.word];
      } else {
        currentWords.push(w.punctuated_word || w.word);
      }
    }
    if (currentSpeaker !== null && currentWords.length > 0) {
      lines.push(`${currentSpeaker}: ${currentWords.join(" ")}`);
    }
    return lines.join("\n");
  }

  if (utterances.length > 0) {
    const lines = [];
    let currentSpeaker = null;
    let currentTurn = [];

    for (const u of utterances) {
      const speakerLabel = `Speaker ${(u.speaker ?? 0) + 1}`;
      if (speakerLabel !== currentSpeaker) {
        if (currentSpeaker !== null) {
          lines.push(`${currentSpeaker}: ${currentTurn.join(" ")}`);
        }
        currentSpeaker = speakerLabel;
        currentTurn = [u.transcript];
      } else {
        currentTurn.push(u.transcript);
      }
    }
    if (currentSpeaker !== null) {
      lines.push(`${currentSpeaker}: ${currentTurn.join(" ")}`);
    }
    return lines.join("\n");
  }

  const fallbackTranscript =
    data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
  if (!fallbackTranscript.trim()) {
    throw new Error("No speech detected in audio capture.");
  }
  return `Speaker 1: ${fallbackTranscript}`;
}

export async function generateSoapNote({ transcript, patient, visitType }) {
  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

  if (!apiKey) {
    return buildFallbackSoap(transcript, patient, visitType, "Missing GROQ_API_KEY");
  }

  const systemPrompt = `You are a clinical documentation assistant generating structured SOAP notes for a licensed healthcare provider AND a plain-language After-Visit Summary for the patient.
STRICT GROUNDING RULES (R5 & R6):
1. Every clinical statement in Subjective, Objective, Assessment, and Plan MUST be directly supported by the consultation transcript or the provided patient chart context.
2. NEVER invent vitals, lab values, dosages, or diagnoses not explicitly stated in the transcript.
3. If a detail is ambiguous, inferred, or requires clinician confirmation (e.g., unstated vitals, medication dosage confirmation, allergy cross-check), prefix that sentence with "[VERIFY]" AND add a short explanation to the "verifyFlags" array.
4. Tailor the structure to the visitType ("${visitType}").
5. For "patientSummary", write a clear, warm, jargon-free 2-4 sentence summary directly for the patient explaining what was discussed and their care instructions, strictly grounded in the transcript.
6. For "nextAppointment", extract any follow-up visit timeframe or appointment details mentioned in the transcript (or return "No follow-up appointment scheduled yet").
7. Return ONLY valid JSON with exact keys:
{
  "speaker1Role": "Provider or Patient",
  "speaker2Role": "Patient or Provider",
  "subjective": "string",
  "objective": "string",
  "assessment": "string",
  "plan": "string",
  "patientSummary": "string",
  "nextAppointment": "string",
  "verifyFlags": ["string"]
}`;

  const userPrompt = `Visit Type: ${visitType}
Patient Chart Context:
- Name: ${patient.name} (${patient.age}y, ${patient.gender})
- Past Medical History: ${(patient.pastMedicalHistory || []).join(", ") || "None recorded"}
- Active Medications: ${(patient.activeMedications || []).join(", ") || "None recorded"}
- Known Allergies: ${(patient.allergies || []).join(", ") || "NKDA"}

Speaker-Labeled Consultation Transcript:
${transcript}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Groq API error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const rawContent = data?.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(rawContent);

    return {
      speakerMapping: {
        Speaker1: String(parsed.speaker1Role || "Provider"),
        Speaker2: String(parsed.speaker2Role || "Patient"),
      },
      soapDraft: {
        subjective: String(parsed.subjective || "[VERIFY] No subjective details extracted."),
        objective: String(parsed.objective || "[VERIFY] Objective vitals/exam not stated in transcript."),
        assessment: String(parsed.assessment || "[VERIFY] Clinical assessment requires provider entry."),
        plan: String(parsed.plan || "[VERIFY] Follow-up plan requires provider confirmation."),
        verifyFlags: Array.isArray(parsed.verifyFlags) ? parsed.verifyFlags.map(String) : [],
        isFallback: false,
      },
      patientSummary: String(
        parsed.patientSummary ||
          "Your clinician has recorded notes from this consultation. Please contact the clinic if you have questions about your care plan."
      ),
      nextAppointment: String(
        parsed.nextAppointment || "No follow-up appointment scheduled yet"
      ),
      fallbackUsed: false,
      fallbackReason: "",
    };
  } catch (err) {
    console.error("Groq SOAP generation failed, triggering R11 fallback:", err.message);
    return buildFallbackSoap(transcript, patient, visitType, err.message);
  }
}

export const generateGroundedSoapNote = generateSoapNote;

function buildFallbackSoap(transcript, patient, visitType, reason) {
  return {
    speakerMapping: {
      Speaker1: "Provider",
      Speaker2: "Patient",
    },
    soapDraft: {
      subjective: `[VERIFY] Automated AI drafting temporarily unavailable (${reason}). Patient ${patient.name} seen for ${visitType}. Review speaker transcript directly.`,
      objective: `[VERIFY] No automated objective findings extracted. Known chart allergies: ${(patient.allergies || []).join(", ") || "None"}.`,
      assessment: `[VERIFY] Provider clinical assessment required before signing.`,
      plan: `[VERIFY] Provider treatment and follow-up plan required before signing.`,
      verifyFlags: [
        `Fallback template active (R11): ${reason}. Complete and verify all SOAP sections manually.`,
      ],
      isFallback: true,
    },
    patientSummary:
      "Your clinician is finalizing the summary for your recent visit. Check back shortly for your care instructions.",
    nextAppointment: "No follow-up appointment scheduled yet",
    fallbackUsed: true,
    fallbackReason: reason,
  };
}