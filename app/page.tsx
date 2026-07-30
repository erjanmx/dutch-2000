"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import rawDeck from "./data/deck.json";

type Rating = "again" | "hard" | "good" | "easy";
type CardState = "learning" | "review";

type VerbDetails = {
  infinitive: string;
  present: string;
  past: string;
  participle: string;
  auxiliary: string;
  perfect: string;
};

type Card = {
  id: string;
  rank: number;
  word: string;
  dutch: string;
  english: string;
  pos: string;
  frequency: number;
  article?: string;
  verb?: VerbDetails;
};

type ReviewRecord = {
  state: CardState;
  due: number;
  interval: number;
  ease: number;
  reviews: number;
  lapses: number;
  lastRating: Rating;
  lastReviewed: number;
};

type DailyStats = {
  date: string;
  reviewed: number;
  correct: number;
  newSeen: number;
};

type StudyStore = {
  version: 1;
  progress: Record<string, ReviewRecord>;
  excluded: Record<string, number>;
  newOrder: string[];
  daily: DailyStats;
  streak: number;
  lastStudyDate: string;
  totalReviews: number;
};

type Settings = {
  dailyNew: number;
};

const deck = rawDeck as Card[];
const cardById = new Map(deck.map((card) => [card.id, card]));
const PROGRESS_KEY = "dutch2000.progress.v1";
const SETTINGS_KEY = "dutch2000.settings.v1";
const DAY = 86_400_000;
const MINUTE = 60_000;
const EMPTY_PROGRESS: Record<string, ReviewRecord> = {};
const EMPTY_EXCLUDED: Record<string, number> = {};

const defaultStore = (): StudyStore => ({
  version: 1,
  progress: {},
  excluded: {},
  newOrder: [],
  daily: {
    date: localDateKey(),
    reviewed: 0,
    correct: 0,
    newSeen: 0,
  },
  streak: 0,
  lastStudyDate: "",
  totalReviews: 0,
});

const defaultSettings: Settings = {
  dailyNew: 40,
};

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function yesterdayKey() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return localDateKey(date);
}

function freshDaily(daily: DailyStats): DailyStats {
  const today = localDateKey();
  return daily.date === today
    ? daily
    : { date: today, reviewed: 0, correct: 0, newSeen: 0 };
}

function shuffledDeckIds() {
  const ids = deck.map((card) => card.id);
  for (let index = ids.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [ids[index], ids[swapIndex]] = [ids[swapIndex], ids[index]];
  }
  return ids;
}

function normalizeOrder(value: unknown) {
  const validIds = new Set(deck.map((card) => card.id));
  const seen = new Set<string>();
  const saved = Array.isArray(value)
    ? value.filter((id): id is string => {
        if (typeof id !== "string" || !validIds.has(id) || seen.has(id)) {
          return false;
        }
        seen.add(id);
        return true;
      })
    : [];
  const missing = shuffledDeckIds().filter((id) => !seen.has(id));
  return [...saved, ...missing];
}

function normalizeStore(value: Partial<StudyStore> | null): StudyStore {
  const fallback = defaultStore();
  if (
    !value ||
    value.version !== 1 ||
    typeof value.progress !== "object" ||
    value.progress === null
  ) {
    return { ...fallback, newOrder: shuffledDeckIds() };
  }
  return {
    ...fallback,
    ...value,
    daily: freshDaily(value.daily ?? fallback.daily),
    progress: value.progress,
    excluded:
      typeof value.excluded === "object" && value.excluded !== null
        ? value.excluded
        : {},
    newOrder: normalizeOrder(value.newOrder),
  };
}

function safeLoadStore(): StudyStore {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return normalizeStore(null);
    return normalizeStore(JSON.parse(raw) as Partial<StudyStore>);
  } catch {
    return normalizeStore(null);
  }
}

function safeLoadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings;
    return { ...defaultSettings, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return defaultSettings;
  }
}

function formatInterval(days: number) {
  if (days < 1 / 24) return `${Math.max(1, Math.round(days * 24 * 60))}m`;
  if (days < 1) return `${Math.max(1, Math.round(days * 24))}h`;
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

function nextInterval(record: ReviewRecord | undefined, rating: Rating) {
  if (!record) {
    return { again: 1 / 1440, hard: 10 / 1440, good: 1, easy: 45 }[rating];
  }
  if (rating === "again") return 10 / 1440;
  if (rating === "hard") return Math.max(1, record.interval * 1.2);
  if (rating === "good") return Math.max(1, record.interval * record.ease);
  return Math.max(4, record.interval * record.ease * 1.3);
}

function schedule(
  previous: ReviewRecord | undefined,
  rating: Rating,
  now: number,
): ReviewRecord {
  const interval = nextInterval(previous, rating);
  const isLapse = rating === "again";
  const ease = previous?.ease ?? 2.5;
  const nextEase =
    rating === "again"
      ? Math.max(1.3, ease - 0.2)
      : rating === "hard"
        ? Math.max(1.3, ease - 0.15)
        : rating === "easy"
          ? Math.min(3, ease + 0.15)
          : ease;

  return {
    state: rating === "again" || rating === "hard" ? "learning" : "review",
    due: now + interval * DAY,
    interval,
    ease: nextEase,
    reviews: (previous?.reviews ?? 0) + 1,
    lapses: (previous?.lapses ?? 0) + (isLapse ? 1 : 0),
    lastRating: rating,
    lastReviewed: now,
  };
}

export default function Home() {
  const [store, setStore] = useState<StudyStore | null>(null);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [revealedCardId, setRevealedCardId] = useState<string | null>(null);
  const [panel, setPanel] = useState<"progress" | "settings" | null>(null);
  const [notice, setNotice] = useState("");
  const [undoRemovedId, setUndoRemovedId] = useState<string | null>(null);
  const [clock, setClock] = useState(Date.now());
  const revealButton = useRef<HTMLButtonElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const noticeTimer = useRef<number | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setStore(safeLoadStore());
      setSettings(safeLoadSettings());
    });
    const timer = window.setInterval(() => setClock(Date.now()), MINUTE);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(timer);
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!store) return;
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(store));
  }, [store]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  const daily = store ? freshDaily(store.daily) : defaultStore().daily;
  const progress = store?.progress ?? EMPTY_PROGRESS;
  const excluded = store?.excluded ?? EMPTY_EXCLUDED;
  const activeDeckLength = deck.length - Object.keys(excluded).length;
  const dueCards = useMemo(
    () =>
      deck
        .filter(
          (card) => !excluded[card.id] && progress[card.id]?.due <= clock,
        )
        .sort((a, b) => progress[a.id].due - progress[b.id].due),
    [clock, excluded, progress],
  );
  const newBudget = Math.max(0, settings.dailyNew - daily.newSeen);
  const unseenCount = deck.filter(
    (card) => !excluded[card.id] && !progress[card.id],
  ).length;
  const sessionNewRemaining = Math.min(newBudget, unseenCount);
  const nextNewCard =
    sessionNewRemaining > 0
      ? store?.newOrder
          .map((id) => cardById.get(id))
          .find(
            (card): card is Card =>
              Boolean(card && !excluded[card.id] && !progress[card.id]),
          )
      : undefined;
  const currentCard = dueCards[0] ?? nextNewCard;
  const currentRecord = currentCard ? progress[currentCard.id] : undefined;
  const isNew = Boolean(currentCard && !currentRecord);
  const revealed = Boolean(currentCard && revealedCardId === currentCard.id);

  const activeRecords = Object.entries(progress).filter(
    ([cardId]) => !excluded[cardId],
  );
  const learned = activeRecords.length;
  const secured = activeRecords.filter(([, record]) => record.interval >= 21)
    .length;
  const learning = learned - secured;
  const excludedCards = Object.entries(excluded)
    .sort(([, removedAtA], [, removedAtB]) => removedAtB - removedAtA)
    .map(([cardId]) => cardById.get(cardId))
    .filter((card): card is Card => Boolean(card));
  const accuracy = daily.reviewed
    ? Math.round((daily.correct / daily.reviewed) * 100)
    : 0;
  const sessionRemaining = dueCards.length + sessionNewRemaining;
  const sessionTotal = daily.reviewed + sessionRemaining;
  const sessionProgress = sessionTotal
    ? Math.min(100, (daily.reviewed / sessionTotal) * 100)
    : 100;

  useEffect(() => {
    window.requestAnimationFrame(() => revealButton.current?.focus());
  }, [currentCard?.id]);

  function showNotice(
    message: string,
    options: { duration?: number; undoId?: string | null } = {},
  ) {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    setNotice(message);
    setUndoRemovedId(options.undoId ?? null);
    noticeTimer.current = window.setTimeout(() => {
      setNotice("");
      setUndoRemovedId(null);
    }, options.duration ?? 2400);
  }

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (panel || !currentCard) return;
      const target = event.target as HTMLElement;
      if (["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(target.tagName)) {
        return;
      }
      if (event.code === "Space" && !revealed) {
        event.preventDefault();
        setRevealedCardId(currentCard.id);
      }
      if (revealed && ["1", "2", "3", "4"].includes(event.key)) {
        event.preventDefault();
        const ratings: Rating[] = ["again", "hard", "good", "easy"];
        rateCard(ratings[Number(event.key) - 1]);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  function rateCard(rating: Rating) {
    if (!currentCard || !store) return;
    const now = Date.now();
    const previous = store.progress[currentCard.id];
    const today = freshDaily(store.daily);
    const nextStreak =
      store.lastStudyDate === today.date
        ? store.streak
        : store.lastStudyDate === yesterdayKey()
          ? store.streak + 1
          : 1;

    setStore({
      ...store,
      progress: {
        ...store.progress,
        [currentCard.id]: schedule(previous, rating, now),
      },
      daily: {
        ...today,
        reviewed: today.reviewed + 1,
        correct: today.correct + (rating === "again" ? 0 : 1),
        newSeen: today.newSeen + (previous ? 0 : 1),
      },
      streak: nextStreak,
      lastStudyDate: today.date,
      totalReviews: store.totalReviews + 1,
    });
    setRevealedCardId(null);
    showNotice(
      rating === "easy" && !previous
        ? "Known — this card will return in 45 days."
        : "",
    );
  }

  function removeCard(card: Card) {
    if (!store) return;
    setStore({
      ...store,
      excluded: {
        ...store.excluded,
        [card.id]: Date.now(),
      },
    });
    setRevealedCardId(null);
    showNotice(`${card.dutch} removed from practice.`, {
      duration: 5000,
      undoId: card.id,
    });
  }

  function restoreCard(cardId: string) {
    if (!store) return;
    const restoredCard = cardById.get(cardId);
    const nextExcluded = { ...store.excluded };
    delete nextExcluded[cardId];
    setStore({ ...store, excluded: nextExcluded });
    showNotice(
      restoredCard
        ? `${restoredCard.dutch} restored to practice.`
        : "Word restored to practice.",
    );
  }

  function reshuffleUnseen() {
    if (!store) return;
    setStore({ ...store, newOrder: shuffledDeckIds() });
    showNotice("Unseen words reshuffled.");
  }

  function exportProgress() {
    if (!store) return;
    const payload = JSON.stringify(
      { exportedAt: new Date().toISOString(), store, settings },
      null,
      2,
    );
    const url = URL.createObjectURL(
      new Blob([payload], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `woordvooruit-backup-${localDateKey()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showNotice("Progress backup exported.");
  }

  function importProgress(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    file
      .text()
      .then((text) => {
        const parsed = JSON.parse(text) as {
          store?: StudyStore;
          settings?: Settings;
        };
        if (parsed.store?.version !== 1 || !parsed.store.progress) {
          throw new Error("Invalid backup");
        }
        setStore(normalizeStore(parsed.store));
        if (parsed.settings) {
          setSettings({ ...defaultSettings, ...parsed.settings });
        }
        showNotice("Progress restored.");
        setPanel(null);
      })
      .catch(() =>
        showNotice("That file is not a valid Woord Vooruit backup."),
      );
    event.target.value = "";
  }

  function resetProgress() {
    if (
      !window.confirm(
        "Reset every card, restore removed words, and erase your study history?",
      )
    ) {
      return;
    }
    setStore(normalizeStore(null));
    showNotice("Progress reset.");
    setPanel(null);
  }

  if (!store) {
    return (
      <main className="loading-shell" aria-label="Loading your Dutch deck">
        <div className="loading-mark">W</div>
        <p>Preparing your Dutch deck…</p>
      </main>
    );
  }

  const ratings: { rating: Rating; label: string; key: number }[] = [
    { rating: "again", label: "Again", key: 1 },
    { rating: "hard", label: "Hard", key: 2 },
    { rating: "good", label: "Good", key: 3 },
    { rating: "easy", label: isNew ? "Know it" : "Easy", key: 4 },
  ];

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Woord Vooruit home">
          <span className="brand-mark" aria-hidden="true">
            W
          </span>
          <span>
            <strong>Woord Vooruit</strong>
            <small>Dutch, one card at a time</small>
          </span>
        </a>
        <nav className="top-actions" aria-label="Deck controls">
          <button className="text-button" onClick={() => setPanel("progress")}>
            My progress
          </button>
          <button
            className="icon-button"
            onClick={() => setPanel("settings")}
            aria-label="Open study settings"
          >
            <span aria-hidden="true">•••</span>
          </button>
        </nav>
      </header>

      <section className="study-wrap">
        <div className="study-heading">
          <div>
            <p className="eyebrow">TODAY&apos;S SESSION</p>
            <h1>{currentCard ? "Ready when you are." : "You’re done for now."}</h1>
          </div>
          <div className="streak-chip" title="Current study streak">
            <span aria-hidden="true">◇</span>
            <strong>{store.streak}</strong> day streak
          </div>
        </div>

        <div className="stat-strip" aria-label="Study overview">
          <div>
            <span className="stat-dot due-dot" />
            <strong>{dueCards.length}</strong>
            <small>due now</small>
          </div>
          <div>
            <span className="stat-dot new-dot" />
            <strong>{sessionNewRemaining}</strong>
            <small>new left</small>
          </div>
          <div>
            <span className="stat-dot known-dot" />
            <strong>{secured}</strong>
            <small>secured</small>
          </div>
          <div className="accuracy-stat">
            <strong>{accuracy || "—"}{accuracy ? "%" : ""}</strong>
            <small>today&apos;s recall</small>
          </div>
        </div>

        <div className="session-track" aria-label={`${Math.round(sessionProgress)}% of session complete`}>
          <span style={{ width: `${sessionProgress}%` }} />
        </div>

        {currentCard ? (
          <>
            <article
              className={`flashcard ${revealed ? "is-revealed" : ""}`}
              aria-live="polite"
            >
              <div className="card-meta">
                <span>
                  WORD {currentCard.rank.toLocaleString()} OF 2,000
                </span>
                <div className="card-meta-actions">
                  <button
                    className="remove-card-button"
                    onClick={() => removeCard(currentCard)}
                    aria-label={`Remove ${currentCard.dutch} from practice`}
                  >
                    Remove
                  </button>
                  <span className="pos-pill">{currentCard.pos}</span>
                </div>
              </div>

              <div className="prompt-side">
                <p className="recall-label">
                  {currentCard.pos === "noun"
                    ? "Recall the article and English meaning"
                    : currentCard.pos === "verb"
                      ? "Recall the meaning and three forms"
                      : "Recall the English meaning"}
                </p>
                <h2 lang="nl">
                  {currentCard.pos === "noun" && !revealed
                    ? currentCard.word
                    : currentCard.dutch}
                </h2>
                {!revealed && (
                  <p className="soft-hint">Say it aloud before revealing.</p>
                )}
              </div>

              {revealed && (
                <div className="answer-side">
                  <div className="answer-rule">
                    <span>ENGLISH</span>
                  </div>
                  <p className="translation">{currentCard.english}</p>

                  {currentCard.verb && (
                    <div className="verb-grid">
                      <div>
                        <small>PRESENT</small>
                        <strong lang="nl">{currentCard.verb.present}</strong>
                      </div>
                      <div>
                        <small>PAST</small>
                        <strong lang="nl">{currentCard.verb.past}</strong>
                      </div>
                      <div>
                        <small>PERFECT</small>
                        <strong lang="nl">{currentCard.verb.perfect}</strong>
                      </div>
                      <div className="auxiliary-note">
                        <small>AUXILIARY</small>
                        <strong lang="nl">{currentCard.verb.auxiliary}</strong>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </article>

            {!revealed ? (
              <button
                ref={revealButton}
                className="reveal-button"
                onClick={() => setRevealedCardId(currentCard.id)}
              >
                Show answer <kbd>Space</kbd>
              </button>
            ) : (
              <div className="rating-grid" aria-label="Rate your recall">
                {ratings.map(({ rating, label, key }) => (
                  <button
                    key={rating}
                    className={`rating-button ${rating}`}
                    onClick={() => rateCard(rating)}
                  >
                    <span>{label}</span>
                    <small>{formatInterval(nextInterval(currentRecord, rating))}</small>
                    <kbd>{key}</kbd>
                  </button>
                ))}
              </div>
            )}

            <div className="placement-note">
              <span className="mix-icon" aria-hidden="true">↝</span>
              <p>
                <strong>New words are shuffled.</strong>{" "}
                Your random order stays on this device, while due reviews still
                appear on schedule.
              </p>
              <button onClick={reshuffleUnseen}>Shuffle again</button>
            </div>
          </>
        ) : (
          <section className="complete-card">
            <span className="complete-mark" aria-hidden="true">✓</span>
            <p className="eyebrow">SESSION COMPLETE</p>
            <h2>Mooi gedaan.</h2>
            <p>
              You reviewed {daily.reviewed} cards today with{" "}
              {accuracy || 0}% recall. The next card will appear when it is due.
            </p>
            <button
              className="secondary-button"
              onClick={() =>
                setSettings((value) => ({
                  ...value,
                  dailyNew: Math.min(100, value.dailyNew + 10),
                }))
              }
            >
              Add 10 new cards
            </button>
          </section>
        )}
      </section>

      <footer className="footer">
        <p>
          2,000 conversational Dutch lemmas · progress stays on this device
        </p>
        <button onClick={() => setPanel("progress")}>Deck & sources</button>
      </footer>

      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          {undoRemovedId && (
            <button onClick={() => restoreCard(undoRemovedId)}>Undo</button>
          )}
        </div>
      )}

      {panel && (
        <div className="panel-backdrop" role="presentation">
          <aside
            className="side-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="panel-title"
          >
            <div className="panel-header">
              <div>
                <p className="eyebrow">
                  {panel === "progress" ? "YOUR DECK" : "PREFERENCES"}
                </p>
                <h2 id="panel-title">
                  {panel === "progress" ? "Learning overview" : "Study settings"}
                </h2>
              </div>
              <button
                className="close-button"
                onClick={() => setPanel(null)}
                aria-label="Close panel"
              >
                ×
              </button>
            </div>

            {panel === "progress" ? (
              <div className="panel-body">
                <div className="coverage-card">
                  <div>
                    <strong>
                      {activeDeckLength
                        ? Math.round((learned / activeDeckLength) * 100)
                        : 100}
                      %
                    </strong>
                    <span>deck seen</span>
                  </div>
                  <div className="coverage-track">
                    <span
                      style={{
                        width: `${
                          activeDeckLength
                            ? (learned / activeDeckLength) * 100
                            : 100
                        }%`,
                      }}
                    />
                  </div>
                  <p>
                    {learned.toLocaleString()} of{" "}
                    {activeDeckLength.toLocaleString()} active words assessed
                  </p>
                </div>
                <div className="panel-stats">
                  <div><strong>{secured}</strong><span>secured</span></div>
                  <div><strong>{learning}</strong><span>learning</span></div>
                  <div><strong>{store.totalReviews}</strong><span>reviews</span></div>
                  <div><strong>{store.streak}</strong><span>day streak</span></div>
                </div>

                <section className="panel-section">
                  <h3>Removed from practice</h3>
                  <p>
                    Remove obvious words directly from a card. Their existing
                    review history is kept in case you restore them.
                  </p>
                  {excludedCards.length ? (
                    <div className="removed-list">
                      {excludedCards.map((card) => (
                        <div key={card.id}>
                          <span>
                            <strong lang="nl">{card.dutch}</strong>
                            <small>{card.english}</small>
                          </span>
                          <button onClick={() => restoreCard(card.id)}>
                            Restore
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="empty-list">No words removed yet.</p>
                  )}
                </section>

                <section className="panel-section">
                  <h3>Keep your progress</h3>
                  <p>
                    Your schedule is stored only in this browser. Export a backup
                    before clearing browser data or moving devices.
                  </p>
                  <div className="button-row">
                    <button className="secondary-button" onClick={exportProgress}>
                      Export backup
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => importInput.current?.click()}
                    >
                      Import backup
                    </button>
                    <input
                      ref={importInput}
                      type="file"
                      accept="application/json"
                      onChange={importProgress}
                      hidden
                    />
                  </div>
                </section>

                <section className="panel-section sources">
                  <h3>Deck sources</h3>
                  <p>
                    Frequency ranking uses open Dutch frequency data assembled by
                    wordfreq. Meanings, articles, and morphology are derived from
                    English Wiktionary data (CC BY-SA 4.0) via Kaikki; common-verb
                    auxiliary references are cross-checked against TaalBoost.
                  </p>
                  <div className="source-links">
                    <a href="https://github.com/rspeer/wordfreq" target="_blank" rel="noreferrer">wordfreq</a>
                    <a href="https://kaikki.org/dictionary/Dutch/" target="_blank" rel="noreferrer">Kaikki / Wiktionary</a>
                    <a href="https://www.taalboost.nl/blog/most-frequent-dutch-verbs-a2" target="_blank" rel="noreferrer">TaalBoost verbs</a>
                  </div>
                </section>
              </div>
            ) : (
              <div className="panel-body">
                <section className="setting-block">
                  <label htmlFor="new-limit">New cards per day</label>
                  <p>
                    At B1, 40 is a good starting point because familiar words can
                    be graduated immediately.
                  </p>
                  <select
                    id="new-limit"
                    value={settings.dailyNew}
                    onChange={(event) =>
                      setSettings((value) => ({
                        ...value,
                        dailyNew: Number(event.target.value),
                      }))
                    }
                  >
                    {[10, 20, 40, 60, 80, 100].map((value) => (
                      <option key={value} value={value}>{value} cards</option>
                    ))}
                  </select>
                </section>

                <section className="setting-block shuffle-setting">
                  <label>Randomized word order</label>
                  <p>
                    Your unseen words have a random order saved on this device.
                    Reshuffling does not change cards you already studied.
                  </p>
                  <button
                    className="secondary-button"
                    onClick={reshuffleUnseen}
                  >
                    Reshuffle unseen words
                  </button>
                </section>

                <section className="panel-section keyboard-guide">
                  <h3>Keyboard</h3>
                  <p><kbd>Space</kbd> reveal answer</p>
                  <p><kbd>1</kbd> again · <kbd>2</kbd> hard · <kbd>3</kbd> good · <kbd>4</kbd> know it/easy</p>
                </section>

                <section className="danger-zone">
                  <div>
                    <h3>Reset deck</h3>
                    <p>Erase every due date, result, and streak on this device.</p>
                  </div>
                  <button onClick={resetProgress}>Reset progress</button>
                </section>
              </div>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
