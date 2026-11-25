const BASE_URL = process.env.API_BASE_URL || "http://localhost:5000";

async function api(path, options = {}, token = null) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

async function runQaSuite() {
  console.log("=== Conversation Notes Assistant — Automated QA Rubric Suite ===\n");
  let passed = 0;
  let total = 0;

  function check(name, condition, detail = "") {
    total++;
    if (condition) {
      passed++;
      console.log(`[PASS] ${name}${detail ? ` -> ${detail}` : ""}`);
    } else {
      console.error(`[FAIL] ${name}${detail ? ` -> ${detail}` : ""}`);
    }
  }

  const anjaliLogin = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "dr.anjali@clinic.demo", password: "DemoPass123!" }),
  });
  check("Auth: Dr. Anjali login", anjaliLogin.ok && Boolean(anjaliLogin.data.token));
  const anjaliToken = anjaliLogin.data.token;

  const vikramLogin = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "dr.vikram@clinic.demo", password: "DemoPass123!" }),
  });
  check("Auth: Dr. Vikram login", vikramLogin.ok && Boolean(vikramLogin.data.token));
  const vikramToken = vikramLogin.data.token;

  const patientsRes = await api("/api/visits/patients", {}, anjaliToken);
  const patients = patientsRes.data.patients || [];
  check("R16: Synthetic patient dataset loaded", patients.length >= 2, `${patients.length} patients`);

  const visit1Res = await api(
    "/api/visits",
    {
      method: "POST",
      body: JSON.stringify({
        patientId: patients[0]._id,
        visitType: "Primary Care Follow-up",
      }),
    },
    anjaliToken
  );
  const visit1Id = visit1Res.data.visit?._id;
  check(
    "R1: New visit defaults to CONSENT_REQUIRED",
    visit1Res.data.visit?.consentStatus === "PENDING"
  );

  const blockedAudioRes = await api(
    `/api/visits/${visit1Id}/process-audio`,
    {
      method: "POST",
      body: JSON.stringify({
        manualTranscript: "Speaker 1: Test without consent.\nSpeaker 2: Should be blocked.",
      }),
    },
    anjaliToken
  );
  check(
    "R1: Processing blocked without explicit consent (HTTP 403)",
    blockedAudioRes.status === 403
  );

  const vikramReadRes = await api(`/api/visits/${visit1Id}`, {}, vikramToken);
  check(
    "R9: Row-level isolation blocks cross-provider access (HTTP 404)",
    vikramReadRes.status === 404
  );

  const grantRes = await api(`/api/visits/${visit1Id}/consent/grant`, { method: "POST" }, anjaliToken);
  check("R1: Consent granted unlocks visit", grantRes.data.visit?.consentStatus === "GRANTED");

  const primaryTranscript = [
    "Speaker 1: Good morning. How have your blood pressure readings been at home this week?",
    "Speaker 2: Morning doctor. Around 130 over 82 most mornings. Taking Amlodipine 5mg daily after breakfast.",
    "Speaker 1: Great, no dizziness or ankle swelling? Let us continue Amlodipine 5mg daily and recheck labs in four weeks.",
    "Speaker 2: No dizziness at all. Sounds good, thank you.",
  ].join("\n");

  const soap1Res = await api(
    `/api/visits/${visit1Id}/process-audio`,
    {
      method: "POST",
      body: JSON.stringify({ manualTranscript: primaryTranscript }),
    },
    anjaliToken
  );
  const v1 = soap1Res.data.visit;
  check(
    "R5 & R14: Primary Care SOAP generated with all 4 sections",
    Boolean(v1?.soapDraft?.subjective && v1?.soapDraft?.objective && v1?.soapDraft?.assessment && v1?.soapDraft?.plan)
  );
  check(
    "R12: Turnaround latency under 90s",
    v1?.generationTimeMs > 0 && v1?.generationTimeMs < 90000,
    `${(v1?.generationTimeMs / 1000).toFixed(2)}s`
  );

  const approveRes = await api(
    `/api/visits/${visit1Id}/review`,
    {
      method: "POST",
      body: JSON.stringify({
        decision: "APPROVED",
        soapFinal: {
          ...v1.soapDraft,
          plan: v1.soapDraft.plan + " Confirmed low-sodium diet counseling.",
        },
      }),
    },
    anjaliToken
  );
  check("R7: Provider edits and approves SOAP note", approveRes.data.visit?.status === "APPROVED");

  const mhPatient = patients[1] || patients[0];
  const visit2Res = await api(
    "/api/visits",
    {
      method: "POST",
      body: JSON.stringify({
        patientId: mhPatient._id,
        visitType: "Mental Health Check-in",
      }),
    },
    vikramToken
  );
  const visit2Id = visit2Res.data.visit?._id;
  await api(`/api/visits/${visit2Id}/consent/grant`, { method: "POST" }, vikramToken);

  const mhTranscript = [
    "Speaker 1: Welcome back. How has your sleep and anxiety been over the past two weeks?",
    "Speaker 2: Sleep is slightly better, about six hours a night, though work stress still triggers racing thoughts.",
    "Speaker 1: Are you having any thoughts of self-harm or hopelessness?",
    "Speaker 2: No, none at all. The breathing exercises help.",
  ].join("\n");

  const soap2Res = await api(
    `/api/visits/${visit2Id}/process-audio`,
    {
      method: "POST",
      body: JSON.stringify({ manualTranscript: mhTranscript }),
    },
    vikramToken
  );
  check(
    "R14: Mental Health Check-in SOAP generated",
    soap2Res.ok && Boolean(soap2Res.data.visit?.soapDraft?.assessment)
  );

  const withdrawRes = await api(
    `/api/visits/${visit2Id}/consent/withdraw`,
    { method: "POST" },
    vikramToken
  );
  const afterPurgeRes = await api(`/api/visits/${visit2Id}`, {}, vikramToken);
  check(
    "R2: Consent withdrawal permanently purges visit & transcript",
    withdrawRes.data?.purged === true && afterPurgeRes.status === 404
  );

  const auditRes = await api("/api/admin/audit-logs?action=CONSENT_WITHDRAWN_PURGED", {}, vikramToken);
  check(
    "R8: Audit trail retains CONSENT_WITHDRAWN_PURGED record",
    (auditRes.data.logs || []).length >= 1
  );

  console.log(`\n=== QA Score: ${passed}/${total} checks passed ===`);
}

runQaSuite().catch((err) => {
  console.error("QA Suite error:", err);
  process.exit(1);
});