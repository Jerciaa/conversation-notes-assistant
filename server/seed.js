import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { connectDB } from "./config/db.js";
import { Provider } from "./models/Provider.js";
import { Patient } from "./models/Patient.js";
import { Visit } from "./models/Visit.js";
import { AuditLog } from "./models/AuditLog.js";

dotenv.config();

async function seed() {
  await connectDB();

  await Provider.deleteMany({});
  await Patient.deleteMany({});
  await Visit.deleteMany({});
  await AuditLog.deleteMany({});

  const passwordHash = await bcrypt.hash("DemoPass123!", 10);

  const [anjali, vikram] = await Provider.create([
    {
      name: "Dr. Anjali Rao",
      email: "dr.anjali@clinic.demo",
      passwordHash,
      specialty: "Primary Care",
      clinicName: "Metro Outpatient Clinic",
    },
    {
      name: "Dr. Vikram Nair",
      email: "dr.vikram@clinic.demo",
      passwordHash,
      specialty: "Internal Medicine",
      clinicName: "Metro Outpatient Clinic",
    },
  ]);

  const patients = await Patient.create([
    {
      patientCode: "PAT-101",
      name: "Rahul Sharma",
      email: "rahul.sharma@patient.demo",
      passwordHash,
      age: 48,
      gender: "Male",
      pastMedicalHistory: ["Essential Hypertension", "Dyslipidemia"],
      activeMedications: ["Amlodipine 5mg daily", "Atorvastatin 10mg nightly"],
      allergies: ["Penicillin"],
      isSynthetic: true,
    },
    {
      patientCode: "PAT-102",
      name: "Meera Krishnan",
      email: "meera.krishnan@patient.demo",
      passwordHash,
      age: 34,
      gender: "Female",
      pastMedicalHistory: ["Generalized Anxiety Disorder"],
      activeMedications: ["Sertraline 50mg daily"],
      allergies: ["NKDA"],
      isSynthetic: true,
    },
    {
      patientCode: "PAT-103",
      name: "Arjun Menon",
      email: "arjun.menon@patient.demo",
      passwordHash,
      age: 56,
      gender: "Male",
      pastMedicalHistory: ["Type 2 Diabetes Mellitus"],
      activeMedications: ["Metformin 500mg twice daily"],
      allergies: ["Sulfa drugs"],
      isSynthetic: true,
    },
    {
      patientCode: "PAT-104",
      name: "Priya Nair",
      email: "priya.nair@patient.demo",
      passwordHash,
      age: 29,
      gender: "Female",
      pastMedicalHistory: ["Mild Intermittent Asthma"],
      activeMedications: ["Albuterol HFA inhaler PRN"],
      allergies: ["Aspirin"],
      isSynthetic: true,
    },
    {
      patientCode: "PAT-105",
      name: "Suresh Iyer",
      email: "suresh.iyer@patient.demo",
      passwordHash,
      age: 62,
      gender: "Male",
      pastMedicalHistory: ["Osteoarthritis", "GERD"],
      activeMedications: ["Pantoprazole 40mg daily"],
      allergies: ["NKDA"],
      isSynthetic: true,
    },
    {
      patientCode: "PAT-106",
      name: "Kavita Desai",
      email: "kavita.desai@patient.demo",
      passwordHash,
      age: 41,
      gender: "Female",
      pastMedicalHistory: ["Hypothyroidism"],
      activeMedications: ["Levothyroxine 75mcg daily"],
      allergies: ["Latex"],
      isSynthetic: true,
    },
  ]);

  const sampleVisit = await Visit.create({
    providerId: anjali._id,
    patientId: patients[0]._id,
    visitType: "Primary Care Follow-up",
    consentStatus: "GRANTED",
    consentGrantedAt: new Date(),
    status: "APPROVED",
    transcript:
      "Speaker 1: Good morning Rahul. How have your home blood pressure readings been this week?\nSpeaker 2: Morning doctor. Mostly around 128 over 80. No headaches or dizziness on Amlodipine 5mg.\nSpeaker 1: Vitals today show BP 126/80, pulse 72. Continue Amlodipine 5mg daily and Atorvastatin 10mg nightly, and recheck fasting lipids in 3 months.\nSpeaker 2: Understood, thank you doctor.",
    speakerMapping: { Speaker1: "Provider", Speaker2: "Patient" },
    soapDraft: {
      subjective:
        "Patient reports home blood pressure readings averaging 128/80 mmHg over the past week. Denies headaches, dizziness, or medication side effects.",
      objective: "BP 126/80 mmHg, Pulse 72 bpm. Alert and oriented.",
      assessment: "Essential hypertension, well controlled on current therapy.",
      plan: "Continue Amlodipine 5mg daily and Atorvastatin 10mg nightly. Follow up in 3 months with repeat fasting lipid panel.",
      verifyFlags: [],
      isFallback: false,
    },
    soapFinal: {
      subjective:
        "Patient reports home blood pressure readings averaging 128/80 mmHg over the past week. Denies headaches, dizziness, or medication side effects.",
      objective: "BP 126/80 mmHg, Pulse 72 bpm. Alert and oriented.",
      assessment: "Essential hypertension, well controlled on current therapy.",
      plan: "Continue Amlodipine 5mg daily and Atorvastatin 10mg nightly. Follow up in 3 months with repeat fasting lipid panel.",
    },
    patientSummary:
      "Your blood pressure is well controlled at 126/80. Please continue taking Amlodipine 5mg once daily and Atorvastatin 10mg at night.",
    nextAppointment: "Follow up in 3 months with a repeat fasting lipid blood test.",
    generationTimeMs: 1850,
    providerEdited: false,
    aiFallbackUsed: false,
  });

  await AuditLog.create([
    {
      providerId: anjali._id,
      visitId: sampleVisit._id.toString(),
      patientName: "Rahul Sharma (PAT-101)",
      action: "CONSENT_GRANTED",
      details: "Explicit patient consent granted for Primary Care Follow-up",
    },
    {
      providerId: anjali._id,
      visitId: sampleVisit._id.toString(),
      patientName: "Rahul Sharma (PAT-101)",
      action: "SOAP_DRAFT_GENERATED",
      details: "Grounded SOAP draft generated in 1.9s",
    },
    {
      providerId: anjali._id,
      visitId: sampleVisit._id.toString(),
      patientName: "Rahul Sharma (PAT-101)",
      action: "SOAP_APPROVED",
      details: "Provider approved SOAP note for Rahul Sharma (PAT-101)",
    },
  ]);

  console.log("Seeded 2 providers, 6 synthetic patients, and 1 baseline approved consultation.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed error:", err);
  process.exit(1);
});