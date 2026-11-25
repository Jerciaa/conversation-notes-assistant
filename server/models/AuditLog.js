import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    providerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Provider",
      required: true,
      index: true,
    },
    visitId: { type: String, index: true },
    patientName: { type: String },
    action: {
      type: String,
      enum: [
        "LOGIN",
        "CONSENT_GRANTED",
        "CONSENT_WITHDRAWN_PURGED",
        "TRANSCRIPT_GENERATED",
        "SOAP_DRAFT_GENERATED",
        "SOAP_VIEWED",
        "SOAP_EDITED",
        "SOAP_APPROVED",
        "SOAP_REJECTED",
        "AI_FALLBACK_TRIGGERED",
      ],
      required: true,
      index: true,
    },
    details: { type: String, default: "" },
  },
  { timestamps: true }
);

auditLogSchema.index({ action: "text", details: "text", patientName: "text" });

export const AuditLog = mongoose.model("AuditLog", auditLogSchema);