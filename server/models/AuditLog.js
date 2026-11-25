import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    providerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Provider",
      required: true,
    },
    visitId: {
      type: String,
    },
    patientName: {
      type: String,
    },
    action: {
      type: String,
      enum: [
        "LOGIN",
        "CALL_INITIATED",
        "CALL_DECLINED",
        "CONSENT_GRANTED",
        "CONSENT_WITHDRAWN_PURGED",
        "SOAP_DRAFT_GENERATED",
        "SOAP_EDITED",
        "SOAP_APPROVED",
        "AI_FALLBACK_TRIGGERED",
      ],
      required: true,
    },
    details: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

export const AuditLog = mongoose.model("AuditLog", auditLogSchema);
export default AuditLog;