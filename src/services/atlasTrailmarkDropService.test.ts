import assert from "node:assert/strict";
import test from "node:test";
import type { Guild, GuildMember, Message, MessageCreateOptions, TextChannel } from "discord.js";
import type { IntelTopicRow, TrailmarkRow } from "../db/supabase.js";
import { classifyTrailmarkIntelContent } from "./intelService.js";
import {
  processAtlasTrailmarkDrop,
  type AtlasTrailmarkDrop,
  type AtlasTrailmarkDropDependencies
} from "./atlasTrailmarkDropService.js";

const guild = {} as Guild;
const member = {
  displayName: "Current Discord Display Name",
  displayAvatarURL: () => "https://example.test/avatar.png"
} as GuildMember;
const channel = { id: "discord-channel-id" } as TextChannel;
const trailmark: TrailmarkRow = {
  id: "trailmark-id",
  name: "Dawnstar",
  slug: "dawnstar",
  hold: "The Pale",
  location_description: "A cache near Dawnstar.",
  screenshot_url: null,
  discord_channel_id: "discord-channel-id",
  atlas_location_id: "atlas-dawnstar",
  active: true,
  pinned: false,
  created_by_discord_user_id: "marshal-id",
  created_at: "2026-07-30T10:00:00.000Z",
  updated_at: "2026-07-30T10:00:00.000Z"
};
const drop: AtlasTrailmarkDrop = {
  id: "drop-id",
  discord_user_id: "discord-user-id",
  ranger_name: "Original Ranger Name",
  atlas_location_id: "atlas-dawnstar",
  message: "Bandits were seen on the road.",
  requested_at: "2026-07-30T10:00:00.000Z"
};
const postedMessage = {
  id: "discord-message-id",
  channelId: trailmark.discord_channel_id,
  createdAt: new Date(drop.requested_at)
} as Message;

test("routes a keyword match to the matching Intel topic", () => {
  const vampire = topic("vampire", ["vampire"]);
  const other = topic("other", []);

  const result = classifyTrailmarkIntelContent({
    content: "A vampire was seen near the road.",
    topics: [vampire, other],
    catchallTopic: other,
    trailmarkId: trailmark.id,
    hqTrailmarkId: "another-trailmark"
  });

  assert.deepEqual(result.topics.map((item) => item.id), [vampire.id]);
  assert.equal(result.isCatchall, false);
  assert.equal(result.isHqReport, false);
});

test("routes unmatched content to the configured catchall topic", () => {
  const vampire = topic("vampire", ["vampire"]);
  const other = topic("other", []);

  const result = classifyTrailmarkIntelContent({
    content: "A quiet report with no configured keyword.",
    topics: [vampire, other],
    catchallTopic: other,
    trailmarkId: trailmark.id,
    hqTrailmarkId: "another-trailmark"
  });

  assert.deepEqual(result.topics.map((item) => item.id), [other.id]);
  assert.equal(result.isCatchall, true);
});

test("marks an HQ drop for immediate Intel publication", () => {
  const other = topic("other", []);
  const result = classifyTrailmarkIntelContent({
    content: "A report placed directly at headquarters.",
    topics: [other],
    catchallTopic: other,
    trailmarkId: trailmark.id,
    hqTrailmarkId: trailmark.id
  });

  assert.equal(result.isHqReport, true);
  assert.equal(result.isCatchall, true);
});

test("posts a visible drop and preserves the Atlas reporter identity for Intel", async () => {
  const calls: string[] = [];
  let postedOptions: MessageCreateOptions | undefined;
  const dependencies = createDependencies({
    postMessage: async (_channel, options) => {
      postedOptions = options;
      return postedMessage;
    },
    captureIntel: async (params) => {
      assert.equal(params.authorDiscordUserId, drop.discord_user_id);
      assert.equal(params.authorDisplayName, drop.ranger_name);
      assert.equal(params.content, drop.message);
      calls.push("capture");
      return 1;
    },
    completeDrop: async (params) => {
      assert.equal(params.status, "posted");
      assert.equal(params.channelId, trailmark.discord_channel_id);
      assert.equal(params.messageId, postedMessage.id);
      calls.push("complete");
    }
  });

  const result = await processAtlasTrailmarkDrop(guild, drop, dependencies);

  assert.deepEqual(result, { status: "posted" });
  assert.equal(postedOptions?.content, undefined);
  assert.equal(postedOptions?.embeds?.length, 1);
  const embed = postedOptions?.embeds?.[0];
  assert.ok(embed);
  const embedData = "toJSON" in embed ? embed.toJSON() : embed;
  assert.equal(embedData.author?.name, member.displayName);
  assert.equal(embedData.title, `${trailmark.name} Field Drop`);
  assert.equal(embedData.description, drop.message);
  assert.deepEqual(postedOptions?.allowedMentions, { parse: [] });
  assert.deepEqual(calls, ["capture", "complete"]);
});

function topic(name: string, keywords: string[]): IntelTopicRow {
  return {
    id: `${name}-topic-id`,
    name,
    slug: name,
    keywords,
    discord_channel_id: `${name}-channel-id`,
    active: true,
    created_by_discord_user_id: "marshal-id",
    created_at: "2026-07-30T10:00:00.000Z",
    updated_at: "2026-07-30T10:00:00.000Z"
  };
}

function createDependencies(overrides: Partial<AtlasTrailmarkDropDependencies> = {}): AtlasTrailmarkDropDependencies {
  return {
    findTrailmark: async () => trailmark,
    fetchMember: async () => member,
    canUseTrailmarks: () => true,
    fetchChannel: async () => channel,
    postMessage: async () => postedMessage,
    captureIntel: async () => 1,
    completeDrop: async () => undefined,
    ...overrides
  };
}
