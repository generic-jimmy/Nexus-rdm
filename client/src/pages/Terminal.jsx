import { useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useAuthStore } from "../store/auth";
import s from "./Terminal.module.css";

export default function Terminal() {
  const [params]   = useSearchParams();
  const deviceId   = params.get("deviceId");
  const deviceHost = params.get("host") || "";
  const deviceUser = params.get("user") || "";
  const deviceOs   = params.get("os")   || "";

  const { accessToken: storeToken } = useAuthStore();
  const urlToken    = params.get("token");
  const activeToken = urlToken || storeToken;

  const termRef  = useRef(null);
  const xtermRef = useRef(null);
  const fitRef   = useRef(null);
  const wsRef    = useRef(null);

  const [status, setStatus] = useState("connecting");
  const [info,   setInfo]   = useState(null);
  const [ready,  setReady]  = useState(false);

  const buildWsUrl = useCallback(() => {
    const base   = window.location.origin;
    const wsBase = base.replace(/^https/, "wss").replace(/^http/, "ws");
    return `${wsBase}/ws?token=${encodeURIComponent(activeToken)}&deviceId=${deviceId}`;
  }, [activeToken, deviceId]);

  useEffect(() => {
    if (!deviceId || !activeToken || !termRef.current) return;

    // ── xterm init ────────────────────────────────────────────
    const term = new XTerm({
      cursorBlink:       true,
      cursorStyle:       "block",
      fontSize:          14,
      fontFamily:        '"Cascadia Code", "Fira Code", "Consolas", monospace',
      allowTransparency: false,
      convertEol:        true,
      scrollback:        5000,
      // CRITICAL: allow the terminal to receive all input
      disableStdin:      false,
      theme: {
        background:          "#080c10",
        foreground:          "#c9d1d9",
        cursor:              "#00e5c8",
        cursorAccent:        "#080c10",
        selectionBackground: "rgba(0,229,200,0.2)",
        black:   "#0d1117", red:     "#f85149", green:   "#3fb950",
        yellow:  "#d29922", blue:    "#58a6ff", magenta: "#bc8cff",
        cyan:    "#76e3ea", white:   "#b1bac4",
        brightBlack:   "#6e7681", brightRed:     "#ff7b72",
        brightGreen:   "#56d364", brightYellow:  "#e3b341",
        brightBlue:    "#79c0ff", brightMagenta: "#d2a8ff",
        brightCyan:    "#87deea", brightWhite:   "#f0f6fc",
      },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(termRef.current);

    // Fit immediately and again after paint
    try { fit.fit(); } catch {}
    requestAnimationFrame(() => {
      try { fit.fit(); } catch {}
      // Focus after paint so the browser actually gives us keyboard events
      term.focus();
    });

    xtermRef.current = term;
    fitRef.current   = fit;

    // Resize observer — refit and report new size to agent
    const ro = new ResizeObserver(() => {
      try { fit.fit(); } catch {}
    });
    ro.observe(termRef.current);

    // ── Input handler ─────────────────────────────────────────
    // onData fires for ALL keyboard input including paste
    term.onData(data => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "shell:input", data }));
      }
    });

    // Report terminal size to agent whenever xterm resizes
    term.onResize(({ cols, rows }) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "shell:resize", cols, rows }));
      }
    });

    // ── WebSocket ─────────────────────────────────────────────
    const ws = new WebSocket(buildWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("open");
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
            // Focus again now that shell is confirmed ready
            setTimeout(() => term.focus(), 50);
            break;
          case "shell:output":
            term.write(msg.data);
            break;
          case "shell:exit":
            setReady(false);
            setStatus("closed");
            term.write("\r\n\x1b[90m[Session closed]\x1b[0m\r\n");
            break;
          case "shell:error":
            term.write(`\r\n\x1b[31m[Error: ${msg.message}]\x1b[0m\r\n`);
            setStatus("error");
            break;
        }
      } catch {}
    };

    ws.onerror = () => setStatus("error");
    ws.onclose = () => {
      setStatus(prev => prev === "open" ? "closed" : prev);
      if (xtermRef.current) {
        xtermRef.current.write("\r\n\x1b[90m[Disconnected]\x1b[0m\r\n");
      }
    };

    return () => {
      ro.disconnect();
      ws.close();
      term.dispose();
    };
  }, [deviceId, activeToken, buildWsUrl]);

  // Re-focus terminal when clicking anywhere in the wrapper
  const handleWrapperClick = () => {
    xtermRef.current?.focus();
  };

  const reconnect     = () => window.location.reload();
  const sendCtrlC     = () => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: "shell:input", data: "\x03" }));
    xtermRef.current?.focus();
  };
  const clearTerminal = () => {
    xtermRef.current?.clear();
    xtermRef.current?.focus();
  };

  const statusColor = {
    connecting: "#f5a623",
    open:       "#22d885",
    closed:     "#f03e3e",
    error:      "#f03e3e",
  }[status] ?? "#7a8fa8";

  const statusLabel = {
    connecting: "Connecting",
    open:       "Connected",
    closed:     "Closed",
    error:      "Error",
  }[status] ?? status;

  const di = info || {};

  return (
    <div className={s.root}>
      {/* Top bar */}
      <div className={s.topbar}>
        <div className={s.deviceInfo}>
          <InfoCol label="Client" value={(deviceId || "").slice(0, 8) + "…"} />
          <InfoCol label="Host"   value={di.hostname || deviceHost || "—"} />
          <InfoCol label="User"   value={di.username || deviceUser || "—"} />
          <InfoCol label="OS"     value={
            di.os
              ? `${di.os}${di.os_version ? " " + di.os_version : ""}`
              : deviceOs || "—"
          } />
        </div>

        <div className={s.actions}>
          <div className={s.statusPill} style={{ borderColor: statusColor + "55", color: statusColor }}>
            <span className={s.statusDot} style={{ background: statusColor }} />
            {statusLabel}
          </div>
          <button className={s.actionBtn}    onClick={reconnect}     title="Reconnect">↻ Reconnect</button>
          <button className={s.actionBtn}    onClick={sendCtrlC}     title="Send Ctrl+C">⬛ Ctrl+C</button>
          <button className={s.actionBtnAlt} onClick={clearTerminal} title="Clear">⌫ Clear</button>
        </div>
      </div>

      {/* Terminal area — clicking anywhere refocuses xterm */}
      <div className={s.termWrap} onClick={handleWrapperClick}>
        {/* tabIndex makes the div focusable; xterm attaches its own listeners to the canvas */}
        <div
          ref={termRef}
          className={s.term}
          tabIndex={0}
          style={{ outline: "none" }}
        />

        {status === "connecting" && (
          <div className={s.overlay}>
            <div className={s.spinner} />
            <div className={s.overlayText}>
              Connecting to {di.hostname || deviceHost || "device"}…
            </div>
          </div>
        )}

        {(status === "closed" || status === "error") && !ready && (
          <div className={s.overlayBottom}>
            <span className={s.overlayMsg}>
              {status === "error" ? "Connection error" : "Session closed"}
            </span>
            <button className={s.reconnectBtn} onClick={e => { e.stopPropagation(); reconnect(); }}>
              ↻ Reconnect
            </button>
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
