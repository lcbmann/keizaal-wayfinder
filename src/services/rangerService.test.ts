import assert from "node:assert/strict";
import test from "node:test";
import { sortCorpsHistoryRows } from "./rangerService.js";

test("sorts Corps standing by exact join timestamp before database insertion order", () => {
  const rows = sortCorpsHistoryRows([
    {
      id: "later",
      discord_username: "later",
      join_date: "2026-06-02",
      joined_at: "2026-06-02T22:03:00.000Z",
      created_at: "2026-06-02T00:00:00.000Z",
      currentRangerId: "later"
    },
    {
      id: "earlier",
      discord_username: "earlier",
      join_date: "2026-06-02",
      joined_at: "2026-06-02T18:59:00.000Z",
      created_at: "2026-06-03T00:00:00.000Z",
      currentRangerId: "earlier"
    }
  ]);

  assert.deepEqual(rows.map((row) => row.id), ["earlier", "later"]);
});

test("uses the calendar date as a deterministic fallback when an exact time is unknown", () => {
  const rows = sortCorpsHistoryRows([
    {
      id: "june-3",
      discord_username: "june-3",
      join_date: "2026-06-03",
      joined_at: null,
      created_at: "2026-06-01T00:00:00.000Z",
      currentRangerId: "june-3"
    },
    {
      id: "june-2",
      discord_username: "june-2",
      join_date: "2026-06-02",
      joined_at: null,
      created_at: "2026-06-20T00:00:00.000Z",
      currentRangerId: "june-2"
    }
  ]);

  assert.deepEqual(rows.map((row) => row.id), ["june-2", "june-3"]);
});
