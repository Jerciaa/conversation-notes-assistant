import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Provider } from "../models/Provider.js";
import { AuditLog } from "../models/AuditLog.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();


router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const provider = await Provider.findOne({ email: email.toLowerCase().trim() });
    if (!provider) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const validPassword = await bcrypt.compare(password, provider.passwordHash);
    if (!validPassword) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { providerId: provider._id.toString(), email: provider.email, name: provider.name },
      process.env.JWT_SECRET,
      { expiresIn: "12h" }
    );

    // R8: Record clinician login in audit trail
    await AuditLog.create({
      providerId: provider._id,
      action: "LOGIN",
      details: `Provider ${provider.name} signed in`,
    });

    res.json({
      token,
      provider: {
        id: provider._id,
        name: provider.name,
        email: provider.email,
        specialty: provider.specialty,
      },
    });
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ error: "Server error during login" });
  }
});


router.get("/me", requireAuth, async (req, res) => {
  const provider = await Provider.findById(req.providerId).select("-passwordHash");
  if (!provider) return res.status(404).json({ error: "Provider not found" });
  res.json({ provider });
});

export default router;