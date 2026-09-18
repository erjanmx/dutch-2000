import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeStudyStores,
  newestSettings,
  type StudyStore,
} from "../app/sync.ts";

function store(overrides: Partial<StudyStore> = {}): StudyStore {
  return {
    version: 1,
    progress: {},
    excluded: {},
    exclusionChanges: {},
    newOrder: ["a", "b"],
    daily: { date: "2026-09-18", reviewed: 0, correct: 0, newSeen: 0 },
    streak: 0,
    lastStudyDate: "",
    totalReviews: 0,
    resetAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function record(lastReviewed: number, reviews = 1) {
  return {
    state: "review" as const,
    due: lastReviewed + 86_400_000,
    interval: 1,
    ease: 2.5,
    reviews,
    lapses: 0,
    lastRating: "good" as const,
    lastReviewed,
  };
}

test("merges reviews learned on separate devices", () => {
  const merged = mergeStudyStores([
    store({ progress: { a: record(100) }, updatedAt: 100 }),
    store({ progress: { b: record(200) }, updatedAt: 200 }),
  ]);

  assert.deepEqual(Object.keys(merged.progress).sort(), ["a", "b"]);
  assert.equal(merged.totalReviews, 2);
});

test("keeps the newest review when both devices changed the same word", () => {
  const merged = mergeStudyStores([
    store({ progress: { a: record(100, 2) }, updatedAt: 100 }),
    store({ progress: { a: record(200, 3) }, updatedAt: 200 }),
  ]);

  assert.equal(merged.progress.a.lastReviewed, 200);
  assert.equal(merged.progress.a.reviews, 3);
});

test("a newer restore wins over an older removal", () => {
  const merged = mergeStudyStores([
    store({
      excluded: { a: 100 },
      exclusionChanges: { a: { excluded: true, updatedAt: 100 } },
      updatedAt: 100,
    }),
    store({
      exclusionChanges: { a: { excluded: false, updatedAt: 200 } },
      updatedAt: 200,
    }),
  ]);

  assert.equal(merged.excluded.a, undefined);
  assert.deepEqual(merged.exclusionChanges.a, {
    excluded: false,
    updatedAt: 200,
  });
});

test("a synchronized reset discards older progress", () => {
  const merged = mergeStudyStores([
    store({ progress: { a: record(100) }, updatedAt: 100 }),
    store({ resetAt: 200, updatedAt: 200 }),
  ]);

  assert.deepEqual(merged.progress, {});
  assert.equal(merged.totalReviews, 0);
});

test("chooses settings from the newest snapshot", () => {
  assert.deepEqual(
    newestSettings([
      { settings: { dailyNew: 20 }, updatedAt: 100 },
      { settings: { dailyNew: 60 }, updatedAt: 200 },
    ]),
    { dailyNew: 60 },
  );
});

test("repeated merges are stable", () => {
  const first = mergeStudyStores([
    store({ progress: { a: record(100) }, updatedAt: 100 }),
    store({ progress: { b: record(200) }, updatedAt: 200 }),
  ]);
  const second = mergeStudyStores([first, first]);

  assert.deepEqual(second, first);
});
