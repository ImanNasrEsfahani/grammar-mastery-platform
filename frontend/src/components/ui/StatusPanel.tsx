import Link from "next/link";

type StatusTone = "info" | "success" | "warning" | "danger";

export function StatusPanel({
  title,
  children,
  tone = "info",
  action,
  requestId,
}: {
  title: string;
  children: React.ReactNode;
  tone?: StatusTone;
  action?: {label: string; href?: string; onClick?: () => void};
  requestId?: string;
}) {
  return (
    <section className={`status-panel status-${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <div className="status-icon" aria-hidden="true">
        {tone === "success" ? "✓" : tone === "danger" ? "!" : tone === "warning" ? "↻" : "i"}
      </div>
      <div className="stack stack-small">
        <h2 className="status-title">{title}</h2>
        <div>{children}</div>
        {requestId ? <code className="request-id">{requestId}</code> : null}
        {action?.href ? (
          <Link className="button button-secondary" href={action.href}>{action.label}</Link>
        ) : action?.onClick ? (
          <button className="button button-secondary" type="button" onClick={action.onClick}>{action.label}</button>
        ) : null}
      </div>
    </section>
  );
}
