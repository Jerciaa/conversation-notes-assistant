import mongoose from "mongoose";

const visitSchema = new mongoose.Schema(
  {
    providerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Provider",
      required: true,
    },
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
    },
    visitType: {
      type: String,
      default: "Primary Care Follow-up",
    },
    consentStatus: {
      type: String,
      enum: ["PENDING", "GRANTED", "WITHDRAWN"],
      default: "PENDING",
    },
    consentGrantedAt: {
      type: Date,
    },
    status: {
      type: String,
      enum: [
        "CONSENT_REQUIRED",
        "CALL_RINGING",
        "IN_CALL",
        "READY_TO_RECORD",
        "DRAFT_READY",
        "APPROVED",
      ],
      default: "CONSENT_REQUIRED",
    },
    callStartedAt: {
      type: Date,
    },
    transcript: {
      type: String,
      default: "",
    },
    speakerMapping: {
      type: mongoose.Schema.Types.Mixed,
      default: { Speaker1: "Provider", Speaker2: "Patient" },
    },
    soapDraft: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    soapFinal: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    patientSummary: {
      type: String,
      default: "",
    },
    nextAppointment: {
      type: String,
      default: "",
    },
    generationTimeMs: {
      type: Number,
    },
    wasEditedByProvider: {
      type: Boolean,
      default: false,
    },
    providerEdited: {
      type: Boolean,
      default: false,
    },
    aiFallbackUsed: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

export const Visit = mongoose.model("Visit", visitSchema);
export default Visit;