import { EmbedBuilder, type Guild } from "discord.js";
import { slugify } from "./slugs.js";

export type WayfinderEmojiName =
  | "atlas"
  | "cape"
  | "corps"
  | "duty"
  | "funds"
  | "intel"
  | "promotion"
  | "strongbox"
  | "supplies"
  | "teamwork"
  | "trailmark"
  | "wayfinder"
  | "war"
  | "cultists"
  | "bandits"
  | "werewolf"
  | "vampire";

export type EmojiTextStyle = "dash" | "symmetric";

export function guildEmoji(guild: Guild, name: WayfinderEmojiName): string {
  return guild.emojis.cache.find((emoji) => emoji.name === name)?.toString() ?? "";
}

export function guildEmojiImageUrl(
  guild: Guild,
  name: WayfinderEmojiName,
  size = 128
): string | null {
  return guild.emojis.cache.find((emoji) => emoji.name === name)?.imageURL({ size }) ?? null;
}

export function emojiEmbed(
  guild: Guild,
  name: WayfinderEmojiName,
  title: string,
  style: EmojiTextStyle = "dash"
): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(emojiTitle(guild, name, title, style));
  const imageUrl = guildEmojiImageUrl(guild, name);
  if (imageUrl) {
    embed.setThumbnail(imageUrl);
  }
  return embed;
}

export function emojiText(
  guild: Guild,
  name: WayfinderEmojiName,
  text: string,
  style: EmojiTextStyle = "dash"
): string {
  const emoji = guildEmoji(guild, name);
  if (!emoji) {
    return text;
  }
  return style === "symmetric"
    ? `${emoji} ${text} ${emoji}`
    : `${emoji} - ${text}`;
}

export function emojiTitle(
  guild: Guild,
  name: WayfinderEmojiName,
  title: string,
  style: EmojiTextStyle = "dash"
): string {
  return emojiText(guild, name, title, style);
}

export function intelReportChannelName(guild: Guild, topicName: string): string {
  const baseName = `${slugify(topicName)}-reports`.slice(0, 78);
  const emojiName = intelTopicEmojiName(topicName);
  const emoji = emojiName ? guildEmoji(guild, emojiName) : "";
  return emoji ? `${emoji} | ${baseName}`.slice(0, 100) : baseName;
}

export function allyReportsChannelName(guild: Guild): string {
  const emoji = guildEmoji(guild, "teamwork");
  return emoji ? `${emoji} | ally-reports` : "ally-reports";
}

export function isStandardIntelReportChannelName(channelName: string, topicName: string): boolean {
  return channelName === intelReportChannelNameWithoutEmoji(topicName);
}

function intelReportChannelNameWithoutEmoji(topicName: string): string {
  return `${slugify(topicName)}-reports`.slice(0, 78);
}

export function intelTopicEmojiName(topicName: string): WayfinderEmojiName | null {
  const topic = slugify(topicName);
  if (topic === "war") {
    return "war";
  }
  if (topic === "cultist" || topic === "cultists") {
    return "cultists";
  }
  if (topic === "bandit" || topic === "bandits") {
    return "bandits";
  }
  if (topic === "werewolf" || topic === "werewolves") {
    return "werewolf";
  }
  if (topic === "vampire" || topic === "vampires") {
    return "vampire";
  }
  return null;
}
