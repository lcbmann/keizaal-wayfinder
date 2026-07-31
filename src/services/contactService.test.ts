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

test("keeps a contact record intact when a non-Ranger clicks an assessment button", async () => {
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

  assert.deepEqual(replies, [{ content: "Ranger or higher is required for contact records.", ephemeral: true }]);
  assert.equal(deferred, false);
  assert.equal(edited, false);
});
