import "dotenv/config";
import mongoose from "mongoose";

async function testConnection() {
  console.log("Connecting to MongoDB Atlas...");
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB Atlas successfully!");
  await mongoose.disconnect();
}

testConnection();
