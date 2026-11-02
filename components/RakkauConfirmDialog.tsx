"use client";

import { useEffect } from "react";

export function RakkauConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  variant = "danger",
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "primary";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="rk-modal-overlay" role="presentation" onClick={onCancel}>
      <aside
        className={`rk-confirm-dialog rk-confirm-dialog--${variant}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="rk-confirm-title"
        aria-describedby="rk-confirm-desc"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rk-confirm-icon" aria-hidden="true">
          {variant === "danger" ? "🗑" : "?"}
        </div>
        <h3 id="rk-confirm-title" className="rk-confirm-title">{title}</h3>
        <p id="rk-confirm-desc" className="rk-confirm-desc">{description}</p>
        <div className="rk-confirm-actions">
          <button
            type="button"
            className="rk-btn rk-btn-ghost"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`rk-btn ${variant === "danger" ? "rk-btn-danger" : "rk-btn-primary"}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Eliminando…" : confirmLabel}
          </button>
        </div>
      </aside>
    </div>
  );
}
