import { EmbedBuilder, type Guild } from "discord.js";

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
