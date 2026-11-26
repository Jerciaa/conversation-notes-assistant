import { useState, useEffect, useRef } from "react";
import { apiRequest } from "../api";

const ICE_SERVERS = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

function formatDateTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function PatientPortal({ token, patient, onLogout }) {
  const [profile, setProfile] = useState(patient || null);
  const [visits, setVisits] = useState([]);
  const [availabilityStatus, setAvailabilityStatus] = useState(
    patient?.availabilityStatus || "AVAILABLE"
  );
  const [availabilityNote, setAvailabilityNote] = useState(
    patient?.availabilityNote || ""
  );
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState("");
  const [callConnected, setCallConnected] = useState(false);

  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const activeCallVisitIdRef = useRef("");
  const appliedProviderIceCountRef = useRef(0);

  useEffect(() => {
    loadPortalData(false);
    const interval = setInterval(() => {
      loadPortalData(true);
    }, 2500);

    return () => {
      clearInterval(interval);
      cleanupCallResources();
    };
  }, [token]);

  async function loadPortalData(silent = false) {
    try {
      const data = await apiRequest("/api/patient-portal/dashboard", {}, token);
      if (data.patient) {
        setProfile(data.patient);
        if (!silent) {
          setAvailabilityStatus(data.patient.availabilityStatus || "AVAILABLE");
          setAvailabilityNote(data.patient.availabilityNote || "");
        }
      }
      setVisits(data.visits || []);
    } catch (err) {
      if (!silent) setError(err.message);
    }
  }

  const incomingCallVisit =
    visits.find((v) => v.status === "CALL_RINGING" || v.status === "IN_CALL") || null;

  useEffect(() => {
    if (!incomingCallVisit) {
      if (peerRef.current) {
        cleanupCallResources();
        setStatusMessage("Call ended.");
      }
      return;
    }

    if (!peerRef.current) return;

    async function syncProviderIce() {
      const pc = peerRef.current;
      if (!pc) return;
      const candidates = incomingCallVisit.providerIceCandidates || [];
      if (candidates.length > appliedProviderIceCountRef.current) {
        for (let i = appliedProviderIceCountRef.current; i < candidates.length; i += 1) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidates[i]));
          } catch (err) {
            console.error("Error adding provider ICE candidate:", err);
          }
        }
        appliedProviderIceCountRef.current = candidates.length;
      }
    }

    syncProviderIce();
  }, [incomingCallVisit]);

  function cleanupCallResources() {
    if (peerRef.current) {
      peerRef.current.close();
      peerRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    activeCallVisitIdRef.current = "";
    appliedProviderIceCountRef.current = 0;
    setCallConnected(false);
  }

  async function handleUpdateAvailability(e) {
    e.preventDefault();
    setError("");
    setStatusMessage("");
    try {
      const data = await apiRequest(
        "/api/patient-portal/availability",
        {
          method: "POST",
          body: JSON.stringify({ availabilityStatus, availabilityNote }),
        },
        token
      );
      if (data.patient) setProfile(data.patient);
      setStatusMessage("Call availability status updated for your doctor.");
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleAcceptCall(visit) {
    setError("");
    setStatusMessage("Connecting microphone and answering doctor's call...");
    try {
      cleanupCallResources();
      const localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = localStream;
      activeCallVisitIdRef.current = visit._id;

      const pc = new RTCPeerConnection(ICE_SERVERS);
      peerRef.current = pc;

      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });

      pc.ontrack = (event) => {
        const [stream] = event.streams;
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = stream;
          remoteAudioRef.current.play().catch(() => {});
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          apiRequest(
            `/api/patient-portal/visits/${visit._id}/call/ice`,
            {
              method: "POST",
              body: JSON.stringify({ candidate: event.candidate.toJSON() }),
            },
            token
          ).catch(() => {});
        }
      };

      await pc.setRemoteDescription(new RTCSessionDescription(visit.webrtcOffer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      await apiRequest(
        `/api/patient-portal/visits/${visit._id}/call/answer`,
        {
          method: "POST",
          body: JSON.stringify({ answer: pc.localDescription }),
        },
        token
      );

      setCallConnected(true);
      setStatusMessage("Connected! Recording consent granted for this consultation.");
      await loadPortalData(true);
    } catch (err) {
      cleanupCallResources();
      setError("Could not answer call: " + err.message);
    }
  }

  async function handleHangupCall(visit) {
    setError("");
    try {
      cleanupCallResources();
      await apiRequest(
        `/api/patient-portal/visits/${visit._id}/call/hangup`,
        { method: "POST" },
        token
      );
      setStatusMessage("You ended the call.");
      await loadPortalData(true);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleWithdrawConsent(visit) {
    const confirmed = window.confirm(
      "Withdraw recording consent? This will permanently delete the transcript and clinical notes for this visit."
    );
    if (!confirmed) return;

    setError("");
    try {
      cleanupCallResources();
      await apiRequest(
        `/api/patient-portal/visits/${visit._id}/consent/withdraw`,
        { method: "POST" },
        token
      );
      setStatusMessage("Consent withdrawn and visit data permanently deleted.");
      await loadPortalData(true);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="app-shell">
      <audio ref={remoteAudioRef} autoPlay playsInline style={{ display: "none" }} />

      <header className="topbar">
        <div className="brand-area">
          <strong>Patient Health Portal</strong>
          <span className="pill pill-blue">{profile?.patientCode || profile?.mrn || "Patient"}</span>
        </div>

        <div className="user-area">
          <span>{profile?.name}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onLogout}>
            Sign Out
          </button>
        </div>
      </header>

      <main className="main-container">
        {error && <div className="alert alert-error">{error}</div>}
        {statusMessage && <div className="alert alert-info">{statusMessage}</div>}

        {incomingCallVisit && (
          <div
            className="card"
            style={{
              border: "2px solid #2563eb",
              background: "#eff6ff",
              marginBottom: "1.25rem",
            }}
          >
            <div className="header-split">
              <div>
                <h2 style={{ margin: 0, color: "#1e3a8a" }}>
                  {incomingCallVisit.status === "CALL_RINGING"
                    ? "Incoming Consultation Call from Your Doctor"
                    : "Live Consultation Call in Progress"}
                </h2>
                <p className="muted" style={{ marginTop: "0.3rem" }}>
                  {incomingCallVisit.visitType} • Started:{" "}
                  {formatDateTime(incomingCallVisit.callStartedAt || incomingCallVisit.createdAt)}
                </p>
                <p style={{ fontSize: "0.88rem", marginTop: "0.4rem" }}>
                  Answering this call grants consent for real-time transcription. Raw audio is deleted immediately after note generation.
                </p>
              </div>
              <div className="consent-actions">
                {incomingCallVisit.status === "CALL_RINGING" ? (
                  <button
                    type="button"
                    className="btn btn-success"
                    onClick={() => handleAcceptCall(incomingCallVisit)}
                  >
                    Accept &amp; Grant Consent
                  </button>
                ) : (
                  <span className="pill pill-green">
                    {callConnected ? "Live Audio Connected" : "In Call"}
                  </span>
                )}
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => handleHangupCall(incomingCallVisit)}
                >
                  End Call
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="workspace-grid">
          <aside className="sidebar-panel">
            <div className="card">
              <h3>Your Call Availability</h3>
              <form onSubmit={handleUpdateAvailability} className="form-stack">
                <label>
                  Current Status
                  <select
                    value={availabilityStatus}
                    onChange={(e) => setAvailabilityStatus(e.target.value)}
                  >
                    <option value="AVAILABLE">Available Now</option>
                    <option value="BUSY">Busy — Call Later</option>
                    <option value="REQUEST_CALLBACK">Requesting Callback</option>
                  </select>
                </label>

                <label>
                  Optional Note to Doctor
                  <input
                    type="text"
                    placeholder="e.g., Free after 4:00 PM"
                    value={availabilityNote}
                    onChange={(e) => setAvailabilityNote(e.target.value)}
                  />
                </label>

                <button type="submit" className="btn btn-primary">
                  Update Availability
                </button>
              </form>
            </div>
          </aside>

          <section className="main-panel">
            <div className="card">
              <h2>Your Consultation Summaries ({visits.length})</h2>
              {visits.length === 0 ? (
                <p className="muted">No consultation records yet.</p>
              ) : (
                <div className="form-stack">
                  {visits.map((v) => (
                    <div
                      key={v._id}
                      style={{
                        border: "1px solid #e2e8f0",
                        borderRadius: "8px",
                        padding: "1rem",
                        background: "#ffffff",
                      }}
                    >
                      <div className="header-split">
                        <div>
                          <strong>{v.visitType}</strong>
                          <div className="muted" style={{ fontSize: "0.85rem" }}>
                            Date &amp; Time: {formatDateTime(v.createdAt)}
                          </div>
                        </div>
                        <span className={`status-tag status-${v.status.toLowerCase()}`}>
                          {v.status.replace(/_/g, " ")}
                        </span>
                      </div>

                      {v.status === "APPROVED" && v.patientSummary ? (
                        <div style={{ marginTop: "0.75rem" }}>
                          <p style={{ marginBottom: "0.5rem" }}>
                            <strong>Doctor&apos;s Summary:</strong> {v.patientSummary}
                          </p>
                          {v.nextAppointment && (
                            <p style={{ marginBottom: "0.5rem" }}>
                              <strong>Next Follow-Up:</strong> {v.nextAppointment}
                            </p>
                          )}
                          <span className="muted" style={{ fontSize: "0.8rem" }}>
                            Signed &amp; Approved: {formatDateTime(v.updatedAt)}
                          </span>
                        </div>
                      ) : (
                        <p className="muted" style={{ marginTop: "0.6rem", fontSize: "0.9rem" }}>
                          Your clinician is still reviewing and finalizing the summary for this visit.
                        </p>
                      )}

                      {v.consentStatus === "GRANTED" && (
                        <div style={{ marginTop: "0.75rem" }}>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={() => handleWithdrawConsent(v)}
                          >
                            Withdraw Consent &amp; Delete Visit Data
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}