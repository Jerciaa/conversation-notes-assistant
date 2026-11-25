import { useState, useEffect } from "react";
import { apiRequest } from "../api";

export default function AuditAndAnalytics({ token }) {
  const [metrics, setMetrics] = useState(null);
  const [logs, setLogs] = useState([]);
  const [actionFilter, setActionFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    loadDashboard();
  }, [token, actionFilter]);

  async function loadDashboard() {
    setError("");
    try {
      const query = new URLSearchParams();
      if (actionFilter) query.set("action", actionFilter);
      if (searchQuery) query.set("q", searchQuery);

      const [mData, lData] = await Promise.all([
        apiRequest("/api/admin/metrics", {}, token),
        apiRequest(`/api/admin/audit-logs?${query.toString()}`, {}, token),
      ]);
      setMetrics(mData.metrics);
      setLogs(lData.logs || []);
    } catch (err) {
      setError(err.message);
    }
  }

  function handleSearch(e) {
    e.preventDefault();
    loadDashboard();
  }

  return (
    <div className="analytics-stack">
      {error && <div className="alert alert-error">{error}</div>}

      {metrics && (
        <div className="kpi-grid">
          <div className="kpi-card">
            <span className="kpi-label">Total Consultations</span>
            <strong className="kpi-value">{metrics.totalVisits}</strong>
          </div>
          <div className="kpi-card">
            <span className="kpi-label">Approved Notes</span>
            <strong className="kpi-value">{metrics.approvedCount}</strong>
          </div>
          <div className="kpi-card">
            <span className="kpi-label">Avg Turnaround</span>
            <strong className="kpi-value">{metrics.avgLatencySeconds}s</strong>
            <span className="kpi-sub">Target &lt; 90s</span>
          </div>
          <div className="kpi-card">
            <span className="kpi-label">Clinician Edit Rate</span>
            <strong className="kpi-value">{metrics.editRatePercent}%</strong>
          </div>
          <div className="kpi-card">
            <span className="kpi-label">Consent Purges</span>
            <strong className="kpi-value">{metrics.withdrawnPurges}</strong>
          </div>
        </div>
      )}

      <div className="card">
        <div className="header-split">
          <h3>Searchable Compliance & Security Audit Log</h3>
          <form onSubmit={handleSearch} className="filter-bar">
            <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
              <option value="">All Audit Actions</option>
              <option value="CONSENT_GRANTED">CONSENT_GRANTED</option>
              <option value="CONSENT_WITHDRAWN_PURGED">CONSENT_WITHDRAWN_PURGED</option>
              <option value="TRANSCRIPT_GENERATED">TRANSCRIPT_GENERATED</option>
              <option value="SOAP_DRAFT_GENERATED">SOAP_DRAFT_GENERATED</option>
              <option value="SOAP_EDITED">SOAP_EDITED</option>
              <option value="SOAP_APPROVED">SOAP_APPROVED</option>
              <option value="SOAP_REJECTED">SOAP_REJECTED</option>
              <option value="AI_FALLBACK_TRIGGERED">AI_FALLBACK_TRIGGERED</option>
            </select>
            <input
              type="text"
              placeholder="Search patient, visit ID, or details..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button type="submit" className="btn btn-primary btn-sm">
              Search
            </button>
          </form>
        </div>

        <div className="table-wrap">
          <table className="audit-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Action</th>
                <th>Patient</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">
                    No matching audit records found.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log._id}>
                    <td>{new Date(log.createdAt).toLocaleString()}</td>
                    <td>
                      <span className="pill pill-blue">{log.action}</span>
                    </td>
                    <td>{log.patientName || "—"}</td>
                    <td>{log.details}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}