"use client";

import {useEffect, useState, type ReactNode} from "react";
import {PageSkeleton} from "./SkeletonSystem";
import styles from "./SkeletonSystem.module.css";

type ProgressivePhase = "quiet" | "announced" | "slow";

export function ProgressiveLoading({
  skeleton,
  label,
  slowLabel,
  retryLabel,
  onRetry,
  announceAfterMs = 900,
  slowAfterMs = 7000,
}: {
  skeleton?: ReactNode;
  label: string;
  slowLabel: string;
  retryLabel?: string;
  onRetry?: () => void | Promise<void>;
  announceAfterMs?: number;
  slowAfterMs?: number;
}) {
  const [phase, setPhase] = useState<ProgressivePhase>("quiet");
  const [retrying, setRetrying] = useState(false);
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    setPhase("quiet");
    const announceTimer = window.setTimeout(() => setPhase("announced"), Math.max(0, announceAfterMs));
    const slowTimer = window.setTimeout(() => setPhase("slow"), Math.max(announceAfterMs, slowAfterMs));
    return () => {
      window.clearTimeout(announceTimer);
      window.clearTimeout(slowTimer);
    };
  }, [announceAfterMs, slowAfterMs, cycle]);

  async function retry() {
    if (!onRetry || retrying) return;
    setRetrying(true);
    setCycle((value) => value + 1);
    try {
      await onRetry();
    } catch {
      // The owner action is responsible for rendering its error state.
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className={styles.progressive} aria-busy="true">
      {skeleton ?? <PageSkeleton label={label} />}
      {phase !== "quiet" ? (
        <div className={styles.progressiveFeedback} role="status" aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          <div>
            <strong>{phase === "slow" ? slowLabel : label}</strong>
            {phase === "slow" && onRetry && retryLabel ? (
              <button className={styles.retryButton} type="button" onClick={() => void retry()} disabled={retrying} aria-busy={retrying}>
                {retryLabel}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
