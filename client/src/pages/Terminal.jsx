import { useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuthStore } from "../store/auth";
import s from "./Terminal.module.css";

// xterm.js loaded from CDN via useEffect (avoids bundler issues)
const XTERM_CSS = "https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.css";
const XTERM_JS  = "https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js";
const XTERM_FIT = "https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js";

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const el = document.createElement("script");
    el.src = src; el.onload = resolve; el.onerror = reject;
    document.head.appendChild(el);
  });
}

function loadCSS(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const el = document.createElement("link");
  el.rel = "stylesheet"; el.href = href;
  document.head.appendChild(el);
}

export default function Terminal() {
  const [params]      = useSearchParams();
  const deviceId      = params.get("deviceId");
  const deviceName    = params.get("name")    || "Device";
  const deviceHost    = params.get("host")    || "";
  const deviceUser    = params.get("user")    || "";
  const deviceOs      = params.get("os")      || "";

  const { accessToken } = useAuthStore();

  const termRef    = useRef(null);   // DOM element
  const xtermRef   = useRef(null);   // Terminal instance
  const fitRef     = useRef(null);   // FitAddon instance
  const wsRef      = useRef(null);   // WebSocket
  const [status,   setStatus]   = useState("connecting"); // connecting|open|closed|error
  const [info,     setInfo]     = useState(null);
  const [ready,    setReady]    = useState(false);

  // ── Build WebSocket URL ────────────────────────────────────────
  const buildWsUrl = useCallback(() => {
    const base   = window.location.origin;
    const wsBase = base.replace(/^https/, "wss").replace(/^http/, "ws");
    const token  = encodeURIComponent(accessToken);
    return `${wsBase}/ws?token=${token}&deviceId=${deviceId}`;
  }, [accessToken, deviceId]);

  // ── Initialize xterm ──────────────────────────────────────────
  useEffect(() => {
    let term, fit, ws, resizeObserver;

    const init = async () => {
      // Load xterm from CDN
      loadCSS(XTERM_CSS);
      await loadScript(XTERM_JS);
      await loadScript(XTERM_FIT);

      const { Terminal: XTerm, FitAddon } = window;
      if (!XTerm) return;

      term = new XTerm({
        cursorBlink:     true,
        cursorStyle:     "block",
        fontSize:        14,
        fontFamily:      '"Cascadia Code", "Fira Code", "Consolas", monospace',
        theme: {
          background:    "#080c10",
          foreground:    "#c9d1d9",
          cursor:        "#00e5c8",
          cursorAccent:  "#080c10",
          selectionBackground: "rgba(0,229,200,0.2)",
          black:         "#0d1117",
          red:           "#f85149",
          green:         "#3fb950",
          yellow:        "#d29922",
          blue:          "#58a6ff",
          magenta:       "#bc8cff",
          cyan:          "#76e3ea",
          white:         "#b1bac4",
          brightBlack:   "#6e7681",
          brightRed:     "#ff7b72",
          brightGreen:   "#56d364",
          brightYellow:  "#e3b341",
          brightBlue:    "#79c0ff",
          brightMagenta: "#d2a8ff",
          brightCyan:    "#87deea",
          brightWhite:   "#f0f6fc",
        },
        scrollback:  5000,
        allowTransparency: false,
        convertEol:  true,
      });

      fit = new FitAddon();
      term.loadAddon(fit);
      term.open(termRef.current);
      fit.fit();

      xtermRef.current = term;
      fitRef.current   = fit;

      // Resize observer
      resizeObserver = new ResizeObserver(() => { try { fit.fit(); } catch {} });
      resizeObserver.observe(termRef.current);

      // Input → WebSocket
      term.onData(data => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "shell:input", data }));
        }
      });

      term.onResize(({ cols, rows }) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "shell:resize", cols, rows }));
        }
      });

      // ── WebSocket ────────────────────────────────────────────
      const url = buildWsUrl();
      ws = new WebSocket(url);
      wsRef.current = ws;
      setStatus("connecting");

      ws.onopen = () => {
        setStatus("open");
        // Request shell
        ws.send(JSON.stringify({ type: "shell:open" }));
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          switch (msg.type) {
            case "session:info":
              setInfo(msg.device);
              break;
            case "shell:ready":
              setReady(true);
              term.focus();
              break;
            case "shell:output":
              term.write(msg.data);
              break;
            case "shell:exit":
              setReady(false);
              setStatus("closed");
              term.write(`\r\n\x1b[90m[Client disconnected]\x1b[0m\r\n`);
              break;
            case "shell:error":
              term.write(`\r\n\x1b[31m[Error: ${msg.message}]\x1b[0m\r\n`);
              setStatus("error");
              break;
            default:
              break;
          }
        } catch {}
      };

      ws.onerror = () => { setStatus("error"); };
      ws.onclose = (e) => {
        setStatus("closed");
        if (xtermRef.current) {
          xtermRef.current.write(`\r\n\x1b[90m[Client disconnected]\x1b[0m\r\n`);
        }
      };

      setReady(false);
    };

    if (deviceId && accessToken) init();

    return () => {
      if (resizeObserver) resizeObserver.disconnect();
      if (ws) ws.close();
      if (term) term.dispose();
    };
  // eslint-disable-next-line
  }, [deviceId, accessToken]);

  // ── Reconnect ─────────────────────────────────────────────────
  const reconnect = () => {
    if (wsRef.current) wsRef.current.close();
    // Re-mount by reloading the page — simplest reliable reconnect
    window.location.reload();
  };

  // ── Ctrl+C ────────────────────────────────────────────────────
  const sendCtrlC = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "shell:input", data: "\x03" }));
    }
  };

  // ── Clear ─────────────────────────────────────────────────────
  const clearTerminal = () => {
    if (xtermRef.current) xtermRef.current.clear();
  };

  const statusLabel = {
    connecting: "Connecting",
    open:       "Connected",
    closed:     "Closed",
    error:      "Error",
  }[status] ?? status;

  const statusColor = {
    connecting: "#f5a623",
    open:       "#22d885",
    closed:     "#f03e3e",
    error:      "#f03e3e",
  }[status] ?? "#7a8fa8";

  const displayInfo = info || { hostname: deviceHost, username: deviceUser, os: deviceOs };

  return (
    <div className={s.root}>
      {/* ── Top bar ── */}
      <div className={s.topbar}>
        <div className={s.deviceInfo}>
          <InfoCol label="Client"   value={deviceId?.slice(0, 8) + "…"} />
          <InfoCol label="Host"     value={displayInfo.hostname || deviceHost || "—"} />
          <InfoCol label="User"     value={displayInfo.username || deviceUser || "—"} />
          <InfoCol label="OS"       value={
            displayInfo.os
              ? `${displayInfo.os}${displayInfo.os_version ? " " + displayInfo.os_version : ""}`
              : deviceOs || "—"
          } />
        </div>

        <div className={s.actions}>
          <div className={s.statusPill} style={{ borderColor: statusColor + "55", color: statusColor }}>
            <span className={s.statusDot} style={{ background: statusColor }} />
            {statusLabel}
          </div>

          <button className={s.actionBtn} onClick={reconnect} title="Reconnect">
            <span className={s.actionIcon}>↻</span> Reconnect
          </button>

          <button className={s.actionBtn} onClick={sendCtrlC} title="Send Ctrl+C">
            <span className={s.actionIcon}>⬛</span> Ctrl+C
          </button>

          <button className={s.actionBtnAlt} onClick={clearTerminal} title="Clear terminal">
            <span className={s.actionIcon}>⌫</span> Clear
          </button>
        </div>
      </div>

      {/* ── Terminal ── */}
      <div className={s.termWrap}>
        <div ref={termRef} className={s.term} />

        {status === "connecting" && (
          <div className={s.overlay}>
            <div className={s.spinner} />
            <div className={s.overlayText}>Connecting to {displayInfo.hostname || deviceHost || "device"}…</div>
          </div>
        )}

        {(status === "closed" || status === "error") && !ready && (
          <div className={s.overlayBottom}>
            <span className={s.overlayMsg}>
              {status === "error" ? "Connection error" : "Session closed"}
            </span>
            <button className={s.reconnectBtn} onClick={reconnect}>↻ Reconnect</button>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoCol({ label, value }) {
  return (
    <div className={s.infoCol}>
      <div className={s.infoLabel}>{label}</div>
      <div className={s.infoValue}>{value}</div>
    </div>
  );
}
