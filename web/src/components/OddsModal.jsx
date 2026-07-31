import { useEffect } from "react";

// Modale plein écran du graphe d'évolution (fond cliquable + Échap pour fermer).
export default function OddsModal({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="odds-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="odds-modal card" onClick={(e) => e.stopPropagation()}>
        <div className="odds-modal-head">
          <h2>{title}</h2>
          <button type="button" className="range-btn" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
