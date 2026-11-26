import express from "express";
import { requirePatient } from "../middleware/auth.js";
import { Patient } from "../models/Patient.js";
import { Visit } from "../models/Visit.js";
import { AuditLog } from "../models/AuditLog.js";

const router = express.Router();

router.use(requirePatient);

router.get("/dashboard", async (req, res) => {
  try {
    const patient = await Patient.findById(req.patientId).select("-passwordHash");
    if (!patient) {
      return res.status(404).json({ error: "Patient profile not found" });
    }

    const visits = await Visit.find({
      patientId: req.patientId,
    })
      .populate("providerId", "name specialty email")
      .sort({ createdAt: -1 });

    const callLogs = visits.map((v) => ({
      id: v._id,
      date: v.createdAt,
      visitType: v.visitType,
      status: v.status,
      consentStatus: v.consentStatus,
      doctorName: v.providerId?.name || "Clinic Provider",
      doctorSpecialty: v.providerId?.specialty || "General Practice",
      webrtcOffer:
        v.status === "CALL_RINGING" || v.status === "IN_CALL" ? v.webrtcOffer : null,
      providerIceCandidates:
        v.status === "CALL_RINGING" || v.status === "IN_CALL"
          ? v.providerIceCandidates || []
          : [],
      summary:
        v.patientSummary ||
        (v.consentStatus === "WITHDRAWN"
          ? "Consent removed — consultation conducted without AI recording or SOAP notes."
          : v.status === "APPROVED"
          ? "Consultation approved by your provider."
          : v.status === "DRAFT_READY"
          ? "Consultation completed. Summary is being reviewed by your provider."
          : v.status === "CALL_RINGING"
          ? "Incoming consultation call from your doctor — answer to begin."
          : v.status === "IN_CALL"
          ? "Live voice consultation call in progress with your doctor."
          : "Consultation scheduled."),
      isSummaryApproved: v.status === "APPROVED",
      nextAppointment: v.nextAppointment || "",
    }));

    const appointments = callLogs
      .filter(
        (item) =>
          item.nextAppointment &&
          item.nextAppointment !== "No follow-up appointment scheduled yet"
      )
      .map((item) => ({
        id: item.id,
        doctorName: item.doctorName,
        doctorSpecialty: item.doctorSpecialty,
        visitType: item.visitType,
        appointmentDetails: item.nextAppointment,
        recordedOn: item.date,
      }));

    res.json({
      patient,
      callLogs,
      appointments,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/availability", async (req, res) => {
  try {
    const { availabilityStatus, availabilityNote } = req.body;
    const patient = await Patient.findByIdAndUpdate(
      req.patientId,
      {
        availabilityStatus: availabilityStatus || "AVAILABLE_NOW",
        availabilityNote: (availabilityNote || "").trim(),
        availabilityUpdatedAt: new Date(),
      },
      { new: true }
    ).select("-passwordHash");

    if (!patient) {
      return res.status(404).json({ error: "Patient not found" });
    }

    res.json({ patient });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/visits/:id/answer", async (req, res) => {
  try {
    const { answer } = req.body;
    const visit = await Visit.findOne({
      _id: req.params.id,
      patientId: req.patientId,
    }).populate("patientId", "-passwordHash");

    if (!visit) {
      return res.status(404).json({ error: "Consultation not found" });
    }

    if (visit.consentStatus !== "WITHDRAWN") {
      visit.consentStatus = "GRANTED";
      visit.consentGrantedAt = new Date();
    }
    visit.status = "IN_CALL";
    if (answer) {
      visit.webrtcAnswer = answer;
    }
    await visit.save();

    const patientLabel = `${visit.patientId.name} (${visit.patientId.patientCode})`;
    await AuditLog.create({
      providerId: visit.providerId,
      visitId: visit._id.toString(),
      patientName: patientLabel,
      action: visit.consentStatus === "GRANTED" ? "CONSENT_GRANTED" : "CALL_ANSWERED",
      details: `Patient ${patientLabel} answered live voice call`,
    });

    res.json({ answered: true, visitId: visit._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/visits/:id/call/ice", async (req, res) => {
  try {
    const { candidate } = req.body;
    if (!candidate) {
      return res.status(400).json({ error: "ICE candidate required" });
    }

    const visit = await Visit.findOneAndUpdate(
      { _id: req.params.id, patientId: req.patientId },
      { $push: { patientIceCandidates: candidate } },
      { new: true }
    );

    if (!visit) {
      return res.status(404).json({ error: "Consultation not found" });
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/visits/:id/decline", async (req, res) => {
  try {
    const visit = await Visit.findOne({
      _id: req.params.id,
      patientId: req.patientId,
    }).populate("patientId", "-passwordHash");

    if (!visit) {
      return res.status(404).json({ error: "Consultation not found" });
    }

    visit.status = "CONSENT_REQUIRED";
    visit.webrtcOffer = null;
    visit.webrtcAnswer = null;
    visit.providerIceCandidates = [];
    visit.patientIceCandidates = [];
    await visit.save();

    const patientLabel = `${visit.patientId.name} (${visit.patientId.patientCode})`;
    await AuditLog.create({
      providerId: visit.providerId,
      visitId: visit._id.toString(),
      patientName: patientLabel,
      action: "CALL_DECLINED",
      details: `Patient ${patientLabel} declined the incoming call without withdrawing consent`,
    });

    res.json({ declined: true, visitId: visit._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/visits/:id/hangup", async (req, res) => {
  try {
    const visit = await Visit.findOne({
      _id: req.params.id,
      patientId: req.patientId,
    });

    if (!visit) {
      return res.status(404).json({ error: "Consultation not found" });
    }

    const preservedStatuses = ["APPROVED", "REJECTED", "DRAFT_READY"];
    visit.status = preservedStatuses.includes(visit.status)
      ? visit.status
      : visit.consentStatus === "GRANTED"
      ? "READY_TO_RECORD"
      : "CONSENT_REQUIRED";
    visit.webrtcOffer = null;
    visit.webrtcAnswer = null;
    visit.providerIceCandidates = [];
    visit.patientIceCandidates = [];
    await visit.save();

    res.json({ hungUp: true, visitId: visit._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/visits/:id/consent/withdraw", async (req, res) => {
  try {
    const existing = await Visit.findOne({
      _id: req.params.id,
      patientId: req.patientId,
    }).populate("patientId");

    if (!existing) {
      return res.status(404).json({ error: "Consultation not found" });
    }

    const visitIdStr = existing._id.toString();
    const providerId = existing.providerId;
    const patientLabel = existing.patientId
      ? `${existing.patientId.name} (${existing.patientId.patientCode})`
      : "Unknown Patient";

    // Keep live call (IN_CALL / CALL_RINGING) and visit history intact; purge AI/SOAP fields only
    const nextStatus =
      existing.status === "IN_CALL" || existing.status === "CALL_RINGING"
        ? existing.status
        : "CONSENT_REQUIRED";

    await Visit.findOneAndUpdate(
      { _id: existing._id, patientId: req.patientId },
      {
        $set: {
          consentStatus: "WITHDRAWN",
          status: nextStatus,
          patientSummary: "Consent removed — consultation conducted without AI recording or SOAP notes.",
        },
        $unset: {
          transcript: 1,
          soapDraft: 1,
          soapFinal: 1,
        },
      }
    );

    await AuditLog.create({
      providerId,
      visitId: visitIdStr,
      patientName: patientLabel,
      action: "CONSENT_WITHDRAWN_PURGED",
      details: `Patient ${patientLabel} removed consent; AI recording/SOAP data purged while call & history preserved`,
    });

    res.json({ purged: true, visitId: visitIdStr });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;