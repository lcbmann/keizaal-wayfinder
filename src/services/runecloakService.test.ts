import assert from "node:assert/strict";
import test from "node:test";
import {
  canTransitionRunecloakApplication,
  earliestRunecloakStudySpell,
  evaluateRunecloakStage,
  normalizeRunecloakImageUrl,
  parseDiscordUserIds,
  requiredStageAttendance,
  runecloakPersonalEligibility,
  runecloakProgressBar,
  runecloakRegionalCooldown,
  runecloakSessionCanBeSubmitted
} from "./runecloakService.js";

test("Runecloak stage quorum rounds upward from 51 percent", () => {
  assert.equal(requiredStageAttendance(20), 11);
  assert.equal(requiredStageAttendance(21), 11);
  assert.equal(requiredStageAttendance(22), 12);
});

test("personal spell eligibility requires both 300 points and five paired stages", () => {
  assert.equal(runecloakPersonalEligibility({ verifiedPoints: 299, verifiedStages: 5 }), false);
  assert.equal(runecloakPersonalEligibility({ verifiedPoints: 300, verifiedStages: 4 }), false);
  assert.equal(runecloakPersonalEligibility({ verifiedPoints: 300, verifiedStages: 5 }), true);
  assert.equal(runecloakPersonalEligibility({ verifiedPoints: 420, verifiedStages: 5 }), true);
});

test("paired regional attendance counts a learner once and accepts one roll", () => {
  const result = evaluateRunecloakStage([
    { rangerId: "a", kind: "learner", verified: true, rollValue: 70 },
    { rangerId: "a", kind: "learner", verified: true, rollValue: null },
    { rangerId: "b", kind: "learner", verified: true, rollValue: 25 },
    { rangerId: "observer", kind: "observer", verified: true, rollValue: null }
  ], 2);
  assert.deepEqual(result, { uniqueAttendance: 2, points: 95, valid: true });
});

test("invalid stages preserve attendance but add no shared points", () => {
  const result = evaluateRunecloakStage([
    { rangerId: "a", kind: "learner", verified: true, rollValue: 100 }
  ], 2);
  assert.deepEqual(result, { uniqueAttendance: 1, points: 0, valid: false });
});

test("overflow stays on the earliest unfinished spell instead of carrying forward", () => {
  const spells = [
    { id: "oakflesh", sequence: 1 },
    { id: "lesser-ward", sequence: 2 }
  ];

  assert.deepEqual(earliestRunecloakStudySpell(spells, new Set(), 2), spells[0]);
  assert.deepEqual(earliestRunecloakStudySpell(spells, new Set(["oakflesh"]), 2), spells[1]);
  assert.equal(earliestRunecloakStudySpell(spells, new Set(["oakflesh", "lesser-ward"]), 2), null);
});

test("regional cooldown accepts the exact 72-hour boundary", () => {
  assert.deepEqual(runecloakRegionalCooldown(null, "2026-09-02T18:00:00.000Z"), {
    allowed: true,
    eligibleAt: null
  });
  assert.deepEqual(runecloakRegionalCooldown(
    "2026-09-01T18:00:00.000Z",
    "2026-09-04T18:00:00.000Z"
  ), {
    allowed: true,
    eligibleAt: "2026-09-04T18:00:00.000Z"
  });
  assert.deepEqual(runecloakRegionalCooldown(
    "2026-09-01T18:00:00.000Z",
    "2026-09-04T17:59:59.000Z"
  ), {
    allowed: false,
    eligibleAt: "2026-09-04T18:00:00.000Z"
  });
});

test("EU and NA cooldown histories are evaluated independently", () => {
  const eu = runecloakRegionalCooldown(
    "2026-09-01T18:00:00.000Z",
    "2026-09-03T18:00:00.000Z"
  );
  const na = runecloakRegionalCooldown(
    "2026-08-31T18:00:00.000Z",
    "2026-09-03T18:00:00.000Z"
  );

  assert.equal(eu.allowed, false);
  assert.equal(na.allowed, true);
});

test("application transitions require survey review before approval", () => {
  assert.equal(canTransitionRunecloakApplication("Submitted", "Survey Requested"), true);
  assert.equal(canTransitionRunecloakApplication("Submitted", "Approved"), false);
  assert.equal(canTransitionRunecloakApplication("Survey Submitted", "Approved"), true);
  assert.equal(canTransitionRunecloakApplication("Approved", "Denied"), false);
  assert.equal(canTransitionRunecloakApplication("Approved", "Withdrawn"), false);
});

test("verified or cancelled Runecloak session evidence cannot be replaced", () => {
  assert.equal(runecloakSessionCanBeSubmitted("Planned"), true);
  assert.equal(runecloakSessionCanBeSubmitted("Submitted"), true);
  assert.equal(runecloakSessionCanBeSubmitted("Verified"), false);
  assert.equal(runecloakSessionCanBeSubmitted("Cancelled"), false);
});

test("Discord IDs are deduplicated when parsed from mentions", () => {
  assert.deepEqual(parseDiscordUserIds("<@123456789012345678> 123456789012345678 <@!987654321098765432>"), [
    "123456789012345678",
    "987654321098765432"
  ]);
});

test("progress bars cap at their configured width", () => {
  assert.equal(runecloakProgressBar(4000, 8000), "[█████░░░░░]");
  assert.equal(runecloakProgressBar(9000, 8000), "[██████████]");
});

test("Imgur share links become direct image URLs for Discord embeds", () => {
  assert.equal(normalizeRunecloakImageUrl("https://imgur.com/XbKDqO3"), "https://i.imgur.com/XbKDqO3.jpg");
  assert.equal(normalizeRunecloakImageUrl("https://www.imgur.com/XbKDqO3.png?example=1"), "https://i.imgur.com/XbKDqO3.png");
  assert.equal(normalizeRunecloakImageUrl("https://i.imgur.com/XbKDqO3.jpg"), "https://i.imgur.com/XbKDqO3.jpg");
  assert.equal(normalizeRunecloakImageUrl("https://imgur.com/a/example"), "https://imgur.com/a/example");
  assert.equal(normalizeRunecloakImageUrl("https://cdn.example.com/image.png"), "https://cdn.example.com/image.png");
});
