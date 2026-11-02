"use client";

export function RakkauNotice({
  variant,
  title,
  children,
  onDismiss,
}: {
  variant: "error" | "ok" | "info";
  title: string;
  children: React.ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div className={`rk-notice rk-notice--${variant}`} role="alert">
      <div className="rk-notice-body">
        <p className="rk-notice-title">{title}</p>
        <p className="rk-notice-text">{children}</p>
      </div>
      {onDismiss && (
        <button
          type="button"
          className="rk-notice-dismiss"
          onClick={onDismiss}
          aria-label="Cerrar aviso"
        >
          ×
        </button>
      )}
    </div>
  );
}
