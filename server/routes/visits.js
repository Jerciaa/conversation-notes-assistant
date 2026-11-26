import express from "express";
import multer from "multer";
import bcrypt from "bcryptjs";
import { requireAuth } from "../middleware/auth.js";
import { Patient } from "../models/Patient.js";
import { Visit } from "../models/Visit.js";
import { AuditLog } from "../models/AuditLog.js";
import {
  transcribeAudioBuffer,
  generateGroundedSoapNote,
} from "../services/aiService.js";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

router.use(requireAuth);

function formatDateTime(value) {
  if (!value) return "N/A";
  return new Date(value).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "medium",
  });
}

function buildPatientSoapArchiveText(patient, approvedVisits) {
  const header = [
    "CONFIDENTIAL PROVIDER-ONLY APPROVED SOAP ARCHIVE",
    `Patient Name: ${patient.name}`,
    `Patient Code: ${patient.patientCode || "N/A"}`,
    `Total Approved Notes: ${approvedVisits.length}`,
    `Archive Generated: ${formatDateTime(new Date())}`,
    "",
  ].join("\n");

  const entries = approvedVisits.map((visit) => {
    const soap = visit.soapFinal || visit.soapDraft || {};

    return [
      "====================================================================",
      `APPROVED SOAP NOTE | Visit ID: ${visit._id.toString()}`,
      `Session Requested: ${formatDateTime(visit.createdAt)}`,
      `Call Started: ${formatDateTime(visit.callStartedAt)}`,
      `Date Approved: ${formatDateTime(visit.updatedAt || visit.createdAt)}`,
      `Patient: ${patient.name} (${patient.patientCode || "N/A"})`,
      `Visit Type: ${visit.visitType}`,
      "--------------------------------------------------------------------",
      `SUBJECTIVE (S):\n${soap.subjective || ""}`,
      "",
      `OBJECTIVE (O):\n${soap.objective || ""}`,
      "",
      `ASSESSMENT (A):\n${soap.assessment || ""}`,
      "",
      `PLAN (P):\n${soap.plan || ""}`,
      "",
      `AFTER-VISIT SUMMARY:\n${visit.patientSummary || ""}`,
      "",
      `NEXT APPOINTMENT:\n${visit.nextAppointment || "No follow-up appointment scheduled yet"}`,
      "====================================================================",
      "",
    ].join("\n");
  });

  return header + entries.join("\n");
}

router.get("/patients", async (req, res) => {
  try {
    const patients = await Patient.find({}).select("-passwordHash").sort({ patientCode: 1 });
    res.json({ patients });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/patients/:patientId/soap-archive", async (req, res) => {
  try {
    const patient = await Patient.findById(req.params.patientId).select("-passwordHash");
    if (!patient) {
      return res.status(404).json({ error: "Patient not found" });
    }

    const approvedVisits = await Visit.find({
      patientId: patient._id,
      status: "APPROVED",
    }).sort({ createdAt: 1 });

    if (approvedVisits.length === 0) {
      return res
        .status(404)
        .json({ error: "No approved SOAP notes found for this patient yet." });
    }

    const safeCode = (patient.patientCode || patient._id.toString())
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .toUpperCase();
    const filename = `${safeCode}_approved_soap_notes.txt`;
    const fileContent = buildPatientSoapArchiveText(patient, approvedVisits);

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(fileContent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/patients", async (req, res) => {
  try {
    const { name, patientCode, age, gender, email, password, phone } = req.body;
    if (!name || !patientCode) {
      return res.status(400).json({ error: "Patient name and code are required" });
    }

    const normalizedCode = patientCode.trim().toUpperCase();
    const existingByCode = await Patient.findOne({ patientCode: normalizedCode });

    const passwordHash = password ? await bcrypt.hash(password, 10) : undefined;
    const normalizedEmail = email ? email.toLowerCase().trim() : undefined;

    if (existingByCode) {
      if (normalizedEmail) existingByCode.email = normalizedEmail;
      if (passwordHash) existingByCode.passwordHash = passwordHash;
      if (phone !== undefined) existingByCode.phone = phone;
      await existingByCode.save();
      const sanitized = existingByCode.toObject();
      delete sanitized.passwordHash;
      return res.json({ patient: sanitized });
    }

    const patient = await Patient.create({
      name: name.trim(),
      patientCode: normalizedCode,
      age: age ? Number(age) : undefined,
      gender: gender || "",
      email: normalizedEmail,
      passwordHash,
      phone: phone || "",
    });

    const sanitized = patient.toObject();
    delete sanitized.passwordHash;
    res.status(201).json({ patient: sanitized });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/", async (req, res) => {
  try {
    const visits = await Visit.find({ providerId: req.providerId })
      .populate("patientId", "-passwordHash")
      .sort({ createdAt: -1 });
    res.json({ visits });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const { patientId, visitType } = req.body;
    const patient = await Patient.findById(patientId);
    if (!patient) {
      return res.status(404).json({ error: "Patient not found" });
    }

    const visit = await Visit.create({
      providerId: req.providerId,
      patientId: patient._id,
      visitType: visitType || "Primary Care Follow-up",
      consentStatus: "PENDING",
      status: "CONSENT_REQUIRED",
    });

    const populated = await Visit.findById(visit._id).populate("patientId", "-passwordHash");
    res.status(201).json({ visit: populated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/call/start", async (req, res) => {
  try {
    const { offer } = req.body;
    const visit = await Visit.findOneAndUpdate(
      { _id: req.params.id, providerId: req.providerId },
      {
        status: "CALL_RINGING",
        callStartedAt: new Date(),
        webrtcOffer: offer || null,
        webrtcAnswer: null,
        providerIceCandidates: [],
        patientIceCandidates: [],
      },
      { new: true }
    ).populate("patientId", "-passwordHash");

    if (!visit) {
      return res.status(404).json({ error: "Visit not found" });
    }

    const patientLabel = `${visit.patientId.name} (${visit.patientId.patientCode})`;
    await AuditLog.create({
      providerId: req.providerId,
      visitId: visit._id.toString(),
      patientName: patientLabel,
      action: "CALL_INITIATED",
      details: `Provider initiated live voice call to ${patientLabel}`,
    });

    res.json({ visit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/call/ice", async (req, res) => {
  try {
    const { candidate } = req.body;
    if (!candidate) {
      return res.status(400).json({ error: "ICE candidate required" });
    }

    const visit = await Visit.findOneAndUpdate(
      { _id: req.params.id, providerId: req.providerId },
      { $push: { providerIceCandidates: candidate } },
      { new: true }
    );

    if (!visit) {
      return res.status(404).json({ error: "Visit not found" });
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/call/hangup", async (req, res) => {
  try {
    const visit = await Visit.findOneAndUpdate(
      { _id: req.params.id, providerId: req.providerId },
      {
        status: "READY_TO_RECORD",
        webrtcOffer: null,
        webrtcAnswer: null,
        providerIceCandidates: [],
        patientIceCandidates: [],
      },
      { new: true }
    ).populate("patientId", "-passwordHash");

    if (!visit) {
      return res.status(404).json({ error: "Visit not found" });
    }

    res.json({ visit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/call/end", async (req, res) => {
  try {
    const visit = await Visit.findOneAndUpdate(
      { _id: req.params.id, providerId: req.providerId },
      {
        webrtcOffer: null,
        webrtcAnswer: null,
        providerIceCandidates: [],
        patientIceCandidates: [],
      },
      { new: true }
    ).populate("patientId", "-passwordHash");

    if (!visit) {
      return res.status(404).json({ error: "Visit not found" });
    }

    res.json({ visit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/consent/grant", async (req, res) => {
  try {
    const visit = await Visit.findOneAndUpdate(
      { _id: req.params.id, providerId: req.providerId },
      {
        consentStatus: "GRANTED",
        consentGrantedAt: new Date(),
        status: "IN_CALL",
      },
      { new: true }
    ).populate("patientId", "-passwordHash");

    if (!visit) {
      return res.status(404).json({ error: "Visit not found" });
    }

    const patientLabel = `${visit.patientId.name} (${visit.patientId.patientCode})`;
    await AuditLog.create({
      providerId: req.providerId,
      visitId: visit._id.toString(),
      patientName: patientLabel,
      action: "CONSENT_GRANTED",
      details: `Explicit patient consent granted for ${visit.visitType}`,
    });

    res.json({ visit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/consent/withdraw", async (req, res) => {
  try {
    const visit = await Visit.findOne({
      _id: req.params.id,
      providerId: req.providerId,
    }).populate("patientId");

    if (!visit) {
      return res.status(404).json({ error: "Visit not found" });
    }

    const visitIdStr = visit._id.toString();
    const patientLabel = visit.patientId
      ? `${visit.patientId.name} (${visit.patientId.patientCode})`
      : "Unknown Patient";

    await Visit.deleteOne({ _id: visit._id, providerId: req.providerId });
    await AuditLog.deleteMany({ visitId: visitIdStr, providerId: req.providerId });

    await AuditLog.create({
      providerId: req.providerId,
      visitId: visitIdStr,
      patientName: patientLabel,
      action: "CONSENT_WITHDRAWN_PURGED",
      details: "Patient withdrew consent; clinical transcript and SOAP draft purged",
    });

    res.json({ purged: true, visitId: visitIdStr });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/process-audio", upload.single("audio"), async (req, res) => {
  const startTime = Date.now();
  try {
    const visit = await Visit.findOne({
      _id: req.params.id,
      providerId: req.providerId,
    }).populate("patientId");

    if (!visit) {
      return res.status(404).json({ error: "Visit not found" });
    }
    if (visit.consentStatus !== "GRANTED") {
      return res.status(403).json({
        error: "Explicit patient consent required before processing audio.",
      });
    }

    const isStereoCall = req.body.isStereoCall === "true";
    let transcript = req.body.manualTranscript?.trim() || "";
    if (!transcript && req.file) {
      transcript = await transcribeAudioBuffer(
        req.file.buffer,
        req.file.mimetype,
        { isStereoCall }
      );
    }
    if (!transcript) {
      return res
        .status(400)
        .json({ error: "No audio file or transcript provided." });
    }

    transcript = transcript
      .replace(/\bSpeaker\s*0\b/gi, "Provider")
      .replace(/\bSpeaker\s*1\b/gi, "Provider")
      .replace(/\bSpeaker\s*2\b/gi, "Patient");

    const generated = await generateGroundedSoapNote({
      transcript,
      patient: visit.patientId,
      visitType: visit.visitType,
    });

    const generationTimeMs = Date.now() - startTime;
    const soapPayload = generated.soapDraft || generated.soapNote || generated;

    visit.transcript = transcript;
    visit.soapDraft = soapPayload;
    visit.soapFinal = soapPayload;
    visit.patientSummary = generated.patientSummary || "";
    visit.nextAppointment = generated.nextAppointment || "";
    visit.generationTimeMs = generationTimeMs;
    visit.status = "DRAFT_READY";
    visit.webrtcOffer = null;
    visit.webrtcAnswer = null;
    visit.providerIceCandidates = [];
    visit.patientIceCandidates = [];
    await visit.save();

    const patientLabel = `${visit.patientId.name} (${visit.patientId.patientCode})`;
    await AuditLog.create({
      providerId: req.providerId,
      visitId: visit._id.toString(),
      patientName: patientLabel,
      action: soapPayload.isFallback
        ? "AI_FALLBACK_TRIGGERED"
        : "SOAP_DRAFT_GENERATED",
      details: `Grounded SOAP draft generated in ${(generationTimeMs / 1000).toFixed(1)}s`,
    });

    res.json({ visit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function handleReview(req, res) {
  try {
    const { soapNote, soapFinal, patientSummary, nextAppointment, approve, decision } = req.body;
    const updatedFields = soapFinal || soapNote;
    const isApproved = approve || decision === "APPROVED";

    const visit = await Visit.findOne({
      _id: req.params.id,
      providerId: req.providerId,
    }).populate("patientId", "-passwordHash");

    if (!visit) {
      return res.status(404).json({ error: "Visit not found" });
    }

    if (updatedFields) {
      const currentFinal =
        typeof visit.soapFinal?.toObject === "function"
          ? visit.soapFinal.toObject()
          : visit.soapFinal || {};
      visit.soapFinal = { ...currentFinal, ...updatedFields };
      visit.wasEditedByProvider = true;
      visit.providerEdited = true;
    }
    if (patientSummary !== undefined) {
      visit.patientSummary = patientSummary;
    }
    if (nextAppointment !== undefined) {
      visit.nextAppointment = nextAppointment;
    }
    if (isApproved) {
      visit.status = "APPROVED";
    }

    await visit.save();

    const patientLabel = `${visit.patientId.name} (${visit.patientId.patientCode})`;
    await AuditLog.create({
      providerId: req.providerId,
      visitId: visit._id.toString(),
      patientName: patientLabel,
      action: isApproved ? "SOAP_APPROVED" : "SOAP_EDITED",
      details: isApproved
        ? `Provider approved SOAP note for ${patientLabel}`
        : `Provider edited SOAP draft for ${patientLabel}`,
    });

    res.json({ visit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

router.post("/:id/review", handleReview);
router.patch("/:id/review", handleReview);

export default router;