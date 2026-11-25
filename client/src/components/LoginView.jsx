import { useState } from "react";
import { apiRequest } from "../api";

export default function LoginView({ onLogin }) {
  const [email, setEmail] = useState("dr.anjali@clinic.demo");
  const [password, setPassword] = useState("DemoPass123!");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await apiRequest("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      onLogin(data.token, data.provider);
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
          <span className="pill pill-green">Provider Data Isolation</span>
        </div>
        <h1>Conversation Notes Assistant</h1>
        <p className="subtitle">
          Privacy-first clinical documentation and grounded SOAP note drafting for outpatient consultations.
        </p>

        <form onSubmit={handleSubmit} className="form-stack">
          <label>
            Clinician Email
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
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

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
      </div>
    </div>
  );
}