import { memo } from "react";

export const Progress = memo(function Progress({
  current,
  total,
  label,
}: {
  current: number;
  total?: number;
  label: string;
}) {
  const hasTotal = typeof total === "number" && total > 0;
  const valueText = hasTotal ? `${label} ${current} / ${total}` : `${label} ${current}`;

  return (
    <div className="runner-progress">
      <span className="runner-progress-label">{valueText}</span>
      {hasTotal ? (
        <progress aria-label={valueText} value={current} max={total} />
      ) : (
        <span className="progress-rule" aria-hidden="true" />
      )}
    </div>
  );
});
