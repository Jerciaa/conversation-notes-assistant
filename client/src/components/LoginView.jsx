import { useState } from "react";
import { apiRequest } from "../api";

const DEMO_DOCTORS = [
  {
    name: "Dr. Anjali Rao",
    specialty: "Primary Care",
    email: "dr.anjali@clinic.demo",
    password: "DemoPass123!",
  },
  {
    name: "Dr. Vikram Nair",
    specialty: "Internal Medicine",
    email: "dr.vikram@clinic.demo",
    password: "DemoPass123!",
  },
];

const DEMO_PATIENTS = [
  { code: "PAT-101", name: "Rahul Sharma", email: "rahul.sharma@patient.demo", password: "DemoPass123!" },
  { code: "PAT-102", name: "Meera Krishnan", email: "meera.krishnan@patient.demo", password: "DemoPass123!" },
  { code: "PAT-103", name: "Arjun Menon", email: "arjun.menon@patient.demo", password: "DemoPass123!" },
  { code: "PAT-104", name: "Priya Nair", email: "priya.nair@patient.demo", password: "DemoPass123!" },
  { code: "PAT-105", name: "Suresh Iyer", email: "suresh.iyer@patient.demo", password: "DemoPass123!" },
  { code: "PAT-106", name: "Kavita Desai", email: "kavita.desai@patient.demo", password: "DemoPass123!" },
];

export default function LoginView({ onAuthSuccess }) {
  const [portalRole, setPortalRole] = useState("clinician");
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState(DEMO_DOCTORS[0].email);
  const [password, setPassword] = useState(DEMO_DOCTORS[0].password);
  const [name, setName] = useState("Dr. Anjali Rao");
  const [specialty, setSpecialty] = useState("Primary Care");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function switchPortalRole(role) {
    setPortalRole(role);
    setError("");
    if (role === "clinician") {
      setEmail(DEMO_DOCTORS[0].email);
      setPassword(DEMO_DOCTORS[0].password);
    } else {
      setMode("login");
      setEmail(DEMO_PATIENTS[0].email);
      setPassword(DEMO_PATIENTS[0].password);
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
    <div
      className="auth-shell"
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)",
        padding: "1.5rem",
      }}
    >
      <div
        className="auth-card"
        style={{
          width: "100%",
          maxWidth: "460px",
          background: "#ffffff",
          borderRadius: "16px",
          padding: "2rem",
          boxShadow: "0 12px 32px rgba(15, 23, 42, 0.08)",
          border: "1px solid #e2e8f0",
        }}
      >
        <h1
          style={{
            fontSize: "1.5rem",
            fontWeight: 700,
            textAlign: "center",
            color: "#0f172a",
            marginTop: 0,
            marginBottom: "1.5rem",
          }}
        >
          Conversation Notes Assistant
        </h1>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "0.4rem",
            background: "#f1f5f9",
            padding: "0.3rem",
            borderRadius: "10px",
            marginBottom: "1.25rem",
          }}
        >
          <button
            type="button"
            onClick={() => switchPortalRole("clinician")}
            style={{
              padding: "0.55rem",
              borderRadius: "8px",
              border: "none",
              fontWeight: 600,
              fontSize: "0.9rem",
              cursor: "pointer",
              background: portalRole === "clinician" ? "#ffffff" : "transparent",
              color: portalRole === "clinician" ? "#2563eb" : "#475569",
              boxShadow:
                portalRole === "clinician"
                  ? "0 1px 4px rgba(0, 0, 0, 0.08)"
                  : "none",
            }}
          >
            Clinician
          </button>
          <button
            type="button"
            onClick={() => switchPortalRole("patient")}
            style={{
              padding: "0.55rem",
              borderRadius: "8px",
              border: "none",
              fontWeight: 600,
              fontSize: "0.9rem",
              cursor: "pointer",
              background: portalRole === "patient" ? "#ffffff" : "transparent",
              color: portalRole === "patient" ? "#2563eb" : "#475569",
              boxShadow:
                portalRole === "patient"
                  ? "0 1px 4px rgba(0, 0, 0, 0.08)"
                  : "none",
            }}
          >
            Patient
          </button>
        </div>

        {portalRole === "clinician" && (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: "1rem",
              marginBottom: "1.25rem",
              borderBottom: "1px solid #e2e8f0",
              paddingBottom: "0.6rem",
            }}
          >
            <button
              type="button"
              onClick={() => setMode("login")}
              style={{
                background: "none",
                border: "none",
                fontWeight: 600,
                fontSize: "0.88rem",
                cursor: "pointer",
                color: mode === "login" ? "#2563eb" : "#64748b",
                borderBottom:
                  mode === "login" ? "2px solid #2563eb" : "2px solid transparent",
                paddingBottom: "0.25rem",
              }}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => setMode("register")}
              style={{
                background: "none",
                border: "none",
                fontWeight: 600,
                fontSize: "0.88rem",
                cursor: "pointer",
                color: mode === "register" ? "#2563eb" : "#64748b",
                borderBottom:
                  mode === "register"
                    ? "2px solid #2563eb"
                    : "2px solid transparent",
                paddingBottom: "0.25rem",
              }}
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
                Full Name
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </label>
              <label>
                Specialty
                <input
                  type="text"
                  value={specialty}
                  onChange={(e) => setSpecialty(e.target.value)}
                />
              </label>
            </>
          )}

          <label>
            Email
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

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{ width: "100%", marginTop: "0.4rem", padding: "0.7rem" }}
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <div
          style={{
            marginTop: "1.25rem",
            paddingTop: "1rem",
            borderTop: "1px solid #e2e8f0",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "0.45rem",
            }}
          >
            {portalRole === "clinician"
              ? DEMO_DOCTORS.map((doc) => (
                  <button
                    key={doc.email}
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setMode("login");
                      setEmail(doc.email);
                      setPassword(doc.password);
                    }}
                    style={{
                      textAlign: "left",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-start",
                      padding: "0.45rem 0.6rem",
                    }}
                  >
                    <strong style={{ fontSize: "0.82rem" }}>{doc.name}</strong>
                    <span style={{ fontSize: "0.74rem", color: "#64748b" }}>
                      {doc.email}
                    </span>
                  </button>
                ))
              : DEMO_PATIENTS.map((p) => (
                  <button
                    key={p.code}
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setEmail(p.email);
                      setPassword(p.password);
                    }}
                    style={{
                      textAlign: "left",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-start",
                      padding: "0.45rem 0.6rem",
                    }}
                  >
                    <strong style={{ fontSize: "0.82rem" }}>
                      {p.code}: {p.name}
                    </strong>
                    <span style={{ fontSize: "0.74rem", color: "#64748b" }}>
                      {p.email}
                    </span>
                  </button>
                ))}
          </div>
        </div>
      </div>
    </div>
  );
}