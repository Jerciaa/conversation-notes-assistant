import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { Visit } from "../models/Visit.js";
import { Patient } from "../models/Patient.js";
import { AuditLog } from "../models/AuditLog.js";

const router = express.Router();

router.use(requireAuth);

router.get("/metrics", async (req, res) => {
  try {
    const providerVisits = await Visit.find({ providerId: req.providerId });
    const totalVisits = providerVisits.length;
    const approvedCount = providerVisits.filter((v) => v.status === "APPROVED").length;
    const editedCount = providerVisits.filter((v) => v.providerEdited).length;

    const timedVisits = providerVisits.filter((v) => v.generationTimeMs > 0);
    const avgLatencyMs =
      timedVisits.length > 0
        ? timedVisits.reduce((sum, v) => sum + v.generationTimeMs, 0) / timedVisits.length
        : 0;

    const withdrawnPurges = await AuditLog.countDocuments({
      providerId: req.providerId,
      action: "CONSENT_WITHDRAWN_PURGED",
    });

    res.json({
      metrics: {
        totalVisits,
        approvedCount,
        avgLatencySeconds: (avgLatencyMs / 1000).toFixed(1),
        editRatePercent: totalVisits > 0 ? Math.round((editedCount / totalVisits) * 100) : 0,
        withdrawnPurges,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/audit-logs", async (req, res) => {
  try {
    const { action, q } = req.query;
    const filter = { providerId: req.providerId };

    if (action) {
      filter.action = action;
    }

    if (q && q.trim()) {
      const escaped = q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "i");

      const matchingPatients = await Patient.find({
        $or: [{ patientCode: regex }, { name: regex }],
      }).select("_id name patientCode");

      const matchingVisits =
        matchingPatients.length > 0
          ? await Visit.find({
              providerId: req.providerId,
              patientId: { $in: matchingPatients.map((p) => p._id) },
            }).select("_id")
          : [];

      const visitIds = matchingVisits.map((v) => v._id.toString());
      const patientNames = matchingPatients.map((p) => p.name);

      filter.$or = [
        { patientName: regex },
        { visitId: regex },
        { details: regex },
        { action: regex },
        ...(visitIds.length > 0 ? [{ visitId: { $in: visitIds } }] : []),
        ...(patientNames.length > 0 ? [{ patientName: { $in: patientNames } }] : []),
      ];
    }

    const logs = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(100);
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;