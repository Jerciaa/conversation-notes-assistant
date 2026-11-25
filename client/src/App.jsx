import { useState } from "react";
import LoginView from "./components/LoginView";
import ConsultationRoom from "./components/ConsultationRoom";
import AuditAndAnalytics from "./components/AuditAndAnalytics";
import "./App.css";

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("cna_token") || "");
  const [provider, setProvider] = useState(() => {
    try {
      const saved = localStorage.getItem("cna_provider");
      return saved && saved !== "undefined" ? JSON.parse(saved) : null;
    } catch {
      localStorage.removeItem("cna_provider");
      localStorage.removeItem("cna_token");
      return null;
    }
  });
  const [activeTab, setActiveTab] = useState("consultations");

  function handleLogin(newToken, providerProfile) {
    localStorage.setItem("cna_token", newToken);
    localStorage.setItem("cna_provider", JSON.stringify(providerProfile));
    setToken(newToken);
    setProvider(providerProfile);
  }

  function handleLogout() {
    localStorage.removeItem("cna_token");
    localStorage.removeItem("cna_provider");
    setToken("");
    setProvider(null);
  }

  if (!token || !provider) {
    return <LoginView onLogin={handleLogin} />;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-area">
          <strong>Conversation Notes Assistant</strong>
          <span className="pill pill-green">Zero Raw Audio Storage</span>
        </div>

        <nav className="nav-tabs">
          <button
            type="button"
            className={`tab-btn ${activeTab === "consultations" ? "active" : ""}`}
            onClick={() => setActiveTab("consultations")}
          >
            Consultation &amp; SOAP Review
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === "audit" ? "active" : ""}`}
            onClick={() => setActiveTab("audit")}
          >
            Audit Logs &amp; Analytics
          </button>
        </nav>

        <div className="user-area">
          <span>
            {provider.name} ({provider.specialty})
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={handleLogout}>
            Sign Out
          </button>
        </div>
      </header>

      <main className="main-container">
        {activeTab === "consultations" ? (
          <ConsultationRoom token={token} />
        ) : (
          <AuditAndAnalytics token={token} />
        )}
      </main>
    </div>
  );
}