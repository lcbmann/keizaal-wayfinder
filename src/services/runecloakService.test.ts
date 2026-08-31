import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateRunecloakAttendanceCredit,
  canTransitionRunecloakApplication,
  evaluateRunecloakStage,
  parseDiscordUserIds,
  requiredPersonalAttendance,
  requiredStageAttendance,
  runecloakProgressBar
} from "./runecloakService.js";

test("Runecloak stage quorum rounds upward from 51 percent", () => {
  assert.equal(requiredStageAttendance(20), 11);
  assert.equal(requiredStageAttendance(21), 11);
  assert.equal(requiredStageAttendance(22), 12);
});

test("personal completion requires a majority of valid paired stages", () => {
  assert.equal(requiredPersonalAttendance(1), 1);
  assert.equal(requiredPersonalAttendance(5), 3);
  assert.equal(requiredPersonalAttendance(6), 4);
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

test("attendance credit carries forward without exceeding the frozen requirement", () => {
  assert.deepEqual(calculateRunecloakAttendanceCredit({
    priorCredits: 3,
    requiredCredits: 5,
    attendedStages: 4
  }), {
    earnedCredits: 2,
    retainedCredits: 5,
    complete: true
  });
});

test("application transitions require survey review before approval", () => {
  assert.equal(canTransitionRunecloakApplication("Submitted", "Survey Requested"), true);
  assert.equal(canTransitionRunecloakApplication("Submitted", "Approved"), false);
  assert.equal(canTransitionRunecloakApplication("Survey Submitted", "Approved"), true);
  assert.equal(canTransitionRunecloakApplication("Approved", "Denied"), false);
});

test("Discord IDs are deduplicated when parsed from mentions", () => {
  assert.deepEqual(parseDiscordUserIds("<@123456789012345678> 123456789012345678 <@!987654321098765432>"), [
    "123456789012345678",
    "987654321098765432"
  ]);
});

test("progress bars cap at their configured width", () => {
  assert.equal(runecloakProgressBar(4000, 8000), "[#####-----]");
  assert.equal(runecloakProgressBar(9000, 8000), "[##########]");
});
