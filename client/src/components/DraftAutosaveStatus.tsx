import { AlertCircle, Check, Loader2 } from "lucide-react";
import {
  draftStatusLabel,
  type DraftAutosaveStatus,
} from "@/hooks/useDraftAutosave";

type Props = {
  status: DraftAutosaveStatus;
  className?: string;
};

export function DraftAutosaveStatus({ status, className = "" }: Props) {
  const label = draftStatusLabel(status);
  if (!label) return null;
  const Icon =
    status === "saving" || status === "waiting"
      ? Loader2
      : status === "error"
        ? AlertCircle
        : Check;
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs ${status === "error" ? "text-destructive" : "text-muted-foreground"} ${className}`}
      role="status"
      aria-live="polite"
    >
      <Icon
        className={`h-3.5 w-3.5 ${status === "saving" || status === "waiting" ? "animate-spin" : ""}`}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}
