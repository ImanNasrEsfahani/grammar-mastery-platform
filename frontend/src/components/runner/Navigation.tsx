import Link from "next/link";
import { memo } from "react";

export const Navigation = memo(function Navigation({
  exitHref,
  primaryLabel,
  primaryDisabled,
  busy,
  onPrimary,
  exitLabel,
}: {
  exitHref: string;
  primaryLabel: string;
  primaryDisabled: boolean;
  busy: boolean;
  onPrimary: () => void;
  exitLabel: string;
}) {
  return (
    <nav className="runner-navigation" aria-label="Question actions">
      <div className="runner-navigation-inner">
        <Link className="button button-quiet" href={exitHref}>{exitLabel}</Link>
        <button className="button button-primary" type="button" disabled={primaryDisabled || busy} aria-busy={busy} onClick={onPrimary}>
          {primaryLabel}
        </button>
      </div>
    </nav>
  );
});
