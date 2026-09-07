import assert from "node:assert/strict";
import test from "node:test";
import { ChannelType, Collection, type Attachment, type Guild, type GuildMember } from "discord.js";
import { env } from "../config/env.js";
import { roleIdForRank } from "../config/roles.js";
import { supabase } from "../db/supabase.js";
import { strongboxArchiveRecord, beginStrongboxArchive } from "./auditArchiveService.js";
import { dropStrongboxMessage } from "./strongboxService.js";
import { referenceModal, referenceTimestamp, referenceUrl, requireReferencePermission, handleReferenceModal } from "./referenceService.js";
import { referenceCommand } from "../commands/reference.js";

function member(rank: "Ranger" | "Ranger Marshal" | "Ranger Captain", guildId = env.DISCORD_GUILD_ID) {
  return { id: "officer", displayName: "Test Ranger", guild: { id: guildId }, roles: { cache: new Collection([[roleIdForRank(rank), {}]]) } } as unknown as GuildMember;
}

test("Strongbox archive preserves text, attachments and route confidentiality", () => {
  const input = { member: member("Ranger"), sourceKey: "interaction", destination: "agents" as const, title: "Subject", content: "  source\ntext  ", references: "https://example.com/document", attachments: [{ id: "file", url: "https://example.com/image", name: "image.png", contentType: "image/png", size: 123 }] as Attachment[] };
  const record = strongboxArchiveRecord(input, null);
  assert.equal(record.content, input.content);
  assert.equal(record.reference_text, input.references);
  assert.equal(record.confidentiality, "agents");
  assert.equal(record.ic_or_ooc, "ic");
  assert.equal(record.submitter_ranger_id, null);
  assert.deepEqual(record.attachment_metadata, [{ id: "file", name: "image.png", url: "https://example.com/image", content_type: "image/png", size: 123 }]);
  assert.equal(strongboxArchiveRecord({ ...input, destination: "marshals" }, "ranger").ic_or_ooc, "unspecified");
});

test("Strongbox retries cannot overwrite an archived submission", async (t) => {
  let options: unknown;
  t.mock.method(supabase, "from", (table: string) => {
    const query = {
      select: () => query, eq: () => query,
      maybeSingle: async () => ({ data: null, error: null }),
      upsert: async (_record: unknown, opts: unknown) => { options = opts; return { error: null }; },
      single: async () => ({ data: { id: "original", content: "original evidence" }, error: null })
    };
    assert.ok(["rangers", "strongbox_submissions"].includes(table));
    return query;
  });
  const saved = await beginStrongboxArchive({ member: member("Ranger"), sourceKey: "interaction", destination: "marshals", title: "Retry", content: "different" });
  assert.equal(saved.content, "original evidence");
  assert.deepEqual(options, { onConflict: "guild_id,source_key", ignoreDuplicates: true });
});

test("Strongbox archives before sending and retains the message checkpoint when thread creation fails", async (t) => {
  const events: string[] = [];
  let checkpoint: Record<string, unknown> = {};
  let threadFails = true;
  const thread = { id: "thread", name: "Strongbox - Test", isThread: () => true };
  const message = { id: "posted", url: "https://discord.com/example", thread: null,
    startThread: async () => { events.push("thread"); if (threadFails) throw new Error("Discord unavailable"); return thread; } };
  const channel = { id: "channel", type: ChannelType.GuildText,
    messages: { fetch: async () => message },
    send: async () => { events.push("send"); return message; } };
  const guild = { id: env.DISCORD_GUILD_ID, emojis: { cache: new Collection() }, channels: { fetch: async () => channel } } as unknown as Guild;
  const ranger = Object.assign(member("Ranger"), { guild, user: { tag: "test" } });
  t.mock.method(supabase, "from", (table: string) => {
    const query = {
      select: () => query, eq: () => query,
      maybeSingle: async () => ({ data: table === "bot_message_state" ? { discord_channel_id: "channel" } : null, error: null }),
      upsert: () => { if (table === "strongbox_submissions") events.push("archive"); return query; },
      update: (patch: Record<string, unknown>) => { checkpoint = { ...checkpoint, ...patch }; events.push("checkpoint"); return query; },
      single: async () => ({ data: { id: "archive", source_key: "interaction", ...checkpoint }, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve)
    };
    return query;
  });
  const input = { guild, member: ranger, message: "Private report", sourceKey: "interaction" };
  await assert.rejects(dropStrongboxMessage(input), /Discord unavailable/);
  assert.deepEqual(events, ["archive", "send", "checkpoint", "thread"]);
  assert.equal(checkpoint.discord_message_id, "posted");
  threadFails = false;
  await dropStrongboxMessage(input);
  assert.equal(events.filter((v) => v === "send").length, 1);
  assert.equal(checkpoint.status, "posted");
  assert.equal(checkpoint.discord_thread_id, "thread");
});

test("reference access rejects Rangers, other guilds and Marshals reading Captain-only evidence", () => {
  assert.throws(() => requireReferencePermission(member("Ranger")));
  assert.throws(() => requireReferencePermission(member("Ranger Marshal", "other-guild")));
  assert.throws(() => requireReferencePermission(member("Ranger Marshal"), "captain_plus"));
  assert.doesNotThrow(() => requireReferencePermission(member("Ranger Marshal")));
  assert.doesNotThrow(() => requireReferencePermission(member("Ranger Captain"), "captain_plus"));
});

test("reference dates require a real timezone-qualified timestamp and unknown dates stay unknown", () => {
  assert.equal(referenceTimestamp(null), null);
  assert.equal(referenceTimestamp("2026-09-07T12:00:00-07:00"), "2026-09-07T19:00:00.000Z");
  assert.throws(() => referenceTimestamp("yesterday"));
  assert.throws(() => referenceTimestamp("2026-09-07T12:00:00"));
  assert.throws(() => referenceTimestamp("2026-02-30T12:00:00Z"));
  assert.throws(() => referenceUrl("javascript:alert(1)"));
  assert.throws(() => referenceUrl("https://user:password@example.com"));
});

test("reference command and form serialize within Discord limits", () => {
  assert.equal(referenceCommand.data.toJSON().name, "reference");
  const modal = referenceModal("test").toJSON();
  assert.equal(modal.components.length, 5);
  assert.equal(modal.custom_id, "reference:submit:test");
});

test("reference submission preserves verbatim text and rejects a different draft owner", async (t) => {
  let owner = "someone-else";
  const writes: Record<string, unknown>[] = [];
  t.mock.method(supabase, "from", () => {
    const query = {
      select: () => query, eq: () => query,
      maybeSingle: async () => ({ data: { id: "ref", confidentiality: "marshal_plus", archived_by_discord_user_id: owner, status: "draft" }, error: null }),
      update: (value: Record<string, unknown>) => { writes.push(value); return query; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve)
    };
    return query;
  });
  const officer = member("Ranger Marshal");
  const interaction = {
    inCachedGuild: () => true, deferReply: async () => {}, editReply: async () => {},
    guild: { members: { fetch: async () => officer } }, user: { id: officer.id },
    customId: "reference:submit:11111111-1111-1111-1111-111111111111",
    fields: { getTextInputValue: (id: string) => id === "text" ? "  exact\nsource  " : "" }
  } as unknown as Parameters<typeof handleReferenceModal>[0];
  await assert.rejects(handleReferenceModal(interaction), /Only the officer/);
  assert.equal(writes.length, 0);
  owner = officer.id;
  await handleReferenceModal(interaction);
  assert.equal(writes[0]?.exact_source_text, "  exact\nsource  ");
  assert.equal(writes[0]?.status, "archived");
});
