import {CardSkeleton, SkeletonRegion} from "./SkeletonSystem";
import styles from "./SkeletonSystem.module.css";

export function LoadingCard({label}: {label: string}) {
  return (
    <SkeletonRegion label={label} className={styles.loadingCard}>
      <CardSkeleton />
    </SkeletonRegion>
  );
}
