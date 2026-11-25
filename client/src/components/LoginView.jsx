import { useState } from "react";
import { apiRequest } from "../api";

const DEMO_PATIENTS = [
  { code: "PAT-101", name: "Rahul Sharma", email: "rahul.sharma@patient.demo" },
  { code: "PAT-102", name: "Meera Krishnan", email: "meera.krishnan@patient.demo" },
  { code: "PAT-103", name: "Arjun Menon", email: "arjun.menon@patient.demo" },
  { code: "PAT-104", name: "Priya Nair", email: "priya.nair@patient.demo" },
  { code: "PAT-105", name: "Suresh Iyer", email: "suresh.iyer@patient.demo" },
  { code: "PAT-106", name: "Kavita Desai", email: "kavita.desai@patient.demo" },
];

export default function LoginView({ onLogin }) {
  const [portalMode, setPortalMode] = useState("provider");
  const [email, setEmail] = useState("dr.anjali@clinic.demo");
  const [password, setPassword] = useState("DemoPass123!");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function switchMode(mode) {
    setPortalMode(mode);
    setError("");
    if (mode === "provider") {
      setEmail("dr.anjali@clinic.demo");
      setPassword("DemoPass123!");
    } else {
      setEmail("rahul.sharma@patient.demo");
      setPassword("DemoPass123!");
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await apiRequest("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      const userProfile = data.role === "patient" ? data.patient : data.provider;
      onLogin(data.token, data.role || "provider", userProfile);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="badge-row">
          <span className="pill pill-blue">Zero Raw Audio Retention</span>
          <span className="pill pill-green">Role-Based Data Isolation</span>
        </div>
        <h1>Conversation Notes Assistant</h1>
        <p className="subtitle">
          {portalMode === "provider"
            ? "Privacy-first clinical documentation and grounded SOAP note drafting for outpatient consultations."
            : "Patient Portal: View your visit summaries, consultation call logs, and upcoming appointments."}
        </p>

        <div className="demo-buttons" style={{ marginBottom: "1rem" }}>
          <button
            type="button"
            className={`btn btn-sm ${portalMode === "provider" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => switchMode("provider")}
          >
            Clinician Portal
          </button>
          <button
            type="button"
            className={`btn btn-sm ${portalMode === "patient" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => switchMode("patient")}
          >
            Patient Portal
          </button>
        </div>

        <form onSubmit={handleSubmit} className="form-stack">
          <label>
            {portalMode === "provider" ? "Clinician Email" : "Patient Email"}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && <div className="alert alert-error">{error}</div>}
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading
              ? "Signing in..."
              : portalMode === "provider"
              ? "Sign In as Clinician"
              : "Sign In to Patient Portal"}
          </button>
        </form>

        {portalMode === "provider" ? (
          <div className="demo-accounts">
            <strong>Pilot Accounts (Row-Level Data Isolation):</strong>
            <div className="demo-buttons">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setEmail("dr.anjali@clinic.demo");
                  setPassword("DemoPass123!");
                }}
              >
                Dr. Anjali Rao (Primary Care)
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setEmail("dr.vikram@clinic.demo");
                  setPassword("DemoPass123!");
                }}
              >
                Dr. Vikram Nair (Internal Medicine)
              </button>
            </div>
          </div>
        ) : (
          <div className="demo-accounts">
            <strong>Demo Patient Accounts (Password: DemoPass123!):</strong>
            <div className="demo-buttons">
              {DEMO_PATIENTS.map((p) => (
                <button
                  key={p.code}
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setEmail(p.email);
                    setPassword("DemoPass123!");
                  }}
                >
                  {p.name} ({p.code})
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}