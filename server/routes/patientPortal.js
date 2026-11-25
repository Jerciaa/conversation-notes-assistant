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
      consentStatus: { $ne: "WITHDRAWN" },
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
      summary:
        v.patientSummary ||
        (v.status === "APPROVED" || v.status === "DRAFT_READY"
          ? "Consultation completed. Summary is being prepared by your provider."
          : v.status === "CALL_RINGING"
          ? "Incoming consultation call from your doctor — answer and approve consent to begin."
          : v.status === "IN_CALL"
          ? "Consultation call in progress with your doctor."
          : "Consultation scheduled — awaiting consent or call."),
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
    const visit = await Visit.findOne({
      _id: req.params.id,
      patientId: req.patientId,
    }).populate("patientId", "-passwordHash");

    if (!visit) {
      return res.status(404).json({ error: "Consultation not found" });
    }

    visit.consentStatus = "GRANTED";
    visit.consentGrantedAt = new Date();
    visit.status = "IN_CALL";
    await visit.save();

    const patientLabel = `${visit.patientId.name} (${visit.patientId.patientCode})`;
    await AuditLog.create({
      providerId: visit.providerId,
      visitId: visit._id.toString(),
      patientName: patientLabel,
      action: "CONSENT_GRANTED",
      details: `Patient ${patientLabel} answered call and approved consent from Patient Portal`,
    });

    res.json({ answered: true, visitId: visit._id });
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

router.post("/visits/:id/consent/withdraw", async (req, res) => {
  try {
    const visit = await Visit.findOne({
      _id: req.params.id,
      patientId: req.patientId,
    }).populate("patientId");

    if (!visit) {
      return res.status(404).json({ error: "Consultation not found" });
    }

    const visitIdStr = visit._id.toString();
    const providerId = visit.providerId;
    const patientLabel = visit.patientId
      ? `${visit.patientId.name} (${visit.patientId.patientCode})`
      : "Unknown Patient";

    await Visit.deleteOne({ _id: visit._id, patientId: req.patientId });
    await AuditLog.deleteMany({ visitId: visitIdStr, providerId });

    await AuditLog.create({
      providerId,
      visitId: visitIdStr,
      patientName: patientLabel,
      action: "CONSENT_WITHDRAWN_PURGED",
      details: `Patient ${patientLabel} withdrew consent from Patient Portal; data purged`,
    });

    res.json({ purged: true, visitId: visitIdStr });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;