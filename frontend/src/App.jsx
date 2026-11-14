
import { useCallback, useEffect, useState } from "react";
import "./App.css";

import {
  Activity,
  ArrowDownRight,
  Bell,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Clock3,
  LayoutDashboard,
  Mail,
  Plus,
  Send,
  Settings,
  ShieldCheck,
  Zap,
  RefreshCw,
  X,
} from "lucide-react";

import Auth from "./components/Auth";
import api from "./services/api";

const statConfig = [
  {
    label: "Total emails",
    key: "total",
    change: "Across all activity",
    icon: Mail,
    color: "blue",
  },
  {
    label: "Scheduled",
    key: "scheduled",
    change: "Waiting to be sent",
    icon: CalendarClock,
    color: "purple",
  },
  {
    label: "Successfully sent",
    key: "sent",
    change: "Delivered to provider",
    icon: CheckCircle2,
    color: "green",
  },
  {
    label: "Failed",
    key: "failed",
    change: "Delivery failures",
    icon: Activity,
    color: "orange",
  },
];

const initialStats = {
  total: 0,
  scheduled: 0,
  sent: 0,
  failed: 0,
  processing: 0,
};

const initialQueue = {
  waiting: 0,
  active: 0,
  delayed: 0,
  completed: 0,
  failed: 0,
  paused: 0,
};

function formatDate(dateValue) {
  if (!dateValue) return "—";

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getLocalDateTimeMinimum() {
  const date = new Date(Date.now() + 60 * 1000);
  const offset = date.getTimezoneOffset() * 60000;

  return new Date(date.getTime() - offset)
    .toISOString()
    .slice(0, 16);
}

// Interpret backend health responses
function getServiceStatus(data, serviceName) {
  if (!data) return "Checking";

  const services = data.services || data.health || data;

  let value = services[serviceName];

  if (value === undefined && serviceName === "database") {
    value = services.postgres || services.db;
  }

  if (value === undefined && serviceName === "redis") {
    value = services.redis;
  }

  if (value === undefined && serviceName === "api") {
    value = services.api;
  }

  if (value && typeof value === "object") {
    value = value.status || value.state || value.connected;
  }

  if (value === true) return "Connected";
  if (value === false) return "Disconnected";

  if (typeof value === "string") {
    const normalized = value.toLowerCase();

    if (
      [
        "connected",
        "online",
        "healthy",
        "ok",
        "up",
        "running",
      ].includes(normalized)
    ) {
      return "Connected";
    }

    if (
      [
        "disconnected",
        "offline",
        "unhealthy",
        "down",
        "error",
      ].includes(normalized)
    ) {
      return "Disconnected";
    }

    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  return "Unknown";
}

// Individual system status row
function ServiceRow({ label, status }) {
  const connected = ["Connected", "Online"].includes(status);
  const disconnected = ["Disconnected", "Offline"].includes(status);

  const dotColor = connected
    ? "#12b76a"
    : disconnected
      ? "#f04438"
      : "#f79009";

  return (
    <div className="service-row">
      <span>{label}</span>
      <strong>
        <span
          className="online-dot"
          style={{
            background: dotColor,
            display: "inline-block",
          }}
        />
        {status}
      </strong>
    </div>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [currentPage, setCurrentPage] = useState("overview");
  const [emailSearch, setEmailSearch] = useState("");
  const [emailStatusFilter, setEmailStatusFilter] = useState("all");

  const [emails, setEmails] = useState([]);
  const [loadingEmails, setLoadingEmails] = useState(false);
  const [emailError, setEmailError] = useState("");

  const [statsData, setStatsData] = useState(initialStats);
  const [loadingStats, setLoadingStats] = useState(false);

  const [queueData, setQueueData] = useState(initialQueue);
  const [loadingQueue, setLoadingQueue] = useState(false);

  const [healthData, setHealthData] = useState(null);
  const [loadingHealth, setLoadingHealth] = useState(false);

  const [showCompose, setShowCompose] = useState(false);
  const [sending, setSending] = useState(false);
  const [composeError, setComposeError] = useState("");
  const [composeSuccess, setComposeSuccess] = useState("");

  const [form, setForm] = useState({
    toEmail: "",
    subject: "",
    bodyText: "",
    scheduledAt: "",
  });

  // CHECK LOGIN
  useEffect(() => {
    async function checkLogin() {
      const token = localStorage.getItem("tempomail_token");

      if (!token) {
        setCheckingAuth(false);
        return;
      }

      try {
        const response = await api.get("/auth/me");
        setUser(response.data.user);
      } catch {
        localStorage.removeItem("tempomail_token");
        setUser(null);
      } finally {
        setCheckingAuth(false);
      }
    }

    checkLogin();
  }, []);

  // LOAD EMAIL HISTORY
  const loadEmails = useCallback(async () => {
    setLoadingEmails(true);
    setEmailError("");

    try {
      const response = await api.get("/emails");
      setEmails(response.data.emails || []);
    } catch (error) {
      console.error("Could not load emails:", error);

      setEmailError(
        error.response?.data?.message ||
          "Unable to load emails. Please try again."
      );
    } finally {
      setLoadingEmails(false);
    }
  }, []);

  // LOAD REAL DATABASE STATISTICS
  const loadStats = useCallback(async () => {
    setLoadingStats(true);

    try {
      const response = await api.get("/emails/stats");
      const receivedStats = response.data.stats || {};

      setStatsData({
        total: Number(receivedStats.total || 0),
        scheduled: Number(receivedStats.scheduled || 0),
        sent: Number(receivedStats.sent || 0),
        failed: Number(receivedStats.failed || 0),
        processing: Number(receivedStats.processing || 0),
      });
    } catch (error) {
      console.error("Could not load email statistics:", error);
    } finally {
      setLoadingStats(false);
    }
  }, []);

  // LOAD REAL BULLMQ QUEUE COUNTS
  const loadQueue = useCallback(async () => {
    setLoadingQueue(true);

    try {
      const response = await api.get("/emails/queue-status");

      setQueueData({
        ...initialQueue,
        ...(response.data.queue || {}),
      });
    } catch (error) {
      console.error("Could not load queue status:", error);
    } finally {
      setLoadingQueue(false);
    }
  }, []);

  // LOAD API, POSTGRESQL, REDIS AND WORKER HEALTH
  const loadHealth = useCallback(async () => {
    setLoadingHealth(true);

    try {
      const response = await api.get("/health");
      setHealthData(response.data);
    } catch (error) {
      console.error("Could not load system health:", error);
      setHealthData(null);
    } finally {
      setLoadingHealth(false);
    }
  }, []);

  // INITIAL DATA LOAD
  useEffect(() => {
    if (!user) return;

    const timer = setTimeout(() => {
      loadEmails();
      loadStats();
      loadQueue();
      loadHealth();
    }, 0);

    return () => clearTimeout(timer);
  }, [user, loadEmails, loadStats, loadQueue, loadHealth]);

  // AUTOMATIC REFRESH
  useEffect(() => {
    if (!user) return;

    const queueInterval = setInterval(() => {
      loadQueue();
      loadStats();
    }, 10000);

    const healthInterval = setInterval(() => {
      loadHealth();
    }, 5000);

    const emailInterval = setInterval(() => {
      loadEmails();
    }, 30000);

    return () => {
      clearInterval(queueInterval);
      clearInterval(healthInterval);
      clearInterval(emailInterval);
    };
  }, [user, loadQueue, loadStats, loadHealth, loadEmails]);

  // LOGOUT
  function handleLogout() {
    localStorage.removeItem("tempomail_token");
    setUser(null);
    setEmails([]);
    setStatsData(initialStats);
    setQueueData(initialQueue);
    setHealthData(null);
  }

  function handleFormChange(event) {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  }

  function closeCompose() {
    if (sending) return;

    setShowCompose(false);
    setComposeError("");
    setComposeSuccess("");

    setForm({
      toEmail: "",
      subject: "",
      bodyText: "",
      scheduledAt: "",
    });
  }

  // SCHEDULE EMAIL
  async function handleScheduleEmail(event) {
    event.preventDefault();

    setComposeError("");
    setComposeSuccess("");

    if (
      !form.toEmail.trim() ||
      !form.subject.trim() ||
      !form.bodyText.trim() ||
      !form.scheduledAt
    ) {
      setComposeError("Please complete all fields.");
      return;
    }

    const selectedDate = new Date(form.scheduledAt);

    if (Number.isNaN(selectedDate.getTime())) {
      setComposeError("Please select a valid date and time.");
      return;
    }

    if (selectedDate.getTime() <= Date.now()) {
      setComposeError("Please select a future date and time.");
      return;
    }

    setSending(true);

    try {
      const payload = {
        toEmail: form.toEmail.trim(),
        subject: form.subject.trim(),
        bodyText: form.bodyText.trim(),
        scheduledAt: selectedDate.toISOString(),
      };

      const response = await api.post("/emails", payload);

      setComposeSuccess(
        response.data.message || "Email scheduled successfully!"
      );

      setForm({
        toEmail: "",
        subject: "",
        bodyText: "",
        scheduledAt: "",
      });

      await Promise.all([
        loadEmails(),
        loadStats(),
        loadQueue(),
      ]);

      setTimeout(() => {
        setShowCompose(false);
        setComposeSuccess("");
      }, 1200);
    } catch (error) {
      console.error("Email scheduling failed:", error);

      setComposeError(
        error.response?.data?.message ||
          "Unable to schedule your email. Please try again."
      );
    } finally {
      setSending(false);
    }
  }

  // REFRESH ALL DASHBOARD DATA
  async function refreshDashboard() {
    await Promise.all([
      loadEmails(),
      loadStats(),
      loadQueue(),
      loadHealth(),
    ]);
  }

  const stats = statConfig.map((stat) => ({
    ...stat,
    value: statsData[stat.key] ?? 0,
  }));

  const recentEmails = [...emails]
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() -
        new Date(a.created_at).getTime()
    )
    .slice(0, 5);

  function getStatusLabel(status) {
    if (!status) return "Unknown";
    return status.charAt(0).toUpperCase() + status.slice(1);
  }

  const filteredEmails = [...emails]
    .filter((email) => {
      const query = emailSearch.trim().toLowerCase();
      const matchesSearch =
        !query ||
        String(email.subject || "").toLowerCase().includes(query) ||
        String(email.to_email || "").toLowerCase().includes(query);
      const matchesStatus =
        emailStatusFilter === "all" ||
        String(email.status || "").toLowerCase() === emailStatusFilter;
      const matchesPage =
        currentPage === "scheduled"
          ? ["scheduled", "queued", "processing"].includes(String(email.status || "").toLowerCase())
          : currentPage === "sent"
            ? String(email.status || "").toLowerCase() === "sent"
            : true;
      return matchesSearch && matchesStatus && matchesPage;
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  // REAL SERVICE HEALTH
  const apiStatus = getServiceStatus(healthData, "api");
  const databaseStatus = getServiceStatus(healthData, "database");
  const redisStatus = getServiceStatus(healthData, "redis");

  const workerHealth = getServiceStatus(healthData, "worker");

  const workerStatus =
    workerHealth === "Connected"
      ? "Online"
      : workerHealth === "Disconnected"
        ? "Offline"
        : "Unknown";

  const allServicesConnected =
    apiStatus === "Connected" &&
    databaseStatus === "Connected" &&
    redisStatus === "Connected";

  if (checkingAuth) {
    return (
      <div className="auth-page">
        <div className="auth-brand">
          <div className="auth-logo">
            <Send size={23} />
          </div>
          <span>
            tempo<span>mail</span>
          </span>
        </div>
        <p>Loading TempoMail...</p>
      </div>
    );
  }

  if (!user) {
    return <Auth onLogin={setUser} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <Send size={21} />
          </div>
          <span>
            tempo<span className="brand-light">mail</span>
          </span>
        </div>

        <div className="workspace-label">WORKSPACE</div>

        <nav className="nav-menu">
          <button type="button" className={`nav-link ${currentPage === "overview" ? "active" : ""}`} onClick={() => setCurrentPage("overview")}>
            <LayoutDashboard size={18} /> Overview
          </button>

          <button type="button" className={`nav-link ${currentPage === "all" ? "active" : ""}`} onClick={() => setCurrentPage("all")}>
            <Mail size={18} /> All emails
          </button>

          <button type="button" className={`nav-link ${currentPage === "scheduled" ? "active" : ""}`} onClick={() => setCurrentPage("scheduled")}>
            <CalendarClock size={18} /> Scheduled
            <span className="nav-count">{statsData.scheduled}</span>
          </button>

          <button type="button" className={`nav-link ${currentPage === "sent" ? "active" : ""}`} onClick={() => setCurrentPage("sent")}>
            <CheckCircle2 size={18} /> Sent
          </button>

          <button type="button" className={`nav-link ${currentPage === "activity" ? "active" : ""}`} onClick={() => setCurrentPage("activity")}>
            <Activity size={18} /> Activity
          </button>
        </nav>

        <div className="sidebar-bottom">
          <div className="queue-card">
            <div className="queue-heading">
              <span
                className="online-dot"
                style={{
                  background: allServicesConnected
                    ? "#12b76a"
                    : "#f79009",
                }}
              />
              Queue status
              <span className="live-label">LIVE</span>
            </div>

            <div className="queue-value">
              {loadingQueue
                ? "Checking..."
                : `${Number(queueData.waiting || 0) + Number(queueData.delayed || 0)} pending`}
            </div>

            <p>
              {Number(queueData.active || 0)} active jobs ·{" "}
              {Number(queueData.failed || 0)} failed jobs
            </p>
          </div>

          <button type="button" className="nav-link" onClick={() => setCurrentPage("overview")}>
            <Settings size={18} /> Settings
          </button>

          <div className="profile">
            <div className="avatar">
              {user.name?.charAt(0).toUpperCase() || "U"}
            </div>

            <div>
              <strong>{user.name || "User"}</strong>
              <span>Personal workspace</span>
            </div>

            <button
              className="icon-button"
              onClick={handleLogout}
              title="Sign out"
              aria-label="Sign out"
            >
              <ChevronDown size={16} />
            </button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> {({
              overview: "Overview",
              all: "All emails",
              scheduled: "Scheduled",
              sent: "Sent",
              activity: "Activity",
            })[currentPage]}
          </div>

          <div className="top-actions">
            <span className="system-status">
              <span
                className="online-dot"
                style={{
                  background: allServicesConnected
                    ? "#12b76a"
                    : "#f79009",
                }}
              />
              {loadingHealth
                ? "Checking systems..."
                : allServicesConnected
                  ? "All systems operational"
                  : "System check required"}
            </span>

            <button className="icon-button" aria-label="Notifications">
              <Bell size={19} />
            </button>

            <div className="top-avatar">
              {user.name?.charAt(0).toUpperCase() || "U"}
            </div>
          </div>
        </header>

        {currentPage === "overview" ? (
        <section className="dashboard">
          <div className="welcome-row">
            <div>
              <div className="eyebrow">
                {new Date()
                  .toLocaleDateString("en-IN", {
                    weekday: "long",
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })
                  .toUpperCase()}
              </div>

              <h1>
                Your emails, <span>on schedule.</span>
              </h1>

              <p className="subtitle">
                Welcome back, {user.name}. Here's what's happening
                with your email automation today.
              </p>
            </div>

            <div style={{ display: "flex", gap: "12px" }}>
              <button
                className="icon-button"
                onClick={refreshDashboard}
                disabled={
                  loadingEmails ||
                  loadingStats ||
                  loadingQueue ||
                  loadingHealth
                }
                title="Refresh dashboard"
                aria-label="Refresh dashboard"
              >
                <RefreshCw
                  size={18}
                  className={
                    loadingEmails ||
                    loadingStats ||
                    loadingQueue ||
                    loadingHealth
                      ? "spin"
                      : ""
                  }
                />
              </button>

              <button
                className="primary-button"
                onClick={() => {
                  setComposeError("");
                  setComposeSuccess("");
                  setShowCompose(true);
                }}
              >
                <Plus size={18} /> Compose email
              </button>
            </div>
          </div>

          {emailError && (
            <div
              role="alert"
              style={{
                padding: "14px",
                marginBottom: "18px",
                borderRadius: "10px",
                background: "#fff1f0",
                color: "#b42318",
              }}
            >
              {emailError}
              <button
                onClick={loadEmails}
                style={{ marginLeft: "12px", cursor: "pointer" }}
              >
                Retry
              </button>
            </div>
          )}

          <div className="stats-grid">
            {stats.map((stat) => {
              const Icon = stat.icon;

              return (
                <div className="stat-card" key={stat.label}>
                  <div className="stat-top">
                    <span>{stat.label}</span>

                    <div className={`stat-icon ${stat.color}`}>
                      <Icon size={19} />
                    </div>
                  </div>

                  <div className="stat-value">
                    {loadingStats ? "—" : stat.value}
                  </div>

                  <div className="stat-caption">{stat.change}</div>
                </div>
              );
            })}
          </div>

          <div className="content-grid">
            <section className="panel email-panel">
              <div className="panel-header">
                <div>
                  <h2>Recent emails</h2>
                  <p>Your latest email activity</p>
                </div>

                <button
                  className="text-button"
                  onClick={loadEmails}
                  disabled={loadingEmails}
                >
                  Refresh <RefreshCw size={15} />
                </button>
              </div>

              <div className="email-table-wrap">
                <table className="email-table">
                  <thead>
                    <tr>
                      <th>EMAIL</th>
                      <th>RECIPIENT</th>
                      <th>DATE</th>
                      <th>STATUS</th>
                    </tr>
                  </thead>

                  <tbody>
                    {loadingEmails && emails.length === 0 ? (
                      <tr>
                        <td colSpan="4">Loading your emails...</td>
                      </tr>
                    ) : recentEmails.length === 0 ? (
                      <tr>
                        <td colSpan="4">
                          No emails yet. Compose your first email!
                        </td>
                      </tr>
                    ) : (
                      recentEmails.map((email) => (
                        <tr key={email.id}>
                          <td>
                            <div className="email-subject">
                              {email.subject}
                            </div>
                            <div className="email-type">
                              Email delivery
                            </div>
                          </td>

                          <td>{email.to_email}</td>

                          <td>
                            {formatDate(
                              email.sent_at ||
                                email.scheduled_at ||
                                email.created_at
                            )}
                          </td>

                          <td>
                            <span
                              className={`status ${
                                email.status?.toLowerCase() || "unknown"
                              }`}
                            >
                              <span />
                              {getStatusLabel(email.status)}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="panel delivery-panel">
              <div className="panel-header">
                <div>
                  <h2>Delivery engine</h2>
                  <p>Live system and queue overview</p>
                </div>

                <Zap size={19} className="zap-icon" />
              </div>

              <div className="engine-status">
                <div className="engine-icon">
                  <ShieldCheck size={25} />
                </div>

                <div>
                  <strong>
                    {allServicesConnected
                      ? "Core services connected"
                      : "Checking core services"}
                  </strong>
                  <span>
                    {loadingHealth
                      ? "Checking system health..."
                      : allServicesConnected
                        ? "API, database and Redis are connected"
                        : "One or more services need attention"}
                  </span>
                </div>

                <span
                  className="online-dot"
                  style={{
                    background: allServicesConnected
                      ? "#12b76a"
                      : "#f79009",
                  }}
                />
              </div>

              <ServiceRow label="API server" status={apiStatus} />
              <ServiceRow label="PostgreSQL" status={databaseStatus} />
              <ServiceRow label="Redis queue" status={redisStatus} />

              <ServiceRow
                label="Email worker"
                status={workerStatus}
              />

              <div
                style={{
                  marginTop: "18px",
                  paddingTop: "16px",
                  borderTop: "1px solid #edf0f5",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: "12px",
                    fontSize: "13px",
                  }}
                >
                  <strong style={{ color: "#344054" }}>
                    Queue activity
                  </strong>
                  <span style={{ color: "#8993a7" }}>
                    {loadingQueue ? "Refreshing..." : "Live"}
                  </span>
                </div>

                <div className="service-row">
                  <span>Waiting</span>
                  <strong>{Number(queueData.waiting || 0)}</strong>
                </div>

                <div className="service-row">
                  <span>Active</span>
                  <strong>{Number(queueData.active || 0)}</strong>
                </div>

                <div className="service-row">
                  <span>Delayed</span>
                  <strong>{Number(queueData.delayed || 0)}</strong>
                </div>

                <div className="service-row">
                  <span>Completed</span>
                  <strong>{Number(queueData.completed || 0)}</strong>
                </div>

                <div className="service-row">
                  <span>Failed jobs</span>
                  <strong>{Number(queueData.failed || 0)}</strong>
                </div>
              </div>

              <div className="engine-footer">
                <Clock3 size={15} />
                Background processing enabled
              </div>
            </section>
          </div>

          <div className="bottom-note">
            <div className="note-icon">
              <Zap size={18} />
            </div>

            <div>
              <strong>Every email. Right on time.</strong>
              <p>
                TempoMail handles the timing, delivery and retries.
                You focus on what matters.
              </p>
            </div>

            <ArrowDownRight size={19} className="note-arrow" />
          </div>

          <footer className="footer">
            <span>© {new Date().getFullYear()} TempoMail</span>
            <span>
              Built for reliable delivery{" "}
              <span className="footer-heart">♥</span>
            </span>
          </footer>
        </section>
        ) : (
          <section className="dashboard">
            <div className="welcome-row">
              <div>
                <div className="eyebrow">TEMPO MAIL WORKSPACE</div>
                <h1>
                  {currentPage === "all" ? "All emails" :
                   currentPage === "scheduled" ? "Scheduled emails" :
                   currentPage === "sent" ? "Sent emails" : "Email activity"}
                </h1>
                <p className="subtitle">
                  {currentPage === "all" ? "View and search all your email records." :
                   currentPage === "scheduled" ? "Emails waiting to be delivered." :
                   currentPage === "sent" ? "Emails successfully processed by the delivery service." :
                   "Review the latest email events and delivery statuses."}
                </p>
              </div>
              <button className="primary-button" onClick={() => { setComposeError(""); setComposeSuccess(""); setShowCompose(true); }}>
                <Plus size={18} /> Compose email
              </button>
            </div>

            <section className="panel email-panel">
              <div className="panel-header">
                <div>
                  <h2>{filteredEmails.length} email{filteredEmails.length === 1 ? "" : "s"}</h2>
                  <p>Search by subject or recipient and filter by status</p>
                </div>
                <button className="text-button" onClick={loadEmails} disabled={loadingEmails}>
                  Refresh <RefreshCw size={15} />
                </button>
              </div>

              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", padding: "0 20px 18px" }}>
                <input
                  type="search"
                  value={emailSearch}
                  onChange={(event) => setEmailSearch(event.target.value)}
                  placeholder="Search subject or recipient..."
                  aria-label="Search emails"
                  style={{ ...composeInputStyle, flex: "1 1 240px", margin: 0 }}
                />
                <select
                  value={emailStatusFilter}
                  onChange={(event) => setEmailStatusFilter(event.target.value)}
                  aria-label="Filter by email status"
                  style={{ ...composeInputStyle, flex: "0 1 180px", margin: 0 }}
                >
                  <option value="all">All statuses</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="queued">Queued</option>
                  <option value="processing">Processing</option>
                  <option value="sent">Sent</option>
                  <option value="failed">Failed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>

              <div className="email-table-wrap">
                <table className="email-table">
                  <thead>
                    <tr><th>EMAIL</th><th>RECIPIENT</th><th>DATE</th><th>STATUS</th></tr>
                  </thead>
                  <tbody>
                    {loadingEmails && filteredEmails.length === 0 ? (
                      <tr><td colSpan="4">Loading your emails...</td></tr>
                    ) : filteredEmails.length === 0 ? (
                      <tr><td colSpan="4">No matching emails found.</td></tr>
                    ) : filteredEmails.map((email) => (
                      <tr key={email.id}>
                        <td>
                          <div className="email-subject">{email.subject}</div>
                          <div className="email-type">Email delivery</div>
                        </td>
                        <td>{email.to_email}</td>
                        <td>{formatDate(email.sent_at || email.scheduled_at || email.created_at)}</td>
                        <td>
                          <span className={`status ${email.status?.toLowerCase() || "unknown"}`}>
                            <span />
                            {getStatusLabel(email.status)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <footer className="footer">
              <span>© {new Date().getFullYear()} TempoMail</span>
              <span>Built for reliable delivery <span className="footer-heart">♥</span></span>
            </footer>
          </section>
        )}
      </main>

      {showCompose && (
        <div
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeCompose();
            }
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(15, 23, 42, 0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            overflowY: "auto",
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="compose-title"
            style={{
              width: "100%",
              maxWidth: "600px",
              background: "#ffffff",
              borderRadius: "18px",
              padding: "28px",
              boxShadow: "0 24px 80px rgba(15,23,42,0.22)",
              margin: "auto",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "24px",
              }}
            >
              <div>
                <div
                  style={{
                    color: "#6d5dfc",
                    fontSize: "11px",
                    fontWeight: 700,
                    letterSpacing: "1.5px",
                    marginBottom: "7px",
                  }}
                >
                  TEMPO MAIL WORKSPACE
                </div>

                <h2
                  id="compose-title"
                  style={{
                    margin: 0,
                    color: "#172033",
                    fontSize: "25px",
                  }}
                >
                  Compose email
                </h2>

                <p style={{ color: "#8993a7", marginBottom: 0 }}>
                  Write your email and choose when it should be delivered.
                </p>
              </div>

              <button
                type="button"
                className="icon-button"
                onClick={closeCompose}
                disabled={sending}
                aria-label="Close compose window"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleScheduleEmail}>
              <label htmlFor="toEmail" style={composeLabelStyle}>
                Recipient email
              </label>

              <input
                id="toEmail"
                name="toEmail"
                type="email"
                placeholder="recipient@example.com"
                value={form.toEmail}
                onChange={handleFormChange}
                required
                style={composeInputStyle}
              />

              <label htmlFor="subject" style={composeLabelStyle}>
                Subject
              </label>

              <input
                id="subject"
                name="subject"
                type="text"
                placeholder="Enter your email subject"
                value={form.subject}
                onChange={handleFormChange}
                maxLength={200}
                required
                style={composeInputStyle}
              />

              <label htmlFor="bodyText" style={composeLabelStyle}>
                Message
              </label>

              <textarea
                id="bodyText"
                name="bodyText"
                placeholder="Write your email message here..."
                value={form.bodyText}
                onChange={handleFormChange}
                rows={6}
                required
                style={{
                  ...composeInputStyle,
                  resize: "vertical",
                  minHeight: "130px",
                  fontFamily: "inherit",
                }}
              />

              <label htmlFor="scheduledAt" style={composeLabelStyle}>
                Schedule date and time
              </label>

              <input
                id="scheduledAt"
                name="scheduledAt"
                type="datetime-local"
                min={getLocalDateTimeMinimum()}
                value={form.scheduledAt}
                onChange={handleFormChange}
                required
                style={composeInputStyle}
              />

              {composeError && (
                <div
                  role="alert"
                  style={{
                    padding: "12px",
                    borderRadius: "9px",
                    background: "#fff1f0",
                    color: "#b42318",
                    fontSize: "13px",
                    marginTop: "14px",
                  }}
                >
                  {composeError}
                </div>
              )}

              {composeSuccess && (
                <div
                  role="status"
                  style={{
                    padding: "12px",
                    borderRadius: "9px",
                    background: "#ecfdf3",
                    color: "#027a48",
                    fontSize: "13px",
                    marginTop: "14px",
                  }}
                >
                  {composeSuccess}
                </div>
              )}

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "12px",
                  marginTop: "24px",
                }}
              >
                <button
                  type="button"
                  onClick={closeCompose}
                  disabled={sending}
                  style={secondaryButtonStyle}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={sending}
                  className="primary-button"
                  style={{
                    opacity: sending ? 0.7 : 1,
                    cursor: sending ? "wait" : "pointer",
                  }}
                >
                  <CalendarClock size={17} />
                  {sending ? "Scheduling..." : "Schedule email"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const composeLabelStyle = {
  display: "block",
  fontSize: "13px",
  fontWeight: 600,
  color: "#344054",
  marginBottom: "8px",
  marginTop: "17px",
};

const composeInputStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "13px 14px",
  border: "1px solid #e2e6ef",
  borderRadius: "9px",
  outline: "none",
  fontSize: "14px",
  color: "#202b3c",
  background: "#ffffff",
};

const secondaryButtonStyle = {
  padding: "12px 18px",
  border: "1px solid #e2e6ef",
  borderRadius: "9px",
  background: "#ffffff",
  color: "#475467",
  fontWeight: 600,
  cursor: "pointer",
};

export default App;
