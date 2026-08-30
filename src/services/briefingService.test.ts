import assert from "node:assert/strict";
import test from "node:test";
import { briefingAudienceIncludes } from "./briefingService.js";

test("briefing audiences respect cumulative Ranger ranks", () => {
  assert.equal(briefingAudienceIncludes("apprentice_plus", null, "Apprentice", "1"), true);
  assert.equal(briefingAudienceIncludes("ranger_plus", null, "Apprentice", "1"), false);
  assert.equal(briefingAudienceIncludes("ranger_plus", null, "Ranger", "1"), true);
  assert.equal(briefingAudienceIncludes("marshal_plus", null, "Ranger Marshal", "1"), true);
  assert.equal(briefingAudienceIncludes("captain_plus", null, "Ranger Marshal", "1"), false);
  assert.equal(briefingAudienceIncludes("captain_plus", null, "Ranger Captain", "1"), true);
});

test("individual briefing dispatches only reach their named recipient", () => {
  assert.equal(briefingAudienceIncludes("individual", "42", "Apprentice", "42"), true);
  assert.equal(briefingAudienceIncludes("individual", "42", "Ranger Commander", "7"), false);
});
