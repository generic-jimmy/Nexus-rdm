import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/auth";
import api from "../utils/api";
import s from "./Dashboard.module.css";

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, logout, refreshToken } = useAuthStore();
  const [devices,  setDevices]  = useState([]);
  const [stats,    setStats]    = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [showAdd,  setShowAdd]  = useState(false);
  const [newKey,   setNewKey]   = useState(null);
  const [filter,   setFilter]   = useState("all");
  const [search,   setSearch]   = useState("");

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

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const handleLogout = async () => {
    try { await api.post("/api/auth/logout", { refreshToken }); } catch {}
    logout(); navigate("/login");
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this device? Cannot be undone.")) return;
    await api.delete(`/api/devices/${id}`);
    load();
  };

  const filtered = devices.filter(d => {
    const matchStatus = filter === "all" || d.status === filter;
    const matchSearch = !search ||
      d.name?.toLowerCase().includes(search.toLowerCase()) ||
      d.hostname?.toLowerCase().includes(search.toLowerCase()) ||
      d.ip_address?.includes(search);
    return matchStatus && matchSearch;
  });

  if (loading) return <Loader />;

  return (
    <div className={s.layout}>
      <aside className={s.sidebar}>
        <div className={s.sidebarTop}>
          <div className={s.brand}>
            <span className={s.brandMark}>N</span>
            <div>
              <div className={s.brandName}>NEXUS<span style={{color:"var(--accent)"}}>RDM</span></div>
            </div>
          </div>
          <nav className={s.nav}>
            <NavItem icon="⬡" label="DEVICES"   active />
            <NavItem icon="◈" label="TERMINAL" />
            <NavItem icon="◎" label="AUDIT LOG" />
            <NavItem icon="◇" label="SETTINGS" />
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

      <main className={s.main}>
        <div className={s.header}>
          <div>
            <h1 className={s.pageTitle}>DEVICES</h1>
            <div className={s.pageSub}>// {devices.length} registered · refresh 30s</div>
          </div>
          <button className="btn-primary" onClick={() => setShowAdd(true)}>+ REGISTER</button>
        </div>

        {stats && (
          <div className={s.statsRow}>
            <StatCard label="TOTAL"   value={stats.total}   color="accent" onClick={() => setFilter("all")}    active={filter==="all"} />
            <StatCard label="ONLINE"  value={stats.online}  color="online" onClick={() => setFilter("online")} active={filter==="online"} />
            <StatCard label="OFFLINE" value={stats.offline} color="dim"    onClick={() => setFilter("offline")}active={filter==="offline"} />
            <StatCard label="WARNING" value={stats.warning} color="warn"   onClick={() => setFilter("warning")}active={filter==="warning"} />
          </div>
        )}

        <div className={s.toolbar}>
          <input
            className={s.search}
            placeholder="Search devices, hostnames, IPs..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {newKey && (
          <div className={s.keyBanner}>
            <div className={s.keyBannerTitle}>⚠ DEVICE KEY — COPY NOW. NEVER SHOWN AGAIN.</div>
            <div className={s.keyValue}>{newKey}</div>
            <button className={s.keyClose} onClick={() => setNewKey(null)}>DISMISS</button>
          </div>
        )}

        {filtered.length === 0 ? (
          <EmptyState onAdd={() => setShowAdd(true)} filtered={filter !== "all" || search} />
        ) : (
          <div className={s.deviceGrid}>
            {filtered.map(d => (
              <DeviceCard key={d.id} device={d} onDelete={() => handleDelete(d.id)} />
            ))}
          </div>
        )}
      </main>

      {showAdd && (
        <AddDeviceModal
          onClose={() => setShowAdd(false)}
          onCreated={(key) => { setNewKey(key); setShowAdd(false); load(); }}
        />
      )}
    </div>
  );
}

// ─── Device Card ──────────────────────────────────────────────────────────────
function DeviceCard({ device: d, onDelete }) {
  const [menu, setMenu] = useState(null); // null | "main" | category name
  const menuRef = useRef(null);

  const statusColor = {
    online:  "var(--online)",
    offline: "var(--offline)",
    warning: "var(--warning)",
  }[d.status] ?? "var(--offline)";

  const ramPct  = d.ram_total  ? Math.round((d.ram_used  / d.ram_total)  * 100) : null;
  const diskPct = d.disk_total ? Math.round((d.disk_used / d.disk_total) * 100) : null;
  const age     = d.last_seen  ? timeAgo(new Date(d.last_seen)) : "never";

  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const CATEGORIES = {
    "Remote Access": ["Console", "Remote Desktop", "Backstage", "Voice"],
    "Monitoring":    ["Webcam", "Keylogger", "Process Manager"],
    "System":        ["File Manager", "Registry Editor", "Task Killer", "Clipboard"],
    "Agent":         ["Ping", "Reconnect", "Set Nickname", "Set Custom Tag", "Set Group",
                      "Mute Notifications", "Elevate", "Disconnect", "Uninstall"],
  };

  return (
    <div className={s.card}>
      {/* Header row */}
      <div className={s.cardTop}>
        <span className={s.statusDot} style={{
          background: statusColor,
          boxShadow: d.status === "online" ? `0 0 6px ${statusColor}` : "none"
        }} />
        <span className={s.cardStatus} style={{ color: statusColor }}>
          {d.status === "online" ? "Online" : d.status === "warning" ? "Warning" : "Offline"}
        </span>
        <span className={s.cardAge}>· {age}</span>
        {d.ping_ms != null && d.status === "online" && (
          <span className={s.ping}>
            <PingIcon /> {d.ping_ms} ms
          </span>
        )}
      </div>

      {/* Device name + user */}
      <div className={s.cardName}>
        <span className={s.cardNameIcon}>☰</span>
        {d.hostname || d.name}
      </div>
      {d.username && (
        <div className={s.cardUser}>
          <span className={s.metaIcon}>👤</span> {d.username}
        </div>
      )}
      {d.ip_address && (
        <div className={s.cardIp}>
          <span className={s.metaIcon}>🌐</span> {d.ip_address}
        </div>
      )}

      {/* OS / arch / agent row */}
      <div className={s.cardBadges}>
        {d.os && <span className={s.badge}><WinIcon /> {d.os}{d.os_version ? ` ${d.os_version}` : ""}</span>}
        {d.arch && <span className={s.badge}>{d.arch}</span>}
        {d.cpu_cores && <span className={s.badge}>🖥 {d.cpu_cores}</span>}
        {d.agent_version && <span className={`${s.badge} ${s.badgeGreen}`}>v{d.agent_version}</span>}
      </div>

      {/* CPU model */}
      {d.cpu_model && <div className={s.cpuModel}>{d.cpu_model}</div>}

      {/* RAM / Disk / Battery bars */}
      <div className={s.metrics}>
        {d.ram_total != null && (
          <MetricBar
            label={`${formatBytes(d.ram_total)}`}
            pct={ramPct}
            color={ramPct > 85 ? "var(--danger)" : "var(--accent)"}
          />
        )}
        {d.disk_total != null && (
          <MetricBar
            label="DISK"
            pct={diskPct}
            color={diskPct > 90 ? "var(--danger)" : "var(--warning)"}
          />
        )}
        {d.battery_percent != null && (
          <BatteryBar pct={d.battery_percent} charging={d.battery_charging} />
        )}
      </div>

      {/* Actions */}
      <div className={s.cardFooter}>
        <div className={s.menuWrap} ref={menuRef}>
          <button
            className={s.cmdBtn}
            onClick={() => setMenu(menu ? null : "main")}
          >
            <span>&gt;_</span> Commands
          </button>

          {/* Main menu */}
          {menu === "main" && (
            <div className={`${s.dropdown} ${s.dropMain}`}>
              {Object.keys(CATEGORIES).map(cat => (
                <div
                  key={cat}
                  className={s.dropItem}
                  onMouseEnter={() => setMenu(cat)}
                >
                  <span className={s.dropIcon}>{catIcon(cat)}</span>
                  {cat}
                  <span className={s.dropArrow}>›</span>
                </div>
              ))}
            </div>
          )}

          {/* Sub menus */}
          {menu && menu !== "main" && CATEGORIES[menu] && (
            <>
              <div className={`${s.dropdown} ${s.dropMain}`}>
                {Object.keys(CATEGORIES).map(cat => (
                  <div
                    key={cat}
                    className={`${s.dropItem} ${menu === cat ? s.dropItemActive : ""}`}
                    onMouseEnter={() => setMenu(cat)}
                  >
                    <span className={s.dropIcon}>{catIcon(cat)}</span>
                    {cat}
                    <span className={s.dropArrow}>›</span>
                  </div>
                ))}
              </div>
              <div className={`${s.dropdown} ${s.dropSub}`}>
                {CATEGORIES[menu].map(item => (
                  <div
                    key={item}
                    className={`${s.dropItem} ${item === "Uninstall" || item === "Disconnect" ? s.dropItemDanger : ""}`}
                    onClick={() => {
                      if (item === "Uninstall" && !confirm(`Uninstall agent from ${d.name}?`)) return;
                      console.log(`[cmd] ${item} on ${d.id}`);
                      setMenu(null);
                    }}
                  >
                    <span className={s.dropIcon}>{itemIcon(item)}</span>
                    {item}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <button className={s.iconBtn} onClick={() => {}} title="Refresh">↺</button>
        <button className={s.iconBtnDanger} onClick={onDelete} title="Delete device">⊗</button>
      </div>
    </div>
  );
}

// ─── Metric bar ───────────────────────────────────────────────────────────────
function MetricBar({ label, pct, color }) {
  return (
    <div className={s.metricRow}>
      <span className={s.metricLabel}>{label}</span>
      <div className={s.barTrack}>
        <div className={s.barFill} style={{ width: `${pct ?? 0}%`, background: color }} />
      </div>
      <span className={s.metricPct}>{pct != null ? `${pct}%` : "—"}</span>
    </div>
  );
}

function BatteryBar({ pct, charging }) {
  const color = charging ? "var(--online)" : pct < 20 ? "var(--danger)" : "var(--warning)";
  return (
    <div className={s.metricRow}>
      <span className={s.metricLabel}>BAT</span>
      <div className={s.barTrack}>
        <div className={s.barFill} style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className={s.metricPct}>{pct}%{charging ? " ⚡" : ""}</span>
    </div>
  );
}

// ─── Add Device Modal ─────────────────────────────────────────────────────────
function AddDeviceModal({ onClose, onCreated }) {
  const [name,     setName]     = useState("");
  const [tags,     setTags]     = useState("");
  const [interval, setInterval] = useState("30");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

  const submit = async () => {
    if (!name.trim()) return setError("Device name required");
    const iv = parseInt(interval, 10);
    if (isNaN(iv) || iv < 10 || iv > 300) return setError("Interval must be 10–300 seconds");
    setLoading(true); setError("");
    try {
      const { data } = await api.post("/api/devices", {
        name: name.trim(),
        tags: tags.split(",").map(t => t.trim()).filter(Boolean),
        heartbeat_interval: iv,
      });
      onCreated(data.apiKey);
    } catch (e) {
      setError(e.response?.data?.error ?? "Failed to create device");
    } finally { setLoading(false); }
  };

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.modal} onClick={e => e.stopPropagation()}>
        <div className={s.modalHeader}>
          <span className={s.modalTitle}>// REGISTER DEVICE</span>
          <button className={s.modalClose} onClick={onClose}>✕</button>
        </div>
        <div className={s.modalBody}>
          <ModalField label="DEVICE NAME" value={name} onChange={setName} placeholder="office-pc-01" />
          <ModalField label="TAGS (comma separated)" value={tags} onChange={setTags} placeholder="windows, production" />
          <div>
            <label className={s.modalLabel}>HEARTBEAT INTERVAL (10–300 seconds)</label>
            <input type="number" min={10} max={300} value={interval}
              onChange={e => setInterval(e.target.value)} />
          </div>
          {error && <div className={s.modalError}>{error}</div>}
          <div className={s.modalNote}>
            After creating, copy the one-time API key and use it in build.bat to compile the agent.
          </div>
        </div>
        <div className={s.modalFooter}>
          <button className="btn-ghost" onClick={onClose}>CANCEL</button>
          <button className="btn-primary" onClick={submit} disabled={loading}>
            {loading ? "CREATING…" : "CREATE →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Small components ─────────────────────────────────────────────────────────
function NavItem({ icon, label, active }) {
  return (
    <div className={`${s.navItem} ${active ? s.navActive : ""}`}>
      <span className={s.navIcon}>{icon}</span><span>{label}</span>
    </div>
  );
}

function StatCard({ label, value, color, onClick, active }) {
  const colors = { accent:"var(--accent)", online:"var(--online)", dim:"var(--text-3)", warn:"var(--warning)" };
  return (
    <div className={`${s.stat} ${active ? s.statActive : ""}`} onClick={onClick} style={{cursor:"pointer"}}>
      <div className={s.statVal} style={{ color: colors[color] }}>{value ?? 0}</div>
      <div className={s.statLabel}>{label}</div>
    </div>
  );
}

function ModalField({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label className={s.modalLabel}>{label}</label>
      <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function EmptyState({ onAdd, filtered }) {
  return (
    <div className={s.empty}>
      <div className={s.emptyGlyph}>⬡</div>
      <div className={s.emptyTitle}>{filtered ? "NO DEVICES MATCH" : "NO DEVICES REGISTERED"}</div>
      <div className={s.emptySub}>{filtered ? "Try a different filter or search" : "Register a device to get an API key, then build the agent .exe"}</div>
      {!filtered && <button className="btn-primary" style={{marginTop:"1.25rem"}} onClick={onAdd}>+ REGISTER FIRST DEVICE</button>}
    </div>
  );
}

function Loader() {
  return (
    <div style={{height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16}}>
      <div style={{width:32,height:32,border:"2px solid var(--border-hi)",borderTopColor:"var(--accent)",borderRadius:"50%",animation:"spin 0.7s linear infinite"}} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <span style={{fontFamily:"var(--font-mono)",fontSize:12,color:"var(--text-3)",letterSpacing:"0.1em"}}>LOADING…</span>
    </div>
  );
}

function PingIcon() { return <span style={{fontSize:10}}>⟳</span>; }
function WinIcon()  { return <span>🪟</span>; }

function catIcon(cat) {
  return { "Remote Access":"⚡", "Monitoring":"👁", "System":"⚙", "Agent":"🤖" }[cat] ?? "•";
}
function itemIcon(item) {
  const m = {
    "Console":"⌨", "Remote Desktop":"🖥", "Backstage":"🎭", "Voice":"🎙",
    "Webcam":"📷", "Keylogger":"⌨", "Process Manager":"📊",
    "File Manager":"📁", "Registry Editor":"🔧", "Task Killer":"💀", "Clipboard":"📋",
    "Ping":"📡", "Reconnect":"🔄", "Set Nickname":"✏", "Set Custom Tag":"🏷",
    "Set Group":"👥", "Mute Notifications":"🔕", "Elevate":"⬆",
    "Disconnect":"🔌", "Uninstall":"🗑",
  };
  return m[item] ?? "•";
}

function formatBytes(bytes) {
  if (!bytes) return "—";
  const gb = bytes / 1024 / 1024 / 1024;
  return gb >= 1 ? `${gb.toFixed(0)} GB` : `${(bytes/1024/1024).toFixed(0)} MB`;
}

function timeAgo(date) {
  const s = Math.floor((Date.now() - date) / 1000);
  if (s <  60)   return `${s}s ago`;
  if (s < 3600)  return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}
