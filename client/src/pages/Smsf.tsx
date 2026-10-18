/**
 * Scarton SMSF page at /smsf: the owner's self-managed super fund at IBKR.
 * ─────────────────────────────────────────────────────────────────────────────
 * Same shell as the Bull Rotation Cockpit (sidebar, theme, sign out) around
 * SmsfView, which reads /api/smsf. Display-only.
 */
import { useEffect, useState } from "react";
import { SmsfView } from "@/components/cockpit/SmsfView";
import { readTheme, THEME_KEY } from "@/lib/cockpit";
import { useOwner } from "@/components/OwnerGate";
import "./cockpit.css";

const SMSF_ICON = <svg viewBox="0 0 16 16"><path d="M2 7l6-4 6 4M3 7v6h10V7M6 13V9h4v4" /></svg>;
const ROTATION_ICON = <svg viewBox="0 0 16 16"><path d="M2 13l4-5 3 3 5-7" /></svg>;

export default function Smsf() {
  const { signOut } = useOwner();
  const [theme, setTheme] = useState<"light" | "dark" | null>(readTheme);

  useEffect(() => { document.title = "Scarton SMSF"; }, []);

  const toggleTheme = () => {
    const current = theme ?? (window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark");
    const next = current === "dark" ? "light" : "dark";
    setTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* per-viewer convenience only */ }
  };

  return (
    <div className="cockpit" data-theme={theme ?? undefined}>
      <div className="app">
        <aside className="side">
          <div className="brand"><b>Scarton SMSF</b><span>Interactive Brokers · monthly rule</span></div>
          <nav className="nav" aria-label="Pages">
            <a href="/smsf" aria-current="page">{SMSF_ICON}Scarton SMSF</a>
            <a href="/bull-rotation">{ROTATION_ICON}Bull Rotation</a>
          </nav>
          <div className="side-foot">
            <span><i className="dot" />Prices update 22:30 UTC Mon–Fri</span>
            <button className="theme-btn" type="button" onClick={toggleTheme}>Switch theme</button>
            <button className="theme-btn" type="button" onClick={() => void signOut()}>Sign out</button>
          </div>
        </aside>

        <main className="main">
          <SmsfView />
          <div className="mobile-foot">
            <button className="theme-btn" type="button" onClick={toggleTheme}>Switch theme</button>
            <button className="theme-btn" type="button" onClick={() => void signOut()}>Sign out</button>
          </div>
        </main>
      </div>
    </div>
  );
}
