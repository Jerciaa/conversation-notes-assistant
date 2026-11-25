import mongoose from "mongoose";

const providerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    specialty: { type: String, default: "Primary Care" },
  },
  { timestamps: true }
);

export const Provider = mongoose.model("Provider", providerSchema);