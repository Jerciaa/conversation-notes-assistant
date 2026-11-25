import mongoose from "mongoose";

const patientSchema = new mongoose.Schema(
  {
    patientCode: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    age: { type: Number, required: true },
    gender: { type: String, required: true },
    pastMedicalHistory: [{ type: String }],
    activeMedications: [{ type: String }],
    allergies: [{ type: String }],
    isSynthetic: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Patient = mongoose.model("Patient", patientSchema);