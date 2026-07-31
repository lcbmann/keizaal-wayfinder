import assert from "node:assert/strict";
import test from "node:test";
import { contactTagNames, summarizeContactAssessments } from "./contactService.js";

test("summarizes contact assessments and tracks the latest confirmation", () => {
  const summary = summarizeContactAssessments([
    { assessment: "good", updated_at: "2026-07-31T10:00:00.000Z" },
    { assessment: "good", updated_at: "2026-07-31T11:00:00.000Z" },
    { assessment: "cold", updated_at: "2026-07-31T12:00:00.000Z" }
  ]);

  assert.equal(summary.status, "Confirmed");
  assert.equal(summary.lastVerifiedAt, "2026-07-31T11:00:00.000Z");
  assert.deepEqual(summary.counts, { good: 2, cold: 1, not_found: 0, mia: 0, archive: 0 });
});

test("marks a contact as mixed when assessments are tied", () => {
  const summary = summarizeContactAssessments([
    { assessment: "good", updated_at: "2026-07-31T10:00:00.000Z" },
    { assessment: "mia", updated_at: "2026-07-31T11:00:00.000Z" }
  ]);

  assert.equal(summary.status, "Mixed reports");
});

test("shows an archive proposal without removing the other assessment counts", () => {
  const summary = summarizeContactAssessments([
    { assessment: "good", updated_at: "2026-07-31T10:00:00.000Z" },
    { assessment: "archive", updated_at: "2026-07-31T11:00:00.000Z" }
  ]);

  assert.equal(summary.status, "Archive proposed");
  assert.equal(summary.counts.good, 1);
  assert.equal(summary.counts.archive, 1);
});

test("assigns region, occupation, and high-priority Forum tags", () => {
  assert.deepEqual(contactTagNames({
    hold: "Falkreath",
    occupation: "Alchemist",
    high_priority: true
  }), ["Falkreath", "Alchemist", "High Priority"]);

  assert.deepEqual(contactTagNames({
    hold: "Cross-Skyrim",
    occupation: "General Merchant",
    high_priority: false
  }), ["Cross-Skyrim", "Other Occupation"]);
});
