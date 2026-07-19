import type { Guild } from "discord.js";

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
  | "wayfinder";

export function guildEmoji(guild: Guild, name: WayfinderEmojiName): string {
  return guild.emojis.cache.find((emoji) => emoji.name === name)?.toString() ?? "";
}

export function emojiTitle(guild: Guild, name: WayfinderEmojiName, title: string): string {
  const emoji = guildEmoji(guild, name);
  return emoji ? `${emoji} ${title}` : title;
}
