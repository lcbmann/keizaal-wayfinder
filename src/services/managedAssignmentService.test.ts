import assert from "node:assert/strict";
import test from "node:test";
import { Collection, type Guild } from "discord.js";
import type { ManagedAssignmentRow } from "../db/supabase.js";
import { buildAssignmentMessagePayload } from "./managedAssignmentService.js";

const guild = { emojis: { cache: new Collection() } } as unknown as Guild;
const assignment: ManagedAssignmentRow = {
  id: "00000000-0000-4000-8000-000000000001",
  guild_id: "1",
  forum_channel_id: "2",
  thread_id: null,
  starter_message_id: null,
  title: "Patrol Falkreath",
  objective: "Keep the roads safe.",
  details: null,
  location: "Oakwood",
  hold: "Falkreath",
  timing: null,
  minimum_rank: "Apprentice",
  organizer_discord_user_id: "3",
  status: "Open",
  created_at: "2026-10-11T17:00:00Z",
  updated_at: "2026-10-11T17:00:00Z",
  completed_at: null
};

for (const length of [1024, 1025, 1800]) {
  test(`assignment details preserve all ${length} characters in valid Discord fields`, () => {
    const details = "x".repeat(length);
    const payload = buildAssignmentMessagePayload(guild, { ...assignment, details }, []);
    const builder = payload.embeds[0];
    assert.ok(builder);
    const embed = builder.toJSON();
    const fields = embed.fields?.filter((field) => field.name.startsWith("Details")) ?? [];
    assert.equal(fields.map((field) => field.value).join(""), details);
    assert.ok(fields.every((field) => field.value.length <= 1024));
    assert.equal(fields.length, Math.ceil(length / 1024));
    const controls = payload.components[0];
    assert.ok(controls);
    assert.equal(controls.toJSON().components.length, 3);
  });
}

test("assignment details split at paragraph boundaries without dropping text", () => {
  const details = `${"a".repeat(900)}\n\n${"b".repeat(800)}`;
  const payload = buildAssignmentMessagePayload(guild, { ...assignment, details, status: "Completed" }, []);
  const embed = payload.embeds[0];
  assert.ok(embed);
  const fields = embed.toJSON().fields?.filter((field) => field.name.startsWith("Details")) ?? [];
  assert.equal(fields.map((field) => field.value).join(""), details);
  assert.ok(fields[0]);
  assert.equal(fields[0].value, `${"a".repeat(900)}\n\n`);
  assert.equal(payload.components.length, 0);
});

test("assignment with no details keeps its default field", () => {
  const payload = buildAssignmentMessagePayload(guild, assignment, []);
  const embed = payload.embeds[0];
  assert.ok(embed);
  const fields = embed.toJSON().fields ?? [];
  assert.equal(fields.find((field) => field.name === "Details")?.value, "No extra details.");
});

test("assignment details keep a Unicode character intact at the field boundary", () => {
  const details = `${"x".repeat(1023)}\u{1F332}${"y".repeat(100)}`;
  const payload = buildAssignmentMessagePayload(guild, { ...assignment, details }, []);
  const embed = payload.embeds[0];
  assert.ok(embed);
  const fields = embed.toJSON().fields?.filter((field) => field.name.startsWith("Details")) ?? [];
  assert.ok(fields[0]);
  assert.equal(fields[0].value, "x".repeat(1023));
  assert.equal(fields.map((field) => field.value).join(""), details);
});
