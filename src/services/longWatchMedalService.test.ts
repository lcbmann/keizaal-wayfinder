import assert from "node:assert/strict";
import test from "node:test";
import { earnedLongWatchSlugs } from "./longWatchMedalService.js";

const joinedAt = "2026-01-01T12:00:00.000Z";

test("Long Watch tiers are cumulative at 30, 90, and 180 days", () => {
  assert.deepEqual(earnedLongWatchSlugs(joinedAt, new Date("2026-01-31T11:59:59.999Z")), []);
  assert.deepEqual(earnedLongWatchSlugs(joinedAt, new Date("2026-01-31T12:00:00.000Z")), ["long-watch-bronze"]);
  assert.deepEqual(earnedLongWatchSlugs(joinedAt, new Date("2026-04-01T12:00:00.000Z")), [
    "long-watch-bronze",
    "long-watch-silver"
  ]);
  assert.deepEqual(earnedLongWatchSlugs(joinedAt, new Date("2026-06-30T12:00:00.000Z")), [
    "long-watch-bronze",
    "long-watch-silver",
    "long-watch-gold"
  ]);
});

test("Long Watch ignores invalid join timestamps", () => {
  assert.deepEqual(earnedLongWatchSlugs("not-a-date", new Date("2026-06-30T12:00:00.000Z")), []);
});
