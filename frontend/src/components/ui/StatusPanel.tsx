import {InlineAlert, type FeedbackAction, type FeedbackTone} from "./FeedbackSystem";

type StatusTone = "info" | "success" | "warning" | "danger";

function mapTone(tone: StatusTone): FeedbackTone {
  return tone === "danger" ? "error" : tone;
}

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
  let feedbackAction: FeedbackAction | undefined;
  if (action?.href) feedbackAction = {label: action.label, href: action.href};
  else if (action?.onClick) feedbackAction = {label: action.label, onClick: action.onClick};

  return (
    <InlineAlert
      tone={mapTone(tone)}
      label={title}
      action={feedbackAction}
      requestId={requestId}
    >
      {children}
    </InlineAlert>
  );
}
