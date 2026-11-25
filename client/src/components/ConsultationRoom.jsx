import { useState, useEffect, useRef } from "react";
import { apiRequest, uploadAudioRequest } from "../api";

const VISIT_TYPES = [
  "Primary Care Follow-up",
  "New Patient Intake",
  "Mental Health Check-in",
  "Urgent Acute Visit",
];

export default function ConsultationRoom({ token }) {
  const [patients, setPatients] = useState([]);
  const [visits, setVisits] = useState([]);
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [visitType, setVisitType] = useState(VISIT_TYPES[0]);
  const [activeVisit, setActiveVisit] = useState(null);

  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState("");

  const [soapForm, setSoapForm] = useState({
    subjective: "",
    objective: "",
    assessment: "",
    plan: "",
  });

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    loadInitialData();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [token]);

  async function loadInitialData() {
    try {
      const [pData, vData] = await Promise.all([
        apiRequest("/api/visits/patients", {}, token),
        apiRequest("/api/visits", {}, token),
      ]);
      setPatients(pData.patients || []);
      setVisits(vData.visits || []);
      if (pData.patients?.length > 0 && !selectedPatientId) {
        setSelectedPatientId(pData.patients[0]._id);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  function selectVisit(visit) {
    setActiveVisit(visit);
    setError("");
    setStatusMessage("");
    if (visit?.soapFinal || visit?.soapDraft) {
      const src = visit.soapFinal?.subjective ? visit.soapFinal : visit.soapDraft;
      setSoapForm({
        subjective: src?.subjective || "",
        objective: src?.objective || "",
        assessment: src?.assessment || "",
        plan: src?.plan || "",
      });
    } else {
      setSoapForm({ subjective: "", objective: "", assessment: "", plan: "" });
    }
  }

  async function handleCreateVisit(e) {
    e.preventDefault();
    setError("");
    setStatusMessage("");
    try {
      const data = await apiRequest(
        "/api/visits",
        {
          method: "POST",
          body: JSON.stringify({ patientId: selectedPatientId, visitType }),
        },
        token
      );
      setVisits((prev) => [data.visit, ...prev]);
      selectVisit(data.visit);
      setStatusMessage("Session initialized. Explicit patient consent is required before audio capture.");
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleGrantConsent() {
    if (!activeVisit) return;
    setError("");
    try {
      const data = await apiRequest(
        `/api/visits/${activeVisit._id}/consent/grant`,
        { method: "POST" },
        token
      );
      updateVisitInState(data.visit);
      setStatusMessage("Patient consent recorded. In-memory audio capture unlocked.");
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleWithdrawConsent() {
    if (!activeVisit) return;
    const confirmed = window.confirm(
      "Withdraw patient consent? This will permanently delete the consultation transcript, SOAP note, and visit data."
    );
    if (!confirmed) return;

    setError("");
    try {
      await apiRequest(
        `/api/visits/${activeVisit._id}/consent/withdraw`,
        { method: "POST" },
        token
      );
      setVisits((prev) => prev.filter((v) => v._id !== activeVisit._id));
      setActiveVisit(null);
      setStatusMessage("Consent withdrawn. All visit data and transcripts were permanently purged.");
    } catch (err) {
      setError(err.message);
    }
  }

  function updateVisitInState(updated) {
    setVisits((prev) => prev.map((v) => (v._id === updated._id ? updated : v)));
    selectVisit(updated);
  }

  async function startLiveRecording() {
    setError("");
    setStatusMessage("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        audioChunksRef.current = [];
        await processAudioBlob(audioBlob, "live-consultation.webm");
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);
      timerRef.current = setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);
    } catch (err) {
      setError("Microphone access denied or unavailable. You can upload an audio file instead.");
    }
  }

  function stopLiveRecording() {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }

  async function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    await processAudioBlob(file, file.name);
    e.target.value = "";
  }

  async function processAudioBlob(blob, filename) {
    if (!activeVisit) return;
    setProcessing(true);
    setError("");
    setStatusMessage("Transcribing with speaker diarization and drafting grounded SOAP note...");
    try {
      const formData = new FormData();
      formData.append("audio", blob, filename);
      const data = await uploadAudioRequest(
        `/api/visits/${activeVisit._id}/process-audio`,
        formData,
        token
      );
      updateVisitInState(data.visit);
      const latency = ((data.visit.generationTimeMs || 0) / 1000).toFixed(1);
      setStatusMessage(
        data.visit.aiFallbackUsed
          ? "AI service unavailable — manual clinical SOAP template loaded."
          : `Grounded SOAP draft ready in ${latency}s. Raw audio buffer wiped from memory.`
      );
    } catch (err) {
      setError(err.message);
      setStatusMessage("");
    } finally {
      setProcessing(false);
    }
  }

  async function handleReviewDecision(decision) {
    if (!activeVisit) return;
    setError("");
    try {
      const data = await apiRequest(
        `/api/visits/${activeVisit._id}/review`,
        {
          method: "POST",
          body: JSON.stringify({
            decision,
            soapFinal: soapForm,
          }),
        },
        token
      );
      updateVisitInState(data.visit);
      setStatusMessage(
        decision === "APPROVED"
          ? "SOAP note signed and approved by clinician."
          : "Draft note rejected and flagged in audit log."
      );
    } catch (err) {
      setError(err.message);
    }
  }

  const consentGranted = activeVisit?.consentStatus === "GRANTED";

  return (
    <div className="workspace-grid">
      <aside className="sidebar-panel">
        <div className="card">
          <h2>Start New Consultation</h2>
          <form onSubmit={handleCreateVisit} className="form-stack">
            <label>
              Patient
              <select
                value={selectedPatientId}
                onChange={(e) => setSelectedPatientId(e.target.value)}
              >
                {patients.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.patientCode} — {p.name} ({p.age}y)
                  </option>
                ))}
              </select>
            </label>

            <label>
              Visit Type
              <select value={visitType} onChange={(e) => setVisitType(e.target.value)}>
                {VISIT_TYPES.map((vt) => (
                  <option key={vt} value={vt}>
                    {vt}
                  </option>
                ))}
              </select>
            </label>

            <button type="submit" className="btn btn-primary">
              Create Visit Session
            </button>
          </form>
        </div>

        <div className="card">
          <h3>Your Consultations ({visits.length})</h3>
          {visits.length === 0 ? (
            <p className="muted">No visits yet. Create a session above.</p>
          ) : (
            <ul className="visit-list">
              {visits.map((v) => (
                <li
                  key={v._id}
                  className={`visit-item ${activeVisit?._id === v._id ? "active" : ""}`}
                  onClick={() => selectVisit(v)}
                >
                  <div className="visit-item-top">
                    <strong>{v.patientId?.name || "Patient"}</strong>
                    <span className={`status-tag status-${v.status.toLowerCase()}`}>
                      {v.status.replace(/_/g, " ")}
                    </span>
                  </div>
                  <div className="visit-item-sub">
                    {v.visitType} • {new Date(v.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <section className="main-panel">
        {error && <div className="alert alert-error">{error}</div>}
        {statusMessage && <div className="alert alert-info">{statusMessage}</div>}

        {!activeVisit ? (
          <div className="card empty-state">
            <h2>Select or Create a Consultation</h2>
            <p className="muted">
              Every session enforces explicit patient consent prior to microphone capture and processes audio strictly in volatile RAM.
            </p>
          </div>
        ) : (
          <>
            <div className="card">
              <div className="header-split">
                <div>
                  <h2>
                    {activeVisit.patientId?.name} ({activeVisit.patientId?.patientCode})
                  </h2>
                  <p className="muted">
                    {activeVisit.visitType} • {activeVisit.patientId?.age}y {activeVisit.patientId?.gender}
                  </p>
                </div>
                <div className="consent-actions">
                  {!consentGranted ? (
                    <button type="button" className="btn btn-success" onClick={handleGrantConsent}>
                      Confirm Patient Consent & Unlock Capture
                    </button>
                  ) : (
                    <span className="pill pill-green">Consent Granted</span>
                  )}
                  <button type="button" className="btn btn-danger btn-sm" onClick={handleWithdrawConsent}>
                    Withdraw Consent & Purge Data
                  </button>
                </div>
              </div>

              <div className="chart-strip">
                <div>
                  <strong>History:</strong>{" "}
                  {(activeVisit.patientId?.pastMedicalHistory || []).join(", ") || "None"}
                </div>
                <div>
                  <strong>Medications:</strong>{" "}
                  {(activeVisit.patientId?.activeMedications || []).join(", ") || "None"}
                </div>
                <div>
                  <strong>Allergies:</strong>{" "}
                  {(activeVisit.patientId?.allergies || []).join(", ") || "NKDA"}
                </div>
              </div>
            </div>

            <div className={`card ${!consentGranted ? "locked-panel" : ""}`}>
              <h3>Ambient Audio Capture (Zero Raw Audio Storage)</h3>
              {!consentGranted ? (
                <div className="lock-banner">
                  <strong>Recording Locked — Consent Required:</strong> Confirm patient consent above before starting microphone capture or uploading consultation audio.
                </div>
              ) : (
                <div className="capture-controls">
                  {!isRecording ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={processing}
                      onClick={startLiveRecording}
                    >
                      Start Live Mic Capture (In-Memory)
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={stopLiveRecording}
                    >
                      Stop Recording ({recordingSeconds}s) & Generate SOAP Note
                    </button>
                  )}

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="audio/*"
                    style={{ display: "none" }}
                    onChange={handleFileUpload}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={processing || isRecording}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Upload Consultation Audio (.mp3/.wav)
                  </button>
                </div>
              )}
              {processing && <p className="processing-text">Processing audio in RAM — generating diarized transcript and SOAP draft...</p>}
            </div>

            {activeVisit.transcript && (
              <div className="card">
                <div className="header-split">
                  <h3>Speaker-Labeled Transcript</h3>
                  {activeVisit.speakerMapping && (
                    <span className="pill pill-blue">
                      Speaker 1: {activeVisit.speakerMapping.Speaker1} | Speaker 2: {activeVisit.speakerMapping.Speaker2}
                    </span>
                  )}
                </div>
                <pre className="transcript-box">{activeVisit.transcript}</pre>
              </div>
            )}

            {(activeVisit.soapDraft?.subjective || activeVisit.status === "MANUAL_FALLBACK") && (
              <div className="card">
                <div className="header-split">
                  <h3>Grounded SOAP Note Review & Sign-Off</h3>
                  <span className={`status-tag status-${activeVisit.status.toLowerCase()}`}>
                    {activeVisit.status.replace(/_/g, " ")}
                  </span>
                </div>

                {activeVisit.soapDraft?.verifyFlags?.length > 0 && (
                  <div className="verify-box">
                    <strong>Items Requiring Clinician Verification:</strong>
                    <ul>
                      {activeVisit.soapDraft.verifyFlags.map((flag, idx) => (
                        <li key={idx}>{flag}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="soap-grid">
                  <label>
                    Subjective (S)
                    <textarea
                      rows={4}
                      value={soapForm.subjective}
                      onChange={(e) => setSoapForm({ ...soapForm, subjective: e.target.value })}
                    />
                  </label>
                  <label>
                    Objective (O)
                    <textarea
                      rows={4}
                      value={soapForm.objective}
                      onChange={(e) => setSoapForm({ ...soapForm, objective: e.target.value })}
                    />
                  </label>
                  <label>
                    Assessment (A)
                    <textarea
                      rows={4}
                      value={soapForm.assessment}
                      onChange={(e) => setSoapForm({ ...soapForm, assessment: e.target.value })}
                    />
                  </label>
                  <label>
                    Plan (P)
                    <textarea
                      rows={4}
                      value={soapForm.plan}
                      onChange={(e) => setSoapForm({ ...soapForm, plan: e.target.value })}
                    />
                  </label>
                </div>

                <div className="review-actions">
                  <button
                    type="button"
                    className="btn btn-success"
                    onClick={() => handleReviewDecision("APPROVED")}
                  >
                    Approve & Sign Note
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => handleReviewDecision("REJECTED")}
                  >
                    Reject Draft Note
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}