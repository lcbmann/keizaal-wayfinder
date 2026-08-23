import assert from "node:assert/strict";
import test from "node:test";
import { candidateAlreadyHoldsPromotionTarget, minimumVoterRankForTarget } from "./promotionService.js";

test("identifies votes for a rank the candidate already holds", () => {
  assert.equal(candidateAlreadyHoldsPromotionTarget("Ranger", "Ranger"), true);
  assert.equal(candidateAlreadyHoldsPromotionTarget("Ranger Captain", "Ranger Marshal"), true);
});

test("keeps genuine upward promotion votes open", () => {
  assert.equal(candidateAlreadyHoldsPromotionTarget("Apprentice", "Ranger"), false);
  assert.equal(candidateAlreadyHoldsPromotionTarget("Ranger", "Ranger Marshal"), false);
});

test("leadership votes are restricted to their own leadership tier", () => {
  assert.equal(minimumVoterRankForTarget("Ranger"), "Ranger");
  assert.equal(minimumVoterRankForTarget("Ranger Marshal"), "Ranger Marshal");
  assert.equal(minimumVoterRankForTarget("Ranger Captain"), "Ranger Captain");
});
