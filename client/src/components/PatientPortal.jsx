import { useEffect, useState, useRef } from "react";
import { apiRequest } from "../api";

const ICE_SERVERS = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export default function PatientPortal({ token, patient, onLogout }) {
  const [data, setData] = useState({ patient: patient || {}, callLogs: [], appointments: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [callConnected, setCallConnected] = useState(false);

  const [availabilityStatus, setAvailabilityStatus] = useState(
    patient?.availabilityStatus || "AVAILABLE_NOW"
  );
  const [availabilityNote, setAvailabilityNote] = useState(
    patient?.availabilityNote || ""
  );
  const [savingAvailability, setSavingAvailability] = useState(false);

  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const appliedProviderIceCountRef = useRef(0);

  async function loadPortal(silent = false) {
    if (!silent) setLoading(true);
    try {
      const res = await apiRequest("/api/patient-portal/dashboard", {}, token);
      setData(res);
      if (!silent && res.patient) {
        setAvailabilityStatus(res.patient.availabilityStatus || "AVAILABLE_NOW");
        setAvailabilityNote(res.patient.availabilityNote || "");
      }
      setError("");
    } catch (err) {
      if (!silent) setError(err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  function cleanupCallResources() {
    if (peerRef.current) {
      peerRef.current.close();
      peerRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    appliedProviderIceCountRef.current = 0;
    setCallConnected(false);
  }

  useEffect(() => {
    loadPortal(false);
    const interval = setInterval(() => {
      loadPortal(true);
    }, 2500);
    return () => {
      clearInterval(interval);
      cleanupCallResources();
    };
  }, [token]);

  const profile = data.patient || patient || {};
  const incomingCalls = data.callLogs.filter(
    (log) => log.status === "CALL_RINGING" || (log.status === "CONSENT_REQUIRED" && log.consentStatus === "PENDING")
  );
  const activeCalls = data.callLogs.filter((log) => log.status === "IN_CALL");
  const currentActiveCall = activeCalls[0] || null;

  useEffect(() => {
    if (!currentActiveCall) {
      if (peerRef.current) cleanupCallResources();
      return;
    }

    async function syncProviderIce() {
      const pc = peerRef.current;
      if (!pc) return;
      const candidates = currentActiveCall.providerIceCandidates || [];
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
  }, [currentActiveCall]);

  async function handleSendAvailability(e) {
    e.preventDefault();
    setSavingAvailability(true);
    setError("");
    setStatusMessage("");
    try {
      const res = await apiRequest(
        "/api/patient-portal/availability",
        {
          method: "POST",
          body: JSON.stringify({ availabilityStatus, availabilityNote }),
        },
        token
      );
      setData((prev) => ({ ...prev, patient: res.patient }));
      setStatusMessage("Call availability sent to your consultant.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingAvailability(false);
    }
  }

  async function handleAnswerCall(call) {
    setError("");
    setStatusMessage("Connecting live audio and approving consent...");
    try {
      cleanupCallResources();
      let answerPayload = null;

      if (call.webrtcOffer) {
        const localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStreamRef.current = localStream;

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
          setCallConnected(true);
        };

        pc.onicecandidate = (event) => {
          if (event.candidate) {
            apiRequest(
              `/api/patient-portal/visits/${call.id}/call/ice`,
              {
                method: "POST",
                body: JSON.stringify({ candidate: event.candidate.toJSON() }),
              },
              token
            ).catch(() => {});
          }
        };

        await pc.setRemoteDescription(new RTCSessionDescription(call.webrtcOffer));

        const initialCandidates = call.providerIceCandidates || [];
        for (let i = 0; i < initialCandidates.length; i += 1) {
          await pc.addIceCandidate(new RTCIceCandidate(initialCandidates[i])).catch(() => {});
        }
        appliedProviderIceCountRef.current = initialCandidates.length;

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        answerPayload = pc.localDescription;
        setCallConnected(true);
      }

      await apiRequest(
        `/api/patient-portal/visits/${call.id}/answer`,
        {
          method: "POST",
          body: JSON.stringify({ answer: answerPayload }),
        },
        token
      );
      setStatusMessage("Live voice call connected and consent approved. Speak naturally with your consultant.");
      await loadPortal(true);
    } catch (err) {
      cleanupCallResources();
      setError("Could not answer call: " + err.message);
    }
  }

  async function handleDeclineCall(visitId) {
    setError("");
    setStatusMessage("");
    try {
      cleanupCallResources();
      await apiRequest(`/api/patient-portal/visits/${visitId}/decline`, { method: "POST" }, token);
      setStatusMessage("Incoming call declined. Your consultation remains scheduled.");
      await loadPortal(true);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleHangUpCall(visitId) {
    setError("");
    setStatusMessage("");
    try {
      cleanupCallResources();
      await apiRequest(`/api/patient-portal/visits/${visitId}/hangup`, { method: "POST" }, token);
      setStatusMessage("Call cut. Your consent remains active.");
      await loadPortal(true);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleWithdrawConsent(visitId) {
    const confirmed = window.confirm(
      "Withdraw consent? This will permanently delete and purge this consultation record."
    );
    if (!confirmed) return;

    setError("");
    setStatusMessage("");
    try {
      cleanupCallResources();
      await apiRequest(
        `/api/patient-portal/visits/${visitId}/consent/withdraw`,
        { method: "POST" },
        token
      );
      setStatusMessage("Consent withdrawn and consultation data permanently purged.");
      await loadPortal(true);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="app-shell">
      <audio ref={remoteAudioRef} autoPlay playsInline style={{ display: "none" }} />

      <header className="topbar">
        <div className="brand-area">
          <strong>Patient Care Portal</strong>
          <span className="pill pill-blue">{profile.patientCode || "Patient"}</span>
        </div>

        <div className="user-area">
          <span>
            {profile.name} ({profile.email})
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => loadPortal(false)}>
            Refresh
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onLogout}>
            Sign Out
          </button>
        </div>
      </header>

      <main className="main-container">
        {error && <div className="alert alert-error">{error}</div>}
        {statusMessage && <div className="alert alert-info">{statusMessage}</div>}

        {incomingCalls.map((call) => (
          <section
            key={call.id}
            className="card"
            style={{
              border: "2px solid #2563eb",
              background: "#eff6ff",
              marginBottom: "1.25rem",
            }}
          >
            <div className="badge-row" style={{ marginBottom: "0.5rem" }}>
              <span className="pill pill-blue">
                {call.status === "CALL_RINGING" ? "Incoming Live Voice Call" : "Consent Requested"}
              </span>
            </div>
            <h2 style={{ marginTop: 0 }}>
              {call.doctorName} ({call.doctorSpecialty}) is calling for your {call.visitType}
            </h2>
            <p style={{ marginBottom: "1rem" }}>
              Answering connects your microphone and speaker for a live consultation call and grants explicit consent for in-memory clinical transcription (zero raw audio is stored).
            </p>
            <div className="consent-actions">
              <button
                type="button"
                className="btn btn-success"
                onClick={() => handleAnswerCall(call)}
              >
                Answer Call &amp; Approve Consent
              </button>
              {call.status === "CALL_RINGING" && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => handleDeclineCall(call.id)}
                >
                  Decline Call
                </button>
              )}
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => handleWithdrawConsent(call.id)}
              >
                Withdraw Consent &amp; Purge
              </button>
            </div>
          </section>
        ))}

        {activeCalls.map((call) => (
          <section
            key={call.id}
            className="card"
            style={{
              border: "2px solid #16a34a",
              background: "#f0fdf4",
              marginBottom: "1.25rem",
            }}
          >
            <div className="header-split">
              <div>
                <span className="pill pill-green">
                  {callConnected
                    ? "Connected — Live Two-Way Audio Active"
                    : "In Call — Consent Active"}
                </span>
                <h2 style={{ marginTop: "0.5rem", marginBottom: "0.25rem" }}>
                  Speaking with {call.doctorName} ({call.doctorSpecialty})
                </h2>
                <p className="subtitle" style={{ marginBottom: 0 }}>
                  Your microphone is live and you can hear your consultant directly through your speakers.
                </p>
              </div>
              <div className="consent-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => handleHangUpCall(call.id)}
                >
                  Cut Call (Keep Consent)
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => handleWithdrawConsent(call.id)}
                >
                  Withdraw Consent &amp; Purge
                </button>
              </div>
            </div>
          </section>
        ))}

        {loading ? (
          <div className="card">Loading your care summary and appointments...</div>
        ) : (
          <div style={{ display: "grid", gap: "1.25rem" }}>
            <section className="card">
              <div className="badge-row" style={{ marginBottom: "0.5rem" }}>
                <span className="pill pill-blue">Call Availability &amp; Messaging</span>
              </div>
              <h2 style={{ marginTop: 0 }}>Notify Consultant of Your Call Availability</h2>
              <form onSubmit={handleSendAvailability} className="form-stack">
                <label>
                  Current Call Status
                  <select
                    value={availabilityStatus}
                    onChange={(e) => setAvailabilityStatus(e.target.value)}
                  >
                    <option value="AVAILABLE_NOW">Available Now for Call</option>
                    <option value="BUSY">Currently Busy (Call Later)</option>
                    <option value="REQUEST_CALLBACK">Requesting Callback</option>
                  </select>
                </label>
                <label>
                  Message for Consultant
                  <input
                    type="text"
                    placeholder="e.g., Ready to pick up your call now, or free after 4:00 PM"
                    value={availabilityNote}
                    onChange={(e) => setAvailabilityNote(e.target.value)}
                  />
                </label>
                <button type="submit" className="btn btn-primary" disabled={savingAvailability}>
                  {savingAvailability ? "Sending..." : "Send Availability to Consultant"}
                </button>
              </form>
            </section>

            <section className="card">
              <div className="badge-row" style={{ marginBottom: "0.5rem" }}>
                <span className="pill pill-green">Upcoming Appointments</span>
              </div>
              <h2 style={{ marginTop: 0 }}>Follow-Up Schedule</h2>
              {data.appointments.length === 0 ? (
                <p className="subtitle" style={{ marginBottom: 0 }}>
                  No upcoming follow-up appointments scheduled yet.
                </p>
              ) : (
                <div style={{ display: "grid", gap: "0.75rem" }}>
                  {data.appointments.map((appt) => (
                    <div
                      key={appt.id}
                      style={{
                        padding: "0.85rem 1rem",
                        border: "1px solid #d0d7de",
                        borderRadius: "8px",
                        background: "#f8fafc",
                      }}
                    >
                      <strong>{appt.appointmentDetails}</strong>
                      <div className="subtitle" style={{ marginTop: "0.25rem", marginBottom: 0 }}>
                        With {appt.doctorName} ({appt.doctorSpecialty}) &bull; {appt.visitType}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="card">
              <div className="badge-row" style={{ marginBottom: "0.5rem" }}>
                <span className="pill pill-blue">Consultation Call Logs &amp; Summaries</span>
              </div>
              <h2 style={{ marginTop: 0 }}>Your Visit History</h2>
              {data.callLogs.length === 0 ? (
                <p className="subtitle" style={{ marginBottom: 0 }}>
                  No consultation records found for your account yet.
                </p>
              ) : (
                <div style={{ display: "grid", gap: "1rem" }}>
                  {data.callLogs.map((log) => (
                    <div
                      key={log.id}
                      style={{
                        padding: "1rem",
                        border: "1px solid #d0d7de",
                        borderRadius: "8px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          flexWrap: "wrap",
                          gap: "0.5rem",
                          marginBottom: "0.5rem",
                        }}
                      >
                        <div>
                          <strong>{log.visitType}</strong> &mdash; {log.doctorName} ({log.doctorSpecialty})
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <span className="pill pill-green">
                            {new Date(log.date).toLocaleDateString()}
                          </span>
                          {log.isSummaryApproved && (
                            <span className="pill pill-blue">Approved by Provider</span>
                          )}
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={() => handleWithdrawConsent(log.id)}
                          >
                            Withdraw Consent
                          </button>
                        </div>
                      </div>

                      <div
                        style={{
                          marginTop: "0.5rem",
                          padding: "0.75rem",
                          borderRadius: "6px",
                          background: "#f8fafc",
                          border: "1px solid #e2e8f0",
                        }}
                      >
                        <strong>After-Visit Short Summary:</strong>
                        <p style={{ marginTop: "0.35rem", marginBottom: 0, lineHeight: 1.5 }}>
                          {log.summary}
                        </p>
                      </div>

                      {log.nextAppointment && (
                        <div className="subtitle" style={{ marginTop: "0.5rem", marginBottom: 0 }}>
                          <strong>Next Step / Follow-Up:</strong> {log.nextAppointment}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}