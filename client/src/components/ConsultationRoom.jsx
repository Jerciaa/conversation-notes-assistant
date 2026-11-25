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
  const timerRef = useRef(null);
  const fileInputRef = useRef(null);

  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const audioCtxRef = useRef(null);
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

  useEffect(() => {
    if (!activeVisit || !peerRef.current) return;

    async function syncWebRTC() {
      const pc = peerRef.current;
      if (!pc) return;

      if (activeVisit.webrtcAnswer && !answerAppliedRef.current) {
        answerAppliedRef.current = true;
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(activeVisit.webrtcAnswer));
          setCallConnected(true);
          setStatusMessage("Live voice call connected! You can now hear and speak with the patient.");
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
      cleanupCallResources();
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

  async function startMixedCallRecording() {
    setError("");
    try {
      const localStream =
        localStreamRef.current || (await navigator.mediaDevices.getUserMedia({ audio: true }));
      localStreamRef.current = localStream;

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const destination = audioCtx.createMediaStreamDestination();

      const localSource = audioCtx.createMediaStreamSource(localStream);
      localSource.connect(destination);

      if (remoteStreamRef.current && remoteStreamRef.current.getAudioTracks().length > 0) {
        const remoteSource = audioCtx.createMediaStreamSource(remoteStreamRef.current);
        remoteSource.connect(destination);
      }

      const recorder = new MediaRecorder(destination.stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        audioChunksRef.current = [];
        cleanupCallResources();
        if (activeVisit) {
          await apiRequest(`/api/visits/${activeVisit._id}/call/end`, { method: "POST" }, token).catch(
            () => {}
          );
        }
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
    setStatusMessage("Transcribing both voices with speaker diarization and drafting SOAP note...");
    try {
      const formData = new FormData();
      formData.append("audio", blob, filename);