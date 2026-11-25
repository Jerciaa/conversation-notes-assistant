import express from "express";
import multer from "multer";
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


router.get("/patients", async (req, res) => {
  try {
    const patients = await Patient.find({}).sort({ patientCode: 1 });
    res.json({ patients });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


router.get("/", async (req, res) => {
  try {
    const visits = await Visit.find({ providerId: req.providerId })
      .populate("patientId")
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

    const populated = await Visit.findById(visit._id).populate("patientId");
    res.status(201).json({ visit: populated });
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
        status: "READY_TO_RECORD",
      },
      { new: true }
    ).populate("patientId");

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

    let transcript = req.body.manualTranscript?.trim() || "";
    if (!transcript && req.file) {
      transcript = await transcribeAudioBuffer(
        req.file.buffer,
        req.file.mimetype
      );
    }
    if (!transcript) {
      return res
        .status(400)
        .json({ error: "No audio file or transcript provided." });
    }

    const generated = await generateGroundedSoapNote({
      transcript,
      patient: visit.patientId,
      visitType: visit.visitType,
    });

    const generationTimeMs = Date.now() - startTime;
    const soapPayload = generated.soapNote || generated;

    visit.transcript = transcript;
    visit.soapDraft = soapPayload;
    visit.soapFinal = soapPayload;
    visit.generationTimeMs = generationTimeMs;
    visit.status = "DRAFT_READY";
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


router.patch("/:id/review", async (req, res) => {
  try {
    const { soapNote, soapFinal, approve } = req.body;
    const updatedFields = soapFinal || soapNote;

    const visit = await Visit.findOne({
      _id: req.params.id,
      providerId: req.providerId,
    }).populate("patientId");

    if (!visit) {
      return res.status(404).json({ error: "Visit not found" });
    }

    if (updatedFields) {
      visit.soapFinal = { ...visit.soapFinal.toObject(), ...updatedFields };
      visit.wasEditedByProvider = true;
    }
    if (approve) {
      visit.status = "APPROVED";
    }

    await visit.save();

    const patientLabel = `${visit.patientId.name} (${visit.patientId.patientCode})`;
    await AuditLog.create({
      providerId: req.providerId,
      visitId: visit._id.toString(),
      patientName: patientLabel,
      action: approve ? "SOAP_APPROVED" : "SOAP_EDITED",
      details: approve
        ? `Provider approved SOAP note for ${patientLabel}`
        : `Provider edited SOAP draft for ${patientLabel}`,
    });

    res.json({ visit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;