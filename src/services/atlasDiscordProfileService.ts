import type { GuildMember } from "discord.js";
import { assertNoDbError, supabase, type Json } from "../db/supabase.js";
import { mainRankFromMember } from "../utils/permissions.js";
import { MAIN_RANKS } from "../config/ranks.js";
import { roleIdForRank } from "../config/roles.js";
import { rankEmojiName, type WayfinderEmojiName } from "../utils/guildEmojis.js";

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
  badgeId: string;
  label: string;
  emojiName: WayfinderEmojiName;
  roleName: string;
  rolePosition: number;
};

export function listDiscordRoleMedals(member: GuildMember): DiscordRoleMedal[] {
  const rankMedals = MAIN_RANKS.flatMap((rank) => {
    const role = member.roles.cache.get(roleIdForRank(rank));
    const emojiName = rankEmojiName(rank);
    return role && emojiName
      ? [{ badgeId: rankBadgeIds[rank], label: rank, emojiName, roleName: role.name, rolePosition: role.position }]
      : [];
  });
  const additionalMedals = [...medalRoleIds.entries()].flatMap(([label, { id, emojiName }]) => {
    const role = member.roles.cache.find((candidate) => candidate.name === label);
    return role ? [{ badgeId: id, label, emojiName, roleName: role.name, rolePosition: role.position }] : [];
  });

  return [...rankMedals, ...additionalMedals]
    .sort((a, b) => b.rolePosition - a.rolePosition || a.label.localeCompare(b.label));
}

export function highestCorpsTitle(member: GuildMember): string | null {
  const badge = listDiscordRoleMedals(member).find(({ roleName }) => titleRoleNames.has(roleName));
  return badge ? displayTitle(badge.label) : null;
}

export function buildAtlasDiscordProfile(member: GuildMember): Json {
  const rank = mainRankFromMember(member);
  const primaryBadge = rank ? { id: rankBadgeIds[rank], label: rank } : null;
  const medals = listDiscordRoleMedals(member)
    .filter(({ badgeId }) => badgeId !== primaryBadge?.id)
    .map(({ badgeId: id, label }) => ({ id, label }));

  return {
    version: 1,
    primary_badge: primaryBadge,
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

const titleRoleNames = new Set([
  ...Object.keys(rankBadgeIds),
  "Senior Ranger",
  "Quartermaster",
  "Ambassador",
  "Warden",
  "Detective",
  "Craftsman",
  "Courier",
  "Retired Ranger"
]);

function displayTitle(roleName: string): string {
  switch (roleName) {
    case "Ranger Commander":
      return "Commander";
    case "Ranger Captain":
      return "Captain";
    case "Ranger Marshal":
      return "Marshal";
    default:
      return roleName;
  }
}
