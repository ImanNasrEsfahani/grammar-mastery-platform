import Link from "next/link";
import { StatusPanel } from "@/components/ui/StatusPanel";

export function StaffSurface({
  title,
  description,
  resource,
  stage23 = false,
}: {
  title: string;
  description: string;
  resource: string;
  stage23?: boolean;
}) {
  return (
    <div className="staff-content stack">
      <header className="page-heading">
        <p className="eyebrow">Staff</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      <StatusPanel title="Server authorization is authoritative" tone="info">
        <p>UI visibility does not grant access. Django must return 403 unless the Stage 20 role matrix permits this resource.</p>
        <code>{resource}</code>
      </StatusPanel>
      {stage23 ? (
        <StatusPanel title="Import execution belongs to Stage 23" tone="warning">
          <p>This Stage 22 screen reserves the accessible UI boundary. Upload, parsing, validation, preview, deduplication and rollback are not simulated.</p>
        </StatusPanel>
      ) : null}
      <Link href="/staff/questions">Back to question bank</Link>
    </div>
  );
}
