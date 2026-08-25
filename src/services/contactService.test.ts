import assert from "node:assert/strict";
import test from "node:test";
import type { ButtonInteraction } from "discord.js";
import { contactTagNames, handleContactButton, summarizeContactAssessments } from "./contactService.js";

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
    record_type: "Person",
    hold: "Falkreath",
    occupation: "Alchemist",
    high_priority: true
  }), ["Falkreath", "Alchemist", "High Priority"]);

  assert.deepEqual(contactTagNames({
    record_type: "Person",
    hold: "Cross-Skyrim",
    occupation: "General Merchant",
    high_priority: false
  }), ["Cross-Skyrim", "Other Occupation"]);

  assert.deepEqual(contactTagNames({
    record_type: "Group",
    hold: "The Rift",
    occupation: null,
    high_priority: true
  }), ["The Rift", "Group", "High Priority"]);
});

test("uses operational status language for group assessments", () => {
  const active = summarizeContactAssessments([
    { assessment: "good", updated_at: "2026-08-25T10:00:00.000Z" }
  ], "Group");
  const inactive = summarizeContactAssessments([
    { assessment: "cold", updated_at: "2026-08-25T11:00:00.000Z" }
  ], "Group");

  assert.equal(active.status, "Active");
  assert.equal(inactive.status, "Inactive");
});

test("keeps a contact record intact when a non-Apprentice clicks an assessment button", async () => {
  const replies: Array<{ content: string; ephemeral: boolean }> = [];
  let deferred = false;
  let edited = false;
  const interaction = {
    inCachedGuild: () => true,
    customId: "contact:assess:contact-id:good",
    user: { id: "guest-user" },
    guild: {
      members: {
        fetch: async () => ({
          id: "guest-user",
          roles: { cache: { has: () => false } }
        })
      }
    },
    reply: async (payload: { content: string; ephemeral: boolean }) => {
      replies.push(payload);
    },
    deferUpdate: async () => {
      deferred = true;
    },
    editReply: async () => {
      edited = true;
    }
  } as unknown as ButtonInteraction;

  await handleContactButton(interaction);

  assert.deepEqual(replies, [{ content: "Apprentice or higher is required for contact records.", ephemeral: true }]);
  assert.equal(deferred, false);
  assert.equal(edited, false);
});
