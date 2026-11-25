import { useState } from "react";
import { apiRequest } from "../api";

const DEMO_PATIENTS = [
  { code: "PAT-101", name: "Elena Vance", email: "elena.vance@patient.demo" },
  { code: "PAT-102", name: "Marcus Sterling", email: "marcus.sterling@patient.demo" },
  { code: "PAT-103", name: "Priya Nair", email: "priya.nair@patient.demo" },
  { code: "PAT-104", name: "David Okafor", email: "david.okafor@patient.demo" },
  { code: "PAT-105", name: "Sofia Alvarez", email: "sofia.alvarez@patient.demo" },
  { code: "PAT-106", name: "Liam Chen", email: "liam.chen@patient.demo" },
];

export default function LoginView({ onAuthSuccess }) {
  const [portalRole, setPortalRole] = useState("clinician");
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("dr.arjun@clinic.demo");
  const [password, setPassword] = useState("DemoPass123!");
  const [name, setName] = useState("Dr. Arjun Mehta");
  const [specialty, setSpecialty] = useState("Internal Medicine");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function switchPortalRole(role) {
    setPortalRole(role);
    setError("");
    if (role === "clinician") {
      setEmail("dr.arjun@clinic.demo");
      setPassword("DemoPass123!");
    } else {
      setMode("login");
      setEmail("elena.vance@patient.demo");
      setPassword("DemoPass123!");
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      if (portalRole === "patient") {
        const data = await apiRequest("/api/auth/patient/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        onAuthSuccess({
          token: data.token,
          role: "patient",
          user: data.patient,
        });
      } else {
        const endpoint =
          mode === "login" ? "/api/auth/login" : "/api/auth/register";
        const payload =
          mode === "login"
            ? { email, password }
            : { name, email, password, specialty };
        const data = await apiRequest(endpoint, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        onAuthSuccess({
          token: data.token,
          role: "clinician",
          user: data.provider,
        });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1>Conversation Notes Assistant</h1>

        <div className="tab-row">
          <button
            type="button"
            className={`tab-btn ${portalRole === "clinician" ? "active" : ""}`}
            onClick={() => switchPortalRole("clinician")}
          >
            Clinician Portal
          </button>
          <button
            type="button"
            className={`tab-btn ${portalRole === "patient" ? "active" : ""}`}
            onClick={() => switchPortalRole("patient")}
          >
            Patient Portal
          </button>
        </div>

        {portalRole === "clinician" && (
          <div className="tab-row" style={{ marginTop: "-0.4rem" }}>
            <button
              type="button"
              className={`tab-btn ${mode === "login" ? "active" : ""}`}
              onClick={() => setMode("login")}
            >
              Clinician Sign In
            </button>
            <button
              type="button"
              className={`tab-btn ${mode === "register" ? "active" : ""}`}
              onClick={() => setMode("register")}
            >
              Create Account
            </button>
          </div>
        )}

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit} className="form-stack">
          {portalRole === "clinician" && mode === "register" && (
            <>
              <label>
                Full Name &amp; Credentials
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </label>
              <label>
                Clinical Specialty
                <input
                  type="text"
                  value={specialty}
                  onChange={(e) => setSpecialty(e.target.value)}
                />
              </label>
            </>
          )}

          <label>
            {portalRole === "patient" ? "Patient Email" : "Provider Email"}
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

          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading
              ? "Authenticating..."
              : portalRole === "patient"
              ? "Sign In to Patient Portal"
              : mode === "login"
              ? "Sign In to Clinician Workspace"
              : "Register & Launch Workspace"}
          </button>
        </form>

        {portalRole === "patient" ? (
          <div className="demo-box" style={{ marginTop: "1rem" }}>
            <strong>Demo Patient Accounts:</strong>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "0.4rem",
                marginTop: "0.5rem",
              }}
            >
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
                  {p.code}: {p.name}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="demo-box">
            <strong>Demo Clinician Account:</strong> <code>dr.arjun@clinic.demo</code>
          </div>
        )}
      </div>
    </div>
  );
}