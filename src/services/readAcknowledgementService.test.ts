import assert from "node:assert/strict";
import test from "node:test";
import type { Guild } from "discord.js";
import { addReadAcknowledgementReaction, type ReadAcknowledgementDependencies } from "./readAcknowledgementService.js";

const guild = { id: "corps-guild" } as Guild;

function dependencies(channelIds: string[], saluteEmoji = "<:salute:123456789012345678>"): ReadAcknowledgementDependencies {
  return {
    corpsGuildId: guild.id,
    loadChannelIds: async () => new Set(channelIds),
    resolveSaluteEmoji: async () => saluteEmoji || null
  };
}

test("adds the salute reaction to messages in configured Trailmark or Intel channels", async () => {
  const reactions: string[] = [];
  const added = await addReadAcknowledgementReaction({
    guild,
    guildId: guild.id,
    channelId: "trailmark-channel",
    react: async (emoji) => {
      reactions.push(emoji);
    }
  }, dependencies(["trailmark-channel", "intel-channel"]));

  assert.equal(added, true);
  assert.deepEqual(reactions, ["<:salute:123456789012345678>"]);
});

test("ignores messages outside configured acknowledgement channels", async () => {
  let reacted = false;
  const added = await addReadAcknowledgementReaction({
    guild,
    guildId: guild.id,
    channelId: "general-channel",
    react: async () => {
      reacted = true;
    }
  }, dependencies(["trailmark-channel"]));

  assert.equal(added, false);
  assert.equal(reacted, false);
});

test("does not react when the custom salute emoji is unavailable", async () => {
  let reacted = false;
  const added = await addReadAcknowledgementReaction({
    guild,
    guildId: guild.id,
    channelId: "intel-channel",
    react: async () => {
      reacted = true;
    }
  }, dependencies(["intel-channel"], ""));

  assert.equal(added, false);
  assert.equal(reacted, false);
});
