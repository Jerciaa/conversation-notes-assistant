import mongoose from "mongoose";

const soapSchema = new mongoose.Schema(
  {
    subjective: { type: String, default: "" },
    objective: { type: String, default: "" },
    assessment: { type: String, default: "" },
    plan: { type: String, default: "" },
    verifyFlags: { type: [String], default: [] },
    isFallback: { type: Boolean, default: false },
  },
  { _id: false }
);

const visitSchema = new mongoose.Schema(
  {
    providerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Provider",
      required: true,
      index: true,
    },
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
    },
    visitType: {
      type: String,
      enum: ["Primary Care Follow-up", "Mental Health Check-in"],
      default: "Primary Care Follow-up",
    },
    consentStatus: {
      type: String,
      enum: ["PENDING", "GRANTED", "WITHDRAWN"],
      default: "PENDING",
    },
    consentGrantedAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ["CONSENT_REQUIRED", "READY_TO_RECORD", "DRAFT_READY", "APPROVED", "REJECTED"],
      default: "CONSENT_REQUIRED",
    },
    transcript: { type: String, default: "" },
    speakerMapping: {
      Speaker1: { type: String, default: "Provider" },
      Speaker2: { type: String, default: "Patient" },
    },
    soapDraft: { type: soapSchema, default: () => ({}) },
    soapFinal: { type: soapSchema, default: () => ({}) },
    wasEditedByProvider: { type: Boolean, default: false },
    generationTimeMs: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const Visit = mongoose.model("Visit", visitSchema);
export default Visit;