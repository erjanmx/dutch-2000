export type Rating = "again" | "hard" | "good" | "easy";
export type CardState = "learning" | "review";

export type ReviewRecord = {
  state: CardState;
  due: number;
  interval: number;
  ease: number;
  reviews: number;
  lapses: number;
  lastRating: Rating;
  lastReviewed: number;
};

export type DailyStats = {
  date: string;
  reviewed: number;
  correct: number;
  newSeen: number;
};

export type ExclusionChange = {
  excluded: boolean;
  updatedAt: number;
};

export type StudyStore = {
  version: 1;
  progress: Record<string, ReviewRecord>;
  excluded: Record<string, number>;
  exclusionChanges: Record<string, ExclusionChange>;
  newOrder: string[];
  daily: DailyStats;
  streak: number;
  lastStudyDate: string;
  totalReviews: number;
  resetAt: number;
  updatedAt: number;
};

export type Settings = {
  dailyNew: number;
};

export type SyncPayload = {
  deviceId?: string;
  updatedAt?: number;
  store?: Partial<StudyStore>;
  settings?: Partial<Settings>;
};

function newerRecord(
  current: ReviewRecord | undefined,
  candidate: ReviewRecord,
) {
  if (!current) return true;
  if (candidate.lastReviewed !== current.lastReviewed) {
    return candidate.lastReviewed > current.lastReviewed;
  }
  return candidate.reviews > current.reviews;
}

function mergeDaily(stores: StudyStore[]) {
  const latestDate = stores.reduce(
    (date, store) => (store.daily.date > date ? store.daily.date : date),
    "",
  );
  const sameDay = stores.filter((store) => store.daily.date === latestDate);

  return sameDay.reduce(
    (daily, store) => ({
      date: latestDate,
      reviewed: Math.max(daily.reviewed, store.daily.reviewed),
      correct: Math.max(daily.correct, store.daily.correct),
      newSeen: Math.max(daily.newSeen, store.daily.newSeen),
    }),
    { date: latestDate, reviewed: 0, correct: 0, newSeen: 0 },
  );
}

export function mergeStudyStores(stores: StudyStore[]): StudyStore {
  if (!stores.length) {
    throw new Error("At least one study store is required for a merge.");
  }

  const latest = stores.reduce((selected, store) =>
    store.updatedAt > selected.updatedAt ? store : selected,
  );
  const resetAt = Math.max(...stores.map((store) => store.resetAt));
  const progress: Record<string, ReviewRecord> = {};
  const exclusionChanges: Record<string, ExclusionChange> = {};

  for (const store of stores) {
    for (const [cardId, record] of Object.entries(store.progress)) {
      if (
        record.lastReviewed > resetAt &&
        newerRecord(progress[cardId], record)
      ) {
        progress[cardId] = record;
      }
    }

    for (const [cardId, change] of Object.entries(store.exclusionChanges)) {
      if (change.updatedAt <= resetAt) continue;
      const current = exclusionChanges[cardId];
      if (
        !current ||
        change.updatedAt > current.updatedAt ||
        (change.updatedAt === current.updatedAt && !change.excluded)
      ) {
        exclusionChanges[cardId] = change;
      }
    }
  }

  const excluded = Object.fromEntries(
    Object.entries(exclusionChanges)
      .filter(([, change]) => change.excluded)
      .map(([cardId, change]) => [cardId, change.updatedAt]),
  );

  return {
    ...latest,
    progress,
    excluded,
    exclusionChanges,
    daily: mergeDaily(stores),
    streak: Math.max(...stores.map((store) => store.streak)),
    lastStudyDate: stores.reduce(
      (date, store) =>
        store.lastStudyDate > date ? store.lastStudyDate : date,
      "",
    ),
    totalReviews: Object.values(progress).reduce(
      (total, record) => total + record.reviews,
      0,
    ),
    resetAt,
    updatedAt: Math.max(...stores.map((store) => store.updatedAt)),
  };
}

export function newestSettings(
  payloads: Array<{
    settings: Settings;
    updatedAt: number;
  }>,
) {
  return payloads.reduce((latest, payload) =>
    payload.updatedAt > latest.updatedAt ? payload : latest,
  ).settings;
}
