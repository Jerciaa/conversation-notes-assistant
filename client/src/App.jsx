import { useState, useEffect } from "react";
import LoginView from "./components/LoginView";
import ConsultationRoom from "./components/ConsultationRoom";
import AuditAndAnalytics from "./components/AuditAndAnalytics";
import PatientPortal from "./components/PatientPortal";

export default function App() {
  const [token, setToken] = useState("");
  const [role, setRole] = useState("provider");
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState("consult");

  useEffect(() => {
    localStorage.removeItem("cna_token");
    localStorage.removeItem("cna_role");
    localStorage.removeItem("cna_user");
    localStorage.removeItem("cna_provider");
  }, []);

  function handleLogin(newToken, userRole, userProfile) {
    if (typeof userRole === "object" && userRole !== null) {
      setToken(newToken);
      setUser(userRole);
      setRole(userRole.patientCode ? "patient" : "provider");
      return;
    }

    const resolvedRole =
      userRole === "patient" || userProfile?.patientCode ? "patient" : "provider";
    setToken(newToken);
    setRole(resolvedRole);
    setUser(userProfile || null);
  }

  function handleLogout() {
    setToken("");
    setRole("provider");
    setUser(null);
    setActiveTab("consult");
  }

  if (!token) {
    return <LoginView onLogin={handleLogin} />;
  }

  if (role === "patient" || user?.patientCode) {
    return <PatientPortal token={token} patient={user} onLogout={handleLogout} />;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-area">
          <strong>Conversation Notes Assistant</strong>
          <span className="pill pill-green">Zero-Audio-Retention Active</span>
        </div>

        <nav className="nav-tabs">
          <button
            type="button"
            className={`tab-btn ${activeTab === "consult" ? "active" : ""}`}
            onClick={() => setActiveTab("consult")}
          >
            Consultation Workspace
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === "audit" ? "active" : ""}`}
            onClick={() => setActiveTab("audit")}
          >
            Audit &amp; Analytics
          </button>
        </nav>

        <div className="user-area">
          <span>
            {user?.name} ({user?.specialty})
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={handleLogout}>
            Sign Out
          </button>
        </div>
      </header>

      <main className="main-container">
        {activeTab === "consult" ? (
          <ConsultationRoom token={token} provider={user} />
        ) : (
          <AuditAndAnalytics token={token} />
        )}
      </main>
    </div>
  );
}