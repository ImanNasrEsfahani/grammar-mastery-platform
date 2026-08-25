import type {CSSProperties, ReactNode} from "react";
import styles from "./SkeletonSystem.module.css";

type Length = CSSProperties["width"];
type PageVariant = "generic" | "dashboard" | "lessons" | "review" | "progress" | "settings" | "builder";

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function SkeletonBlock({
  width = "100%",
  height = "1rem",
  radius = "0.65rem",
  className,
}: {
  width?: Length;
  height?: CSSProperties["height"];
  radius?: CSSProperties["borderRadius"];
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cx(styles.block, className)}
      style={{width, height, borderRadius: radius}}
    />
  );
}

export function SkeletonRegion({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className} aria-busy="true" aria-live="polite" aria-label={label}>
      {children}
      <span className={styles.visuallyHidden}>{label}</span>
    </section>
  );
}

export function CardSkeleton({compact = false}: {compact?: boolean}) {
  return (
    <div className={cx(styles.cardSkeleton, compact && styles.cardSkeletonCompact)} aria-hidden="true">
      <SkeletonBlock width="34%" height="0.75rem" />
      <SkeletonBlock width="72%" height={compact ? "1rem" : "1.25rem"} />
      <SkeletonBlock width="52%" height="0.8rem" />
    </div>
  );
}

export function CardGridSkeleton({count = 3}: {count?: number}) {
  const safeCount = Math.min(8, Math.max(1, Math.floor(count)));
  return (
    <div className={styles.cardGrid} aria-hidden="true">
      {Array.from({length: safeCount}, (_, index) => <CardSkeleton key={index} />)}
    </div>
  );
}

export function ListSkeleton({rows = 5, dense = false}: {rows?: number; dense?: boolean}) {
  const safeRows = Math.min(12, Math.max(1, Math.floor(rows)));
  return (
    <div className={styles.list} aria-hidden="true">
      {Array.from({length: safeRows}, (_, index) => (
        <div className={cx(styles.listRow, dense && styles.listRowDense)} key={index}>
          <div className={styles.listIdentity}>
            <SkeletonBlock width={dense ? 28 : 38} height={dense ? 28 : 38} radius="50%" />
            <div className={styles.listText}>
              <SkeletonBlock width={`${58 + (index % 3) * 9}%`} height="0.82rem" />
              <SkeletonBlock width={`${32 + (index % 2) * 12}%`} height="0.65rem" />
            </div>
          </div>
          <SkeletonBlock width={dense ? 72 : 108} height={dense ? "0.8rem" : "1rem"} />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({rows = 5, columns = 4}: {rows?: number; columns?: number}) {
  const safeRows = Math.min(12, Math.max(2, Math.floor(rows)));
  const safeColumns = Math.min(8, Math.max(2, Math.floor(columns)));
  const gridStyle = {"--skeleton-columns": safeColumns} as CSSProperties;
  return (
    <div className={styles.tableWrap} aria-hidden="true">
      <div className={cx(styles.tableRow, styles.tableHead)} style={gridStyle}>
        {Array.from({length: safeColumns}, (_, index) => (
          <SkeletonBlock key={index} width={index === 0 ? "64%" : "46%"} height="0.65rem" />
        ))}
      </div>
      {Array.from({length: safeRows - 1}, (_, rowIndex) => (
        <div className={styles.tableRow} style={gridStyle} key={rowIndex}>
          {Array.from({length: safeColumns}, (_, columnIndex) => (
            <SkeletonBlock
              key={columnIndex}
              width={`${48 + ((rowIndex + columnIndex) % 4) * 10}%`}
              height="0.78rem"
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton({bars = 7, compact = false}: {bars?: number; compact?: boolean}) {
  const safeBars = Math.min(14, Math.max(4, Math.floor(bars)));
  const heights = [46, 68, 54, 86, 62, 76, 50, 72, 58, 82, 64, 48, 74, 56];
  return (
    <div className={cx(styles.chart, compact && styles.chartCompact)} aria-hidden="true">
      <div className={styles.chartHeader}>
        <div className={styles.chartHeading}>
          <SkeletonBlock width={compact ? 110 : 148} height="0.9rem" />
          <SkeletonBlock width={compact ? 72 : 92} height="0.62rem" />
        </div>
        <SkeletonBlock width={compact ? 54 : 72} height="1.75rem" radius="999px" />
      </div>
      <div className={styles.chartPlot}>
        <span className={styles.chartGridLine} />
        <span className={styles.chartGridLine} />
        <span className={styles.chartGridLine} />
        <div className={styles.chartBars}>
          {Array.from({length: safeBars}, (_, index) => (
            <SkeletonBlock
              key={index}
              width="100%"
              height={`${heights[index] ?? 60}%`}
              radius="0.35rem 0.35rem 0.15rem 0.15rem"
              className={styles.chartBar}
            />
          ))}
        </div>
      </div>
      <div className={styles.chartLegend}>
        <SkeletonBlock width="21%" height="0.62rem" />
        <SkeletonBlock width="17%" height="0.62rem" />
        <SkeletonBlock width="24%" height="0.62rem" />
      </div>
    </div>
  );
}

export function RunnerSkeleton() {
  return (
    <SkeletonRegion label="Loading question" className={styles.runnerShell}>
      <div className={styles.runnerProgress} aria-hidden="true">
        <SkeletonBlock width="18%" height="0.7rem" />
        <SkeletonBlock width="100%" height="0.45rem" radius="999px" />
      </div>
      <div className={styles.runnerWorkspace}>
        <div className={styles.runnerMain} aria-hidden="true">
          <SkeletonBlock width="26%" height="0.72rem" />
          <SkeletonBlock width="88%" height="1.6rem" />
          <SkeletonBlock width="67%" height="1.15rem" />
          <div className={styles.runnerOptions}>
            {Array.from({length: 4}, (_, index) => (
              <div className={styles.runnerOption} key={index}>
                <SkeletonBlock width={30} height={30} radius="50%" />
                <SkeletonBlock width={`${54 + index * 8}%`} height="0.9rem" />
              </div>
            ))}
          </div>
          <div className={styles.runnerFooter}>
            <SkeletonBlock width={110} height="2.6rem" radius="0.8rem" />
            <SkeletonBlock width={150} height="2.6rem" radius="0.8rem" />
          </div>
        </div>
        <aside className={styles.runnerAside} aria-hidden="true">
          <SkeletonBlock width="55%" height="1rem" />
          <SkeletonBlock width={92} height={92} radius="50%" />
          <SkeletonBlock width="72%" height="0.72rem" />
          <SkeletonBlock width="60%" height="0.72rem" />
          <SkeletonBlock width="66%" height="0.72rem" />
        </aside>
      </div>
    </SkeletonRegion>
  );
}

function PageHeadingSkeleton() {
  return (
    <div className={styles.pageHeading} aria-hidden="true">
      <SkeletonBlock width="min(17rem, 55%)" height="1.9rem" />
      <SkeletonBlock width="min(34rem, 88%)" height="0.85rem" />
    </div>
  );
}

function ToolbarSkeleton() {
  return (
    <div className={styles.toolbar} aria-hidden="true">
      <SkeletonBlock width="min(22rem, 64%)" height="2.7rem" radius="0.85rem" />
      <div className={styles.toolbarActions}>
        <SkeletonBlock width={92} height="2.7rem" radius="0.85rem" />
        <SkeletonBlock width={112} height="2.7rem" radius="0.85rem" />
      </div>
    </div>
  );
}

export function PageSkeleton({
  variant = "generic",
  label = "Loading page",
}: {
  variant?: PageVariant;
  label?: string;
}) {
  if (variant === "review") {
    return (
      <SkeletonRegion label={label} className={styles.page}>
        <PageHeadingSkeleton />
        <ToolbarSkeleton />
        <div className={styles.twoColumn}>
          <div className={styles.mainSurface}><ListSkeleton rows={6} /></div>
          <div className={styles.sideStack}><CardSkeleton /><CardSkeleton /></div>
        </div>
      </SkeletonRegion>
    );
  }

  if (variant === "lessons") {
    return (
      <SkeletonRegion label={label} className={styles.page}>
        <PageHeadingSkeleton />
        <ToolbarSkeleton />
        <CardGridSkeleton count={3} />
        <div className={styles.mainSurface}><ListSkeleton rows={6} dense /></div>
      </SkeletonRegion>
    );
  }

  if (variant === "progress") {
    return (
      <SkeletonRegion label={label} className={styles.page}>
        <PageHeadingSkeleton />
        <CardGridSkeleton count={4} />
        <div className={styles.chartGrid}>
          <div className={styles.mainSurface}><ChartSkeleton bars={7} /></div>
          <div className={styles.mainSurface}><ListSkeleton rows={4} dense /></div>
        </div>
      </SkeletonRegion>
    );
  }

  if (variant === "settings") {
    return (
      <SkeletonRegion label={label} className={styles.page}>
        <PageHeadingSkeleton />
        <div className={styles.settingsLayout}>
          <nav className={styles.settingsNav} aria-hidden="true">
            {Array.from({length: 6}, (_, index) => <SkeletonBlock key={index} width={`${58 + (index % 3) * 12}%`} height="0.82rem" />)}
          </nav>
          <div className={styles.settingsPanel} aria-hidden="true">
            <SkeletonBlock width="34%" height="1.15rem" />
            {Array.from({length: 5}, (_, index) => (
              <div className={styles.settingsRow} key={index}>
                <div className={styles.settingsText}>
                  <SkeletonBlock width={`${44 + (index % 3) * 11}%`} height="0.82rem" />
                  <SkeletonBlock width={`${62 + (index % 2) * 14}%`} height="0.65rem" />
                </div>
                <SkeletonBlock width={index % 2 ? 120 : 48} height={index % 2 ? "2.35rem" : "1.55rem"} radius={index % 2 ? "0.7rem" : "999px"} />
              </div>
            ))}
          </div>
        </div>
      </SkeletonRegion>
    );
  }

  if (variant === "builder") {
    return (
      <SkeletonRegion label={label} className={styles.page}>
        <PageHeadingSkeleton />
        <CardGridSkeleton count={3} />
        <div className={styles.builderGrid}>
          <div className={styles.mainSurface}><ListSkeleton rows={5} dense /></div>
          <div className={styles.sideStack}><CardSkeleton /><CardSkeleton compact /></div>
        </div>
      </SkeletonRegion>
    );
  }

  if (variant === "dashboard") {
    return (
      <SkeletonRegion label={label} className={styles.page}>
        <PageHeadingSkeleton />
        <CardGridSkeleton count={3} />
        <div className={styles.dashboardGrid}>
          <div className={styles.mainSurface}><ChartSkeleton bars={7} /></div>
          <div className={styles.mainSurface}><ListSkeleton rows={5} dense /></div>
        </div>
      </SkeletonRegion>
    );
  }

  return (
    <SkeletonRegion label={label} className={styles.page}>
      <PageHeadingSkeleton />
      <ToolbarSkeleton />
      <CardGridSkeleton count={3} />
      <div className={styles.mainSurface}><ListSkeleton rows={4} /></div>
    </SkeletonRegion>
  );
}

export function LoadingButtonContent({label}: {label: string}) {
  return (
    <span className={styles.buttonLoading} role="status" aria-live="polite">
      <span className={styles.spinner} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function InlineSpinner({label}: {label: string}) {
  return (
    <span className={styles.inlineSpinner} role="status" aria-live="polite">
      <span className={styles.spinner} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
