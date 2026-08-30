import assert from "node:assert/strict";
import test from "node:test";
import { HOLDS } from "../config/holds.js";
import { selectPatrolHold } from "./patrolSuggestionService.js";

test("patrol suggestions prefer an explicitly requested Hold", () => {
  assert.equal(selectPatrolHold({
    requestedHold: "The Rift",
    assignedHold: "Whiterun",
    discordUserId: "123",
    date: new Date("2026-08-30T00:00:00Z")
  }), "The Rift");
});

test("patrol suggestions use a Ranger's assigned Hold when no Hold is requested", () => {
  assert.equal(selectPatrolHold({
    assignedHold: "Whiterun",
    discordUserId: "123",
    date: new Date("2026-08-30T00:00:00Z")
  }), "Whiterun");
});

test("unassigned patrol suggestions use a stable daily Hold rotation", () => {
  const input = { discordUserId: "123", date: new Date("2026-08-30T00:00:00Z") };
  const first = selectPatrolHold(input);
  assert.equal(selectPatrolHold(input), first);
  assert.equal(HOLDS.includes(first), true);
});
