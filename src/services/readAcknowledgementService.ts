import { ChannelType, type Guild } from "discord.js";
import { env } from "../config/env.js";
import { assertNoDbError, supabase } from "../db/supabase.js";
import { guildEmoji } from "../utils/guildEmojis.js";

const CHANNEL_CACHE_MILLISECONDS = 5_000;

interface ReadAcknowledgementMessage {
  guild: Guild | null;
  guildId: string | null;
  channelId: string;
  react(emoji: string): Promise<unknown>;
}

export interface ReadAcknowledgementDependencies {
  corpsGuildId: string;
  loadChannelIds(guild: Guild): Promise<ReadonlySet<string>>;
  resolveSaluteEmoji(guild: Guild): Promise<string | null>;
}

let channelCache: { expiresAt: number; channelIds: ReadonlySet<string> } | null = null;
const warnedMissingEmojiGuilds = new Set<string>();

export async function addReadAcknowledgementReaction(
  message: ReadAcknowledgementMessage,
  dependencies: ReadAcknowledgementDependencies = defaultDependencies
): Promise<boolean> {
  if (!message.guild || message.guildId !== dependencies.corpsGuildId) {
    return false;
  }

  const channelIds = await dependencies.loadChannelIds(message.guild);
  if (!channelIds.has(message.channelId)) {
    return false;
  }

  const saluteEmoji = await dependencies.resolveSaluteEmoji(message.guild);
  if (!saluteEmoji) {
    if (!warnedMissingEmojiGuilds.has(message.guild.id)) {
      warnedMissingEmojiGuilds.add(message.guild.id);
      console.warn(`Could not add read acknowledgements because the salute emoji was not found in guild ${message.guild.id}.`);
    }
    return false;
  }

  await message.react(saluteEmoji);
  return true;
}

async function loadReadAcknowledgementChannelIds(guild: Guild): Promise<ReadonlySet<string>> {
  if (channelCache && channelCache.expiresAt > Date.now()) {
    return channelCache.channelIds;
  }

  const [trailmarkResult, intelTopicResult, allianceSettingsResult] = await Promise.all([
    supabase.from("trailmarks").select("discord_channel_id").eq("active", true),
    supabase.from("intel_topics").select("discord_channel_id").eq("active", true),
    supabase.from("alliance_intel_settings").select("corps_ally_reports_channel_id").eq("id", true).maybeSingle()
  ]);
  assertNoDbError(trailmarkResult.error, "list Trailmark read-acknowledgement channels");
  assertNoDbError(intelTopicResult.error, "list Intel read-acknowledgement channels");
  assertNoDbError(allianceSettingsResult.error, "get allied report read-acknowledgement channel");

  const channelIds = new Set<string>([
    ...(trailmarkResult.data ?? []).map((row) => row.discord_channel_id),
    ...(intelTopicResult.data ?? []).map((row) => row.discord_channel_id)
  ]);
  const allyReportsChannelId = allianceSettingsResult.data?.corps_ally_reports_channel_id;
  if (allyReportsChannelId) {
    channelIds.add(allyReportsChannelId);
  }

  if (env.NOTICE_BOARD_CHANNEL_ID) {
    channelIds.add(env.NOTICE_BOARD_CHANNEL_ID);
  } else {
    const noticeBoard = guild.channels.cache.find(
      (channel) => channel.type === ChannelType.GuildText && channel.name.toLowerCase().endsWith("notice-board")
    );
    if (noticeBoard) {
      channelIds.add(noticeBoard.id);
    }
  }

  channelCache = {
    expiresAt: Date.now() + CHANNEL_CACHE_MILLISECONDS,
    channelIds
  };
  return channelIds;
}

async function resolveSaluteEmoji(guild: Guild): Promise<string | null> {
  let emoji = guildEmoji(guild, "salute");
  if (!emoji) {
    await guild.emojis.fetch().catch(() => undefined);
    emoji = guildEmoji(guild, "salute");
  }
  return emoji || null;
}

const defaultDependencies: ReadAcknowledgementDependencies = {
  corpsGuildId: env.DISCORD_GUILD_ID,
  loadChannelIds: loadReadAcknowledgementChannelIds,
  resolveSaluteEmoji
};
