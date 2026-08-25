import {memo} from "react";

export const Progress = memo(function Progress({
  current,
  total,
  completed,
  label,
}: {
  current: number;
  total?: number;
  completed?: number;
  label: string;
}) {
  const hasTotal = typeof total === "number" && total > 0;
  const safeCompleted = hasTotal ? Math.min(total, Math.max(0, completed ?? current - 1)) : 0;
  const valueText = hasTotal ? `${label} ${current} / ${total}` : `${label} ${current}`;
  const percent = hasTotal ? Math.round((safeCompleted / total) * 100) : null;

  return (
    <div className="runner-progress">
      <span className="runner-progress-label">{valueText}{percent === null ? "" : ` · ${percent}%`}</span>
      {hasTotal ? (
        <progress aria-label={valueText} value={safeCompleted} max={total} />
      ) : (
        <span className="progress-rule" aria-hidden="true" />
      )}
    </div>
  );
});
