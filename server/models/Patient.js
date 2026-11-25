import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const patientSchema = new mongoose.Schema(
  {
    patientCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    age: {
      type: Number,
    },
    gender: {
      type: String,
    },
    dateOfBirth: {
      type: String,
    },
    email: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
    },
    phone: {
      type: String,
      trim: true,
      default: "",
    },
    availabilityStatus: {
      type: String,
      enum: ["AVAILABLE_NOW", "BUSY", "REQUEST_CALLBACK"],
      default: "AVAILABLE_NOW",
    },
    availabilityNote: {
      type: String,
      trim: true,
      default: "",
    },
    availabilityUpdatedAt: {
      type: Date,
    },
    pastMedicalHistory: {
      type: [String],
      default: [],
    },
    activeMedications: {
      type: [String],
      default: [],
    },
    allergies: {
      type: [String],
      default: [],
    },
    isSynthetic: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

patientSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.passwordHash) return false;
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

export const Patient = mongoose.model("Patient", patientSchema);
export default Patient;