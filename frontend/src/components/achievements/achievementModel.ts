export const ACHIEVEMENT_MODEL_VERSION = "achievements-ui-v1.0.0";

export type MilestoneCategory = "streak" | "mastery" | "improvement" | "consistency";
export type MilestoneTone = "blue" | "green" | "amber" | "violet";

export type AchievementMetricSnapshot = {
  streakDays: number;
  masteredScopes: number;
  masteredCategories: number;
  overallMastery: number | null;
  recentAccuracy: number | null;
  recentQuestionCount: number | null;
  recentCompletedAt: string | null;
  completedSessions: number;
  questionsAnswered: number;
  lessonEvidenceCount: number;
  bestImprovement: number;
};

export type MilestoneView = {
  id: string;
  category: MilestoneCategory;
  tone: MilestoneTone;
  icon: string;
  name: string;
  description: string;
  current: string;
  progress: number;
  completed: boolean;
  completedAt: string | null;
};

type MilestoneDefinition = {
  id: string;
  category: MilestoneCategory;
  tone: MilestoneTone;
  icon: string;
  name: string;
  descriptionFa: string;
  descriptionEn: string;
  progress: (metrics: AchievementMetricSnapshot) => number;
  completed: (metrics: AchievementMetricSnapshot) => boolean;
  current: (metrics: AchievementMetricSnapshot, isFa: boolean) => string;
  completedAt?: (metrics: AchievementMetricSnapshot) => string | null;
};

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function ratioProgress(value: number, target: number) {
  return clampPercent((Math.max(0, value) / target) * 100);
}

function formatNumber(value: number, isFa: boolean) {
  return new Intl.NumberFormat(isFa ? "fa-IR" : "en-CA", {
    maximumFractionDigits: 0,
  }).format(Math.max(0, Math.round(value)));
}

const MILESTONES: MilestoneDefinition[] = [
  {
    id: "start-strong",
    category: "streak",
    tone: "green",
    icon: "✓",
    name: "شروع قدرتمند",
    descriptionFa: "اولین تمرین کامل",
    descriptionEn: "Complete your first practice session",
    progress: (m) => ratioProgress(m.completedSessions, 1),
    completed: (m) => m.completedSessions >= 1,
    current: (m, isFa) => isFa ? `${formatNumber(m.completedSessions, true)} جلسه کامل` : `${formatNumber(m.completedSessions, false)} completed session${m.completedSessions === 1 ? "" : "s"}`,
    completedAt: (m) => m.completedSessions >= 1 ? m.recentCompletedAt : null,
  },
  {
    id: "streak-7",
    category: "streak",
    tone: "amber",
    icon: "◒",
    name: "۷ روز متوالی",
    descriptionFa: "۷ روز تمرین بدون وقفه",
    descriptionEn: "Practice for 7 consecutive days",
    progress: (m) => ratioProgress(m.streakDays, 7),
    completed: (m) => m.streakDays >= 7,
    current: (m, isFa) => isFa ? `${formatNumber(m.streakDays, true)} / ۷ روز` : `${formatNumber(m.streakDays, false)} / 7 days`,
  },
  {
    id: "consistency-14",
    category: "streak",
    tone: "amber",
    icon: "◷",
    name: "Consistency 14",
    descriptionFa: "۱۴ روز تمرین پیوسته",
    descriptionEn: "Maintain a 14-day learning streak",
    progress: (m) => ratioProgress(m.streakDays, 14),
    completed: (m) => m.streakDays >= 14,
    current: (m, isFa) => isFa ? `${formatNumber(m.streakDays, true)} / ۱۴ روز` : `${formatNumber(m.streakDays, false)} / 14 days`,
  },
  {
    id: "accuracy-master",
    category: "mastery",
    tone: "blue",
    icon: "◎",
    name: "Accuracy Master",
    descriptionFa: "دقت ۹۰٪ یا بیشتر در آخرین سنجش معتبر",
    descriptionEn: "Reach 90%+ accuracy in the latest valid assessment",
    progress: (m) => ratioProgress(m.recentAccuracy ?? m.overallMastery ?? 0, 90),
    completed: (m) => (m.recentAccuracy ?? m.overallMastery ?? 0) >= 90,
    current: (m, isFa) => {
      const value = m.recentAccuracy ?? m.overallMastery;
      if (value === null) return isFa ? "بدون شواهد کافی" : "Not enough evidence";
      return `${formatNumber(value, isFa)}%`;
    },
  },
  {
    id: "mastery-builder",
    category: "mastery",
    tone: "green",
    icon: "↑",
    name: "Mastery Builder",
    descriptionFa: "۵ زیرحوزه یا درس با تسلط ۸۰٪+",
    descriptionEn: "Build 80%+ mastery in 5 evidence-bearing scopes",
    progress: (m) => ratioProgress(m.masteredScopes, 5),
    completed: (m) => m.masteredScopes >= 5,
    current: (m, isFa) => isFa ? `${formatNumber(m.masteredScopes, true)} / ۵` : `${formatNumber(m.masteredScopes, false)} / 5`,
  },
  {
    id: "category-master",
    category: "mastery",
    tone: "violet",
    icon: "◇",
    name: "Category Master",
    descriptionFa: "تسلط ۸۰٪+ در یک Category با شواهد معتبر",
    descriptionEn: "Reach 80%+ mastery in one evidence-bearing category",
    progress: (m) => ratioProgress(m.masteredCategories, 1),
    completed: (m) => m.masteredCategories >= 1,
    current: (m, isFa) => isFa ? `${formatNumber(m.masteredCategories, true)} Category` : `${formatNumber(m.masteredCategories, false)} categor${m.masteredCategories === 1 ? "y" : "ies"}`,
  },
  {
    id: "improvement-5",
    category: "improvement",
    tone: "blue",
    icon: "↗",
    name: "Progress +5",
    descriptionFa: "حداقل ۵ واحد بهبود ثبت‌شده در روند یا mastery",
    descriptionEn: "Record at least a 5-point improvement in trend or mastery",
    progress: (m) => ratioProgress(m.bestImprovement, 5),
    completed: (m) => m.bestImprovement >= 5,
    current: (m, isFa) => `+${formatNumber(m.bestImprovement, isFa)}%`,
  },
  {
    id: "improvement-10",
    category: "improvement",
    tone: "green",
    icon: "↟",
    name: "Momentum +10",
    descriptionFa: "حداقل ۱۰ واحد بهبود ثبت‌شده",
    descriptionEn: "Record at least a 10-point improvement",
    progress: (m) => ratioProgress(m.bestImprovement, 10),
    completed: (m) => m.bestImprovement >= 10,
    current: (m, isFa) => `+${formatNumber(m.bestImprovement, isFa)}%`,
  },
  {
    id: "improvement-18",
    category: "improvement",
    tone: "violet",
    icon: "✦",
    name: "Breakthrough +18",
    descriptionFa: "بهترین بهبود ثبت‌شده به ۱۸ واحد یا بیشتر برسد",
    descriptionEn: "Reach an 18-point or greater recorded improvement",
    progress: (m) => ratioProgress(m.bestImprovement, 18),
    completed: (m) => m.bestImprovement >= 18,
    current: (m, isFa) => `+${formatNumber(m.bestImprovement, isFa)}%`,
  },
  {
    id: "lesson-explorer",
    category: "consistency",
    tone: "violet",
    icon: "▣",
    name: "Lesson Explorer",
    descriptionFa: "برای ۱۰ درس شواهد یادگیری ثبت شود",
    descriptionEn: "Build learning evidence across 10 lessons",
    progress: (m) => ratioProgress(m.lessonEvidenceCount, 10),
    completed: (m) => m.lessonEvidenceCount >= 10,
    current: (m, isFa) => isFa ? `${formatNumber(m.lessonEvidenceCount, true)} / ۱۰ درس` : `${formatNumber(m.lessonEvidenceCount, false)} / 10 lessons`,
  },
  {
    id: "perfect-session",
    category: "consistency",
    tone: "blue",
    icon: "★",
    name: "Perfect Session",
    descriptionFa: "۱۰۰٪ دقت در یک جلسه با حداقل ۲۰ سؤال",
    descriptionEn: "Score 100% in a session with at least 20 questions",
    progress: (m) => {
      const accuracyProgress = ratioProgress(m.recentAccuracy ?? 0, 100);
      const sizeProgress = ratioProgress(m.recentQuestionCount ?? 0, 20);
      return Math.min(accuracyProgress, sizeProgress);
    },
    completed: (m) => (m.recentAccuracy ?? 0) >= 100 && (m.recentQuestionCount ?? 0) >= 20,
    current: (m, isFa) => {
      const accuracy = m.recentAccuracy;
      const questions = m.recentQuestionCount;
      if (accuracy === null && questions === null) return isFa ? "بدون جلسه کامل ثبت‌شده" : "No completed session evidence";
      return `${accuracy === null ? "—" : `${formatNumber(accuracy, isFa)}%`} · ${questions === null ? "—" : formatNumber(questions, isFa)} ${isFa ? "سؤال" : "questions"}`;
    },
    completedAt: (m) => ((m.recentAccuracy ?? 0) >= 100 && (m.recentQuestionCount ?? 0) >= 20) ? m.recentCompletedAt : null,
  },
  {
    id: "steady-practice",
    category: "consistency",
    tone: "green",
    icon: "◆",
    name: "Steady Practice",
    descriptionFa: "۱۰ جلسه تمرین کامل",
    descriptionEn: "Complete 10 practice sessions",
    progress: (m) => ratioProgress(m.completedSessions, 10),
    completed: (m) => m.completedSessions >= 10,
    current: (m, isFa) => isFa ? `${formatNumber(m.completedSessions, true)} / ۱۰ جلسه` : `${formatNumber(m.completedSessions, false)} / 10 sessions`,
  },
];

const ACHIEVEMENT_TRACKS: Array<{
  metric: (metrics: AchievementMetricSnapshot) => number;
  thresholds: number[];
}> = [
  {
    metric: (m) => m.streakDays,
    thresholds: [1, 2, 3, 5, 7, 10, 14, 21, 30, 45, 60, 90],
  },
  {
    metric: (m) => m.overallMastery ?? 0,
    thresholds: [10, 20, 30, 40, 50, 60, 65, 70, 75, 80, 90, 95],
  },
  {
    metric: (m) => m.bestImprovement,
    thresholds: [1, 2, 3, 5, 7, 10, 12, 15, 18, 20, 25, 30],
  },
  {
    metric: (m) => m.completedSessions,
    thresholds: [1, 2, 3, 5, 7, 10, 15, 20, 30, 50, 75, 100],
  },
];

export const TOTAL_ACHIEVEMENT_MARKERS = ACHIEVEMENT_TRACKS.reduce(
  (sum, track) => sum + track.thresholds.length,
  0,
);

export const TOTAL_MILESTONES = MILESTONES.length;

export function countAchievementMarkers(metrics: AchievementMetricSnapshot) {
  return ACHIEVEMENT_TRACKS.reduce((sum, track) => {
    const value = Math.max(0, track.metric(metrics));
    return sum + track.thresholds.filter((threshold) => value >= threshold).length;
  }, 0);
}

export function buildMilestones(metrics: AchievementMetricSnapshot, isFa: boolean): MilestoneView[] {
  return MILESTONES.map((definition) => ({
    id: definition.id,
    category: definition.category,
    tone: definition.tone,
    icon: definition.icon,
    name: definition.name,
    description: isFa ? definition.descriptionFa : definition.descriptionEn,
    current: definition.current(metrics, isFa),
    progress: clampPercent(definition.progress(metrics)),
    completed: definition.completed(metrics),
    completedAt: definition.completedAt?.(metrics) ?? null,
  }));
}
