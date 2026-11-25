import { useState, useEffect, useRef } from "react";
import { apiRequest, uploadAudioRequest } from "../api";

const VISIT_TYPES = [
  "Primary Care Follow-up",
  "New Patient Intake",
  "Mental Health Check-in",
  "Urgent Acute Visit",
];

function formatAvailabilityLabel(status) {
  if (status === "BUSY") return "Busy — Call Later";
  if (status === "REQUEST_CALLBACK") return "Requesting Callback";
  return "Available Now";
}

export default function ConsultationRoom({ token }) {
  const [patients, setPatients] = useState([]);
  const [visits, setVisits] = useState([]);
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [visitType, setVisitType] = useState(VISIT_TYPES[0]);
  const [activeVisitId, setActiveVisitId] = useState("");

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
    patientSummary: "",
    nextAppointment: "",
  });

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    loadInitialData(false);
    const interval = setInterval(() => {
      loadInitialData(true);
    }, 3000);
    return () => {
      clearInterval(interval);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [token]);

  async function loadInitialData(silent = false) {
    try {
      const [pData, vData] = await Promise.all([
        apiRequest("/api/visits/patients", {}, token),
        apiRequest("/api/visits", {}, token),
      ]);
      const loadedPatients = pData.patients || [];
      const loadedVisits = vData.visits || [];
      setPatients(loadedPatients);
      setVisits(loadedVisits);
      if (!silent && loadedPatients.length > 0 && !selectedPatientId) {
        setSelectedPatientId(loadedPatients[0]._id);
      }
    } catch (err) {
      if (!silent) setError(err.message);
    }
  }

  const activeVisit = visits.find((v) => v._id === activeVisitId) || null;

  function selectVisit(visit) {
    setActiveVisitId(visit?._id || "");
    setError("");
    setStatusMessage("");
    if (visit?.soapFinal || visit?.soapDraft) {
      const src = visit.soapFinal?.subjective ? visit.soapFinal : visit.soapDraft;
      setSoapForm({
        subjective: src?.subjective || "",
        objective: src?.objective || "",
        assessment: src?.assessment || "",
        plan: src?.plan || "",
        patientSummary: visit.patientSummary || "",
        nextAppointment: visit.nextAppointment || "",
      });
    } else {
      setSoapForm({
        subjective: "",
        objective: "",
        assessment: "",
        plan: "",
        patientSummary: "",
        nextAppointment: "",
      });
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
      setStatusMessage("Session initialized. Ring the patient portal or confirm verbal consent to start.");
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleStartCall() {
    if (!activeVisit) return;
    setError("");
    try {
      const data = await apiRequest(
        `/api/visits/${activeVisit._id}/call/start`,
        { method: "POST" },
        token
      );
      updateVisitInState(data.visit);
      setStatusMessage("Ringing patient's portal device — waiting for patient to answer and approve consent...");
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
      setStatusMessage("In-room verbal consent recorded. Microphone capture unlocked.");
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
      setActiveVisitId("");
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
          : `Grounded SOAP draft & patient summary ready in ${latency}s. Raw audio wiped from memory.`
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
            soapFinal: {
              subjective: soapForm.subjective,
              objective: soapForm.objective,
              assessment: soapForm.assessment,
              plan: soapForm.plan,
            },
            patientSummary: soapForm.patientSummary,
            nextAppointment: soapForm.nextAppointment,
          }),
        },
        token
      );
      updateVisitInState(data.visit);
      setStatusMessage(
        decision === "APPROVED"
          ? "SOAP note signed and patient summary published to Patient Portal."
          : "Draft note rejected and flagged in audit log."
      );
    } catch (err) {
      setError(err.message);
    }
  }

  const consentGranted = activeVisit?.consentStatus === "GRANTED";
  const selectedPatientObj = patients.find((p) => p._id === selectedPatientId);
  const livePatientForVisit = activeVisit
    ? patients.find((p) => p._id === (activeVisit.patientId?._id || activeVisit.patientId)) ||
      activeVisit.patientId
    : null;

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
                    {p.patientCode} — {p.name} ({formatAvailabilityLabel(p.availabilityStatus)})
                  </option>
                ))}
              </select>
            </label>

            {selectedPatientObj && (
              <div
                style={{
                  padding: "0.65rem 0.75rem",
                  borderRadius: "6px",
                  background: "#f8fafc",
                  border: "1px solid #d0d7de",
                  fontSize: "0.85rem",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong>Patient Call Status:</strong>
                  <span
                    className={`pill ${
                      selectedPatientObj.availabilityStatus === "BUSY"
                        ? "pill-blue"
                        : "pill-green"
                    }`}
                  >
                    {formatAvailabilityLabel(selectedPatientObj.availabilityStatus)}
                  </span>
                </div>
                {selectedPatientObj.availabilityNote && (
                  <p style={{ marginTop: "0.35rem", marginBottom: 0 }}>
                    <strong>Message:</strong> &ldquo;{selectedPatientObj.availabilityNote}&rdquo;
                  </p>
                )}
              </div>
            )}

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
                    {v.visitType} •{" "}
                    {new Date(v.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
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
              Call the patient on their Patient Portal device to request consent, or record in-room after obtaining verbal consent.
            </p>
          </div>
        ) : (
          <>
            <div className="card">
              <div className="header-split">
                <div>
                  <h2>
                    {livePatientForVisit?.name} ({livePatientForVisit?.patientCode})
                  </h2>
                  <p className="muted">
                    {activeVisit.visitType} • {livePatientForVisit?.age}y {livePatientForVisit?.gender}
                  </p>
                  {livePatientForVisit && (
                    <div style={{ marginTop: "0.4rem" }}>
                      <span className="pill pill-blue">
                        Call Status: {formatAvailabilityLabel(livePatientForVisit.availabilityStatus)}
                      </span>
                      {livePatientForVisit.availabilityNote && (
                        <span style={{ marginLeft: "0.5rem", fontSize: "0.9rem" }}>
                          &ldquo;{livePatientForVisit.availabilityNote}&rdquo;
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="consent-actions">
                  {!consentGranted ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={handleStartCall}
                      >
                        {activeVisit.status === "CALL_RINGING"
                          ? "Ringing Patient Portal..."
                          : "Call Patient Portal"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={handleGrantConsent}
                      >
                        Override: In-Room Verbal Consent
                      </button>
                    </>
                  ) : (
                    <span className="pill pill-green">
                      {activeVisit.status === "IN_CALL"
                        ? "Call Answered — Consent Granted"
                        : "Consent Granted"}
                    </span>
                  )}
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={handleWithdrawConsent}
                  >
                    Withdraw Consent &amp; Purge Data
                  </button>
                </div>
              </div>

              <div className="chart-strip">
                <div>
                  <strong>History:</strong>{" "}
                  {(livePatientForVisit?.pastMedicalHistory || []).join(", ") || "None"}
                </div>
                <div>
                  <strong>Medications:</strong>{" "}
                  {(livePatientForVisit?.activeMedications || []).join(", ") || "None"}
                </div>
                <div>
                  <strong>Allergies:</strong>{" "}
                  {(livePatientForVisit?.allergies || []).join(", ") || "NKDA"}
                </div>
              </div>
            </div>

            <div className={`card ${!consentGranted ? "locked-panel" : ""}`}>
              <h3>Ambient Call &amp; Speech Capture (Zero Raw Audio Storage)</h3>
              {!consentGranted ? (
                <div className="lock-banner">
                  <strong>Capture Locked — Waiting for Patient Consent:</strong> Click{" "}
                  <strong>Call Patient Portal</strong> above so the patient can pick up and approve consent on their device.
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
                      Speak &amp; Capture Live Call (In-Memory)
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={stopLiveRecording}
                    >
                      End Call ({recordingSeconds}s) &amp; Generate SOAP + Patient Summary
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
              {processing && (
                <p className="processing-text">
                  Processing audio in RAM — generating diarized transcript, SOAP draft, and patient summary...
                </p>
              )}
            </div>

            {activeVisit.transcript && (
              <div className="card">
                <div className="header-split">
                  <h3>Speaker-Labeled Transcript</h3>
                  {activeVisit.speakerMapping && (
                    <span className="pill pill-blue">
                      Speaker 1: {activeVisit.speakerMapping.Speaker1} | Speaker 2:{" "}
                      {activeVisit.speakerMapping.Speaker2}
                    </span>
                  )}
                </div>
                <pre className="transcript-box">{activeVisit.transcript}</pre>
              </div>
            )}

            {(activeVisit.soapDraft?.subjective || activeVisit.status === "MANUAL_FALLBACK") && (
              <div className="card">
                <div className="header-split">
                  <h3>Grounded SOAP Note Review &amp; Sign-Off</h3>
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

                <div className="form-stack" style={{ marginTop: "1rem" }}>
                  <label>
                    Patient Portal After-Visit Summary (Plain Language)
                    <textarea
                      rows={3}
                      value={soapForm.patientSummary}
                      onChange={(e) =>
                        setSoapForm({ ...soapForm, patientSummary: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Patient Portal Follow-Up / Next Appointment
                    <input
                      type="text"
                      value={soapForm.nextAppointment}
                      onChange={(e) =>
                        setSoapForm({ ...soapForm, nextAppointment: e.target.value })
                      }
                    />
                  </label>
                </div>

                <div className="review-actions">
                  <button
                    type="button"
                    className="btn btn-success"
                    onClick={() => handleReviewDecision("APPROVED")}
                  >
                    Approve &amp; Sign Note
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