import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Provider } from "../models/Provider.js";
import { Patient } from "../models/Patient.js";
import { AuditLog } from "../models/AuditLog.js";
import { requireAuth, requirePatient } from "../middleware/auth.js";

const router = express.Router();

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const provider = await Provider.findOne({ email: normalizedEmail });
    if (provider) {
      const validPassword = await bcrypt.compare(password, provider.passwordHash);
      if (!validPassword) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const token = jwt.sign(
        {
          role: "provider",
          providerId: provider._id.toString(),
          email: provider.email,
          name: provider.name,
        },
        process.env.JWT_SECRET,
        { expiresIn: "12h" }
      );

      await AuditLog.create({
        providerId: provider._id,
        action: "LOGIN",
        details: `Provider ${provider.name} signed in`,
      });

      return res.json({
        role: "provider",
        token,
        provider: {
          id: provider._id,
          name: provider.name,
          email: provider.email,
          specialty: provider.specialty,
        },
      });
    }

    const patient = await Patient.findOne({ email: normalizedEmail });
    if (patient && patient.passwordHash) {
      const validPassword = await bcrypt.compare(password, patient.passwordHash);
      if (!validPassword) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const token = jwt.sign(
        {
          role: "patient",
          patientId: patient._id.toString(),
          email: patient.email,
          name: patient.name,
        },
        process.env.JWT_SECRET,
        { expiresIn: "12h" }
      );

      return res.json({
        role: "patient",
        token,
        patient: {
          id: patient._id,
          name: patient.name,
          email: patient.email,
          mrn: patient.mrn,
          dateOfBirth: patient.dateOfBirth,
        },
      });
    }

    return res.status(401).json({ error: "Invalid credentials" });
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ error: "Server error during login" });
  }
});

router.get("/me", requireAuth, async (req, res) => {
  const provider = await Provider.findById(req.providerId).select("-passwordHash");
  if (!provider) return res.status(404).json({ error: "Provider not found" });
  res.json({ role: "provider", provider });
});

router.get("/patient/me", requirePatient, async (req, res) => {
  const patient = await Patient.findById(req.patientId).select("-passwordHash");
  if (!patient) return res.status(404).json({ error: "Patient not found" });
  res.json({ role: "patient", patient });
});

export default router;