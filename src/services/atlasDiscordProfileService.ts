import type { GuildMember } from "discord.js";
import { assertNoDbError, supabase, type Json } from "../db/supabase.js";
import { mainRankFromMember } from "../utils/permissions.js";
import type { WayfinderEmojiName } from "../utils/guildEmojis.js";

const rankBadgeIds = {
  "Ranger Commander": "ranger-commander",
  "Ranger Captain": "ranger-captain",
  "Ranger Marshal": "ranger-marshal",
  Ranger: "ranger",
  Apprentice: "apprentice"
} as const;

const medalRoleIds = new Map([
  ["Wayfinder", { id: "wayfinder", emojiName: "wayfinder" }],
  ["Aedra/GM", { id: "aedra-gm", emojiName: "aedragm" }],
  ["Senior Ranger", { id: "senior-ranger", emojiName: "seniorranger" }],
  ["Quartermaster", { id: "quartermaster", emojiName: "quartermaster" }],
  ["Ambassador", { id: "ambassador", emojiName: "ambassador" }],
  ["Warden", { id: "warden", emojiName: "warden" }],
  ["Detective", { id: "detective", emojiName: "detective" }],
  ["Craftsman", { id: "craftsman", emojiName: "craftsman" }],
  ["Courier", { id: "courier", emojiName: "courier" }],
  ["Ranger Orders", { id: "ranger-orders", emojiName: "rangerorders" }],
  ["Retired Ranger", { id: "retired-ranger", emojiName: "retiredranger" }],
  ["Allies", { id: "allies", emojiName: "allies" }],
  ["Dawnguard", { id: "dawnguard", emojiName: "dawnguard" }],
  ["Silver Dawn", { id: "silver-dawn", emojiName: "silverdawn" }],
  ["Deceased", { id: "deceased", emojiName: "deceased" }]
]) satisfies ReadonlyMap<string, { id: string; emojiName: WayfinderEmojiName }>;

export type DiscordRoleMedal = {
  label: string;
  emojiName: WayfinderEmojiName;
};

export function listDiscordRoleMedals(member: GuildMember): DiscordRoleMedal[] {
  return [...medalRoleIds.entries()]
    .filter(([roleName]) => member.roles.cache.some((role) => role.name === roleName))
    .map(([label, { emojiName }]) => ({ label, emojiName }));
}

export function buildAtlasDiscordProfile(member: GuildMember): Json {
  const rank = mainRankFromMember(member);
  const medals = [...medalRoleIds.entries()]
    .filter(([roleName]) => member.roles.cache.some((role) => role.name === roleName))
    .map(([label, { id }]) => ({ id, label }));

  return {
    version: 1,
    primary_badge: rank ? { id: rankBadgeIds[rank], label: rank } : null,
    medals
  };
}

export async function syncAtlasDiscordProfile(member: GuildMember): Promise<number> {
  const { data, error } = await supabase.rpc("update_atlas_discord_profile", {
    discord_user_id_input: member.id,
    discord_display_name_input: member.displayName,
    discord_profile_input: buildAtlasDiscordProfile(member)
  });
  assertNoDbError(error, "update linked Atlas Discord profile");
  return typeof data === "number" ? data : 0;
}
