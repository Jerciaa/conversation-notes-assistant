import { useState, useEffect, useRef } from "react";
import { apiRequest, uploadAudioRequest } from "../api";

const VISIT_TYPES = [
  "Primary Care Follow-up",
  "New Patient Intake",
  "Mental Health Check-in",
  "Urgent Acute Visit",
];

const ICE_SERVERS = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

function formatAvailabilityLabel(status) {
  if (status === "BUSY") return "Busy — Call Later";
  if (status === "REQUEST_CALLBACK") return "Requesting Callback";
  return "Available Now";
}

function formatDateTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function ConsultationRoom({ token }) {
  const [patients, setPatients] = useState([]);
  const [visits, setVisits] = useState([]);
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [visitType, setVisitType] = useState(VISIT_TYPES[0]);
  const [activeVisitId, setActiveVisitId] = useState("");

  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [callConnected, setCallConnected] = useState(false);
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
  const skipUploadOnStopRef = useRef(false);
  const timerRef = useRef(null);
  const fileInputRef = useRef(null);

  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const audioCtxRef = useRef(null);
  const mergerRef = useRef(null);
  const remoteConnectedToMixerRef = useRef(false);
  const answerAppliedRef = useRef(false);
  const appliedPatientIceCountRef = useRef(0);
  const autoCaptureStartedRef = useRef(false);

  useEffect(() => {
    loadInitialData(false);
    const interval = setInterval(() => {
      loadInitialData(true);
    }, 2500);
    return () => {
      clearInterval(interval);
      if (timerRef.current) clearInterval(timerRef.current);
      cleanupCallResources();
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

  function stopRecordingSilently() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      skipUploadOnStopRef.current = true;
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
    setIsRecording(false);
    setRecordingSeconds(0);
  }

  function attachRemoteStreamToMixer(stream) {
    if (!stream || remoteConnectedToMixerRef.current) return;
    if (audioCtxRef.current && mergerRef.current && stream.getAudioTracks().length > 0) {
      try {
        const remoteSource = audioCtxRef.current.createMediaStreamSource(stream);
        remoteSource.connect(mergerRef.current, 0, 1);
        remoteConnectedToMixerRef.current = true;
      } catch (err) {
        console.error("Failed to attach remote stream to mixer:", err);
      }
    }
  }

  useEffect(() => {
    if (!activeVisit) return;

    // If patient withdrew consent mid-call, stop recording immediately while keeping the live call running
    if (activeVisit.consentStatus === "WITHDRAWN" && isRecording) {
      stopRecordingSilently();
      setStatusMessage("Consent removed — recording stopped. Live voice call continues normally.");
    }

    if (
      activeVisit.status !== "IN_CALL" &&
      activeVisit.status !== "CALL_RINGING" &&
      peerRef.current
    ) {
      cleanupCallResources();
      setStatusMessage("Call ended.");
      return;
    }

    if (!peerRef.current) return;

    async function syncWebRTC() {
      const pc = peerRef.current;
      if (!pc) return;

      if (activeVisit.webrtcAnswer && !answerAppliedRef.current) {
        answerAppliedRef.current = true;
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(activeVisit.webrtcAnswer));
          setCallConnected(true);
          setStatusMessage(
            activeVisit.consentStatus === "GRANTED"
              ? "Live voice call connected! Recording Provider & Patient voices."
              : "Live voice call connected (unrecorded)."
          );
        } catch (err) {
          console.error("Failed to set remote answer:", err);
        }
      }

      const candidates = activeVisit.patientIceCandidates || [];
      if (answerAppliedRef.current && candidates.length > appliedPatientIceCountRef.current) {
        for (let i = appliedPatientIceCountRef.current; i < candidates.length; i += 1) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidates[i]));
          } catch (err) {
            console.error("Error adding patient ICE candidate:", err);
          }
        }
        appliedPatientIceCountRef.current = candidates.length;
      }

      if (
        activeVisit.status === "IN_CALL" &&
        activeVisit.consentStatus === "GRANTED" &&
        !autoCaptureStartedRef.current &&
        !isRecording
      ) {
        autoCaptureStartedRef.current = true;
        startMixedCallRecording();
      }
    }

    syncWebRTC();
  }, [activeVisit]);

  function cleanupCallResources() {
    if (peerRef.current) {
      peerRef.current.close();
      peerRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    mergerRef.current = null;
    remoteConnectedToMixerRef.current = false;
    remoteStreamRef.current = null;
    answerAppliedRef.current = false;
    appliedPatientIceCountRef.current = 0;
    autoCaptureStartedRef.current = false;
    setCallConnected(false);
  }

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
        patientSummary: visit?.patientSummary || "",
        nextAppointment: visit?.nextAppointment || "",
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
      setStatusMessage("Session initialized. Click Call Patient Portal to start live two-way voice.");
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleStartCall() {
    if (!activeVisit) return;
    setError("");
    setStatusMessage("Requesting microphone access and ringing patient portal...");
    try {
      cleanupCallResources();
      const localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = localStream;

      const pc = new RTCPeerConnection(ICE_SERVERS);
      peerRef.current = pc;

      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });

      pc.ontrack = (event) => {
        const [stream] = event.streams;
        remoteStreamRef.current = stream;
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = stream;
          remoteAudioRef.current.play().catch(() => {});
        }
        attachRemoteStreamToMixer(stream);
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          apiRequest(
            `/api/visits/${activeVisit._id}/call/ice`,
            {
              method: "POST",
              body: JSON.stringify({ candidate: event.candidate.toJSON() }),
            },
            token
          ).catch(() => {});
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const data = await apiRequest(
        `/api/visits/${activeVisit._id}/call/start`,
        {
          method: "POST",
          body: JSON.stringify({ offer: pc.localDescription }),
        },
        token
      );
      updateVisitInState(data.visit);
      setStatusMessage("Ringing patient portal — waiting for patient to pick up...");
    } catch (err) {
      cleanupCallResources();
      setError("Could not start call: " + err.message);
    }
  }

  // Button 1: Cut Call (leaves consent state untouched)
  async function handleCutCall() {
    if (!activeVisit) return;
    setError("");
    try {
      if (mediaRecorderRef.current && isRecording && activeVisit.consentStatus === "GRANTED") {
        skipUploadOnStopRef.current = false;
        mediaRecorderRef.current.stop();
        setIsRecording(false);
        if (timerRef.current) clearInterval(timerRef.current);
      } else {
        stopRecordingSilently();
        cleanupCallResources();
        const data = await apiRequest(
          `/api/visits/${activeVisit._id}/call/hangup`,
          { method: "POST" },
          token
        );
        updateVisitInState(data.visit);
        setStatusMessage("Call cut. Consent status unchanged.");
      }
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

  // Button 2: Remove Consent (stops recording & clears SOAP data, keeps live call active)
  async function handleWithdrawConsent() {
    if (!activeVisit) return;
    const confirmed = window.confirm(
      "Remove consent? AI recording and SOAP note generation will stop and any draft notes will be purged, while the live call and visit history remain intact."
    );
    if (!confirmed) return;

    setError("");
    try {
      stopRecordingSilently();
      const data = await apiRequest(
        `/api/visits/${activeVisit._id}/consent/withdraw`,
        { method: "POST" },
        token
      );
      if (data.visit) {
        updateVisitInState(data.visit);
      }
      setStatusMessage(
        "Consent removed. Recording stopped and SOAP data purged; live call continues without recording."
      );
    } catch (err) {
      setError(err.message);
    }
  }

  function updateVisitInState(updated) {
    setVisits((prev) => prev.map((v) => (v._id === updated._id ? updated : v)));
    selectVisit(updated);
  }

  async function startMixedCallRecording() {
    setError("");
    try {
      const localStream =
        localStreamRef.current || (await navigator.mediaDevices.getUserMedia({ audio: true }));
      localStreamRef.current = localStream;

      const audioCtx = new AudioContext();
      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }
      audioCtxRef.current = audioCtx;

      const merger = audioCtx.createChannelMerger(2);
      mergerRef.current = merger;
      const destination = audioCtx.createMediaStreamDestination();
      destination.channelCount = 2;
      merger.connect(destination);
      remoteConnectedToMixerRef.current = false;

      const localSource = audioCtx.createMediaStreamSource(localStream);
      localSource.connect(merger, 0, 0);

      if (remoteStreamRef.current) {
        attachRemoteStreamToMixer(remoteStreamRef.current);
      }

      const recorder = new MediaRecorder(destination.stream);
      audioChunksRef.current = [];
      skipUploadOnStopRef.current = false;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        const shouldSkip = skipUploadOnStopRef.current;
        skipUploadOnStopRef.current = false;
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        audioChunksRef.current = [];

        if (shouldSkip) {
          return;
        }

        cleanupCallResources();
        if (activeVisit) {
          await apiRequest(`/api/visits/${activeVisit._id}/call/end`, { method: "POST" }, token).catch(
            () => {}
          );
        }
        await processAudioBlob(audioBlob, "live-consultation.webm", true);
      };

      mediaRecorderRef.current = recorder;
      recorder.start(500);
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
      skipUploadOnStopRef.current = false;
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }

  async function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    await processAudioBlob(file, file.name, false);
    e.target.value = "";
  }

  async function processAudioBlob(blob, filename, isStereoCall = false) {
    if (!activeVisit) return;
    setProcessing(true);
    setError("");
    setStatusMessage("Transcribing Provider & Patient voices and drafting SOAP note...");
    try {
      const formData = new FormData();
      formData.append("audio", blob, filename);
      formData.append("isStereoCall", isStereoCall ? "true" : "false");
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
          ? "SOAP note signed, archived in database for provider, and summary sent to Patient Portal."
          : "Draft note rejected and flagged in audit log."
      );
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDownloadPatientSoapArchive(patientObj) {
    if (!patientObj?._id) return;
    setError("");
    try {
      const res = await fetch(`/api/visits/patients/${patientObj._id}/soap-archive`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Could not download SOAP archive file");
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${patientObj.patientCode || "patient"}_approved_soap_notes.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  }

  const consentGranted = activeVisit?.consentStatus === "GRANTED";
  const consentWithdrawn = activeVisit?.consentStatus === "WITHDRAWN";
  const isCallActive =
    activeVisit?.status === "IN_CALL" ||
    activeVisit?.status === "CALL_RINGING" ||
    callConnected ||
    isRecording;
  const isNoteFinalized =
    activeVisit?.status === "APPROVED" || activeVisit?.status === "REJECTED";

  const selectedPatientObj = patients.find((p) => p._id === selectedPatientId);
  const livePatientForVisit = activeVisit
    ? patients.find((p) => p._id === (activeVisit.patientId?._id || activeVisit.patientId)) ||
      activeVisit.patientId
    : null;

  const inlineVerifyMatches = activeVisit
    ? [
        soapForm.subjective,
        soapForm.objective,
        soapForm.assessment,
        soapForm.plan,
      ]
        .join("\n")
        .match(/[^\n.]*\[VERIFY\][^\n.]*/gi) || []
    : [];

  const allVerifyAlerts = activeVisit
    ? Array.from(
        new Set([
          ...(activeVisit.soapDraft?.verifyFlags || []),
          ...inlineVerifyMatches.map((line) => line.trim()),
        ])
      )
    : [];

  return (
    <div className="workspace-grid">
      <audio ref={remoteAudioRef} autoPlay playsInline style={{ display: "none" }} />

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
                  <p style={{ marginTop: "0.35rem", marginBottom: "0.5rem" }}>
                    <strong>Message:</strong> &ldquo;{selectedPatientObj.availabilityNote}&rdquo;
                  </p>
                )}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ width: "100%", marginTop: "0.4rem" }}
                  onClick={() => handleDownloadPatientSoapArchive(selectedPatientObj)}
                >
                  Download Approved SOAP Archive ({selectedPatientObj.patientCode})
                </button>
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
          <h3>Your Consultations &amp; Call History ({visits.length})</h3>
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
                    {v.visitType} • {formatDateTime(v.createdAt)}
                  </div>
                  {v.nextAppointment && (
                    <div className="visit-item-sub" style={{ marginTop: "0.2rem", color: "#0f766e" }}>
                      <strong>Next Appointment:</strong> {v.nextAppointment}
                    </div>
                  )}
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
              Call the patient on their Patient Portal device to speak live and capture both voices automatically.
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
                  <p className="muted" style={{ fontSize: "0.85rem", marginTop: "0.2rem" }}>
                    <strong>Session Created:</strong> {formatDateTime(activeVisit.createdAt)}
                    {activeVisit.callStartedAt && (
                      <>
                        {" "}
                        - <strong>Call Started:</strong> {formatDateTime(activeVisit.callStartedAt)}
                      </>
                    )}
                  </p>
                  {activeVisit.nextAppointment && (
                    <p style={{ fontSize: "0.85rem", marginTop: "0.25rem", color: "#0f766e" }}>
                      <strong>Next Appointment:</strong> {activeVisit.nextAppointment}
                    </p>
                  )}
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
                  {livePatientForVisit && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleDownloadPatientSoapArchive(livePatientForVisit)}
                    >
                      Download Approved SOAP File
                    </button>
                  )}

                  {consentGranted ? (
                    <span className="pill pill-green">
                      {callConnected
                        ? "Live Voice Connected — Consent Granted"
                        : activeVisit.status === "IN_CALL"
                        ? "Call Answered — Consent Granted"
                        : "Consent Granted"}
                    </span>
                  ) : consentWithdrawn ? (
                    <span className="pill pill-blue">
                      {isCallActive ? "Live Call Active — Consent Removed" : "Consent Removed"}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={handleGrantConsent}
                    >
                      Override: In-Room Verbal Consent
                    </button>
                  )}

                  {/* Button 1: Cut Call (or Start/Call Again when not in call) */}
                  {isCallActive ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={handleCutCall}
                    >
                      Cut Call
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={handleStartCall}
                    >
                      {activeVisit.status === "CALL_RINGING"
                        ? "Ringing Patient Portal..."
                        : "Call Patient Portal"}
                    </button>
                  )}

                  {/* Button 2: Remove Consent (independent of Cut Call) */}
                  {!consentWithdrawn && (
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={handleWithdrawConsent}
                    >
                      Remove Consent
                    </button>
                  )}
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
              <h3>Two-Way Live Voice &amp; Ambient Capture (Zero Raw Audio Storage)</h3>
              {!consentGranted ? (
                <div className="lock-banner">
                  <strong>
                    {consentWithdrawn
                      ? "Consent Removed — Normal Unrecorded Call Mode:"
                      : "Capture Locked — Waiting for Patient Consent:"}
                  </strong>{" "}
                  {consentWithdrawn
                    ? "AI recording and SOAP note generation are disabled for this consultation."
                    : "Click Call Patient Portal above so the patient can pick up and start the two-way call."}
                </div>
              ) : (
                <div className="capture-controls">
                  {!isRecording ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={processing}
                      onClick={startMixedCallRecording}
                    >
                      Start Live Call Capture (Both Voices)
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={stopLiveRecording}
                    >
                      Stop Capture ({recordingSeconds}s) &amp; Generate SOAP + Summary
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
                  Processing audio in RAM — generating Provider &amp; Patient transcript, SOAP draft, and patient summary...
                </p>
              )}
            </div>

            {activeVisit.transcript && (
              <div className="card">
                <div className="header-split">
                  <h3>Consultation Transcript</h3>
                  <span className="muted" style={{ fontSize: "0.85rem" }}>
                    Recorded: {formatDateTime(activeVisit.createdAt)}
                  </span>
                </div>
                <pre className="transcript-box">{activeVisit.transcript}</pre>
              </div>
            )}

            {(activeVisit.soapDraft?.subjective || activeVisit.status === "MANUAL_FALLBACK") && (
              <div className="card">
                <div className="header-split">
                  <div>
                    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
                      <h3 style={{ margin: 0 }}>Grounded SOAP Note Review &amp; Sign-Off</h3>
                      {allVerifyAlerts.length > 0 && (
                        <span
                          style={{
                            background: "#dc2626",
                            color: "#ffffff",
                            fontWeight: 700,
                            fontSize: "0.75rem",
                            padding: "0.2rem 0.6rem",
                            borderRadius: "999px",
                            textTransform: "uppercase",
                            letterSpacing: "0.03em",
                          }}
                        >
                          Needs Verification ({allVerifyAlerts.length})
                        </span>
                      )}
                    </div>
                    <span className="muted" style={{ fontSize: "0.85rem" }}>
                      Note Created: {formatDateTime(activeVisit.createdAt)} • Last Updated:{" "}
                      {formatDateTime(activeVisit.updatedAt)}
                    </span>
                  </div>
                  <span className={`status-tag status-${activeVisit.status.toLowerCase()}`}>
                    {activeVisit.status.replace(/_/g, " ")}
                  </span>
                </div>

                {allVerifyAlerts.length > 0 && (
                  <div
                    className="alert alert-error"
                    style={{
                      border: "2px solid #dc2626",
                      background: "#fef2f2",
                      color: "#991b1b",
                      marginTop: "0.75rem",
                      marginBottom: "1rem",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        marginBottom: "0.4rem",
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        style={{
                          background: "#dc2626",
                          color: "#ffffff",
                          fontWeight: 700,
                          fontSize: "0.75rem",
                          padding: "0.2rem 0.55rem",
                          borderRadius: "999px",
                          letterSpacing: "0.03em",
                          textTransform: "uppercase",
                        }}
                      >
                        Hallucination / Verification Alert
                      </span>
                      <strong>Clinician Review Required Before Signing</strong>
                    </div>
                    <ul style={{ margin: "0.25rem 0 0 1.25rem" }}>
                      {allVerifyAlerts.map((flag, idx) => (
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
                      disabled={isNoteFinalized}
                      value={soapForm.subjective}
                      onChange={(e) => setSoapForm({ ...soapForm, subjective: e.target.value })}
                    />
                  </label>
                  <label>
                    Objective (O)
                    <textarea
                      rows={4}
                      disabled={isNoteFinalized}
                      value={soapForm.objective}
                      onChange={(e) => setSoapForm({ ...soapForm, objective: e.target.value })}
                    />
                  </label>
                  <label>
                    Assessment (A)
                    <textarea
                      rows={4}
                      disabled={isNoteFinalized}
                      value={soapForm.assessment}
                      onChange={(e) => setSoapForm({ ...soapForm, assessment: e.target.value })}
                    />
                  </label>
                  <label>
                    Plan (P)
                    <textarea
                      rows={4}
                      disabled={isNoteFinalized}
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
                      disabled={isNoteFinalized}
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
                      disabled={isNoteFinalized}
                      value={soapForm.nextAppointment}
                      onChange={(e) =>
                        setSoapForm({ ...soapForm, nextAppointment: e.target.value })
                      }
                    />
                  </label>
                </div>

                {/* Hide Approve & Reject buttons once finalized */}
                {!isNoteFinalized ? (
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
                ) : (
                  <div style={{ marginTop: "1rem" }}>
                    <span
                      className={`pill ${
                        activeVisit.status === "APPROVED" ? "pill-green" : "pill-blue"
                      }`}
                    >
                      {activeVisit.status === "APPROVED"
                        ? "✓ Note Approved & Signed"
                        : "Draft Rejected"}
                    </span>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}