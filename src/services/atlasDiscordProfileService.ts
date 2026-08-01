import type { GuildMember } from "discord.js";
import { assertNoDbError, supabase, type Json } from "../db/supabase.js";
import { mainRankFromMember } from "../utils/permissions.js";

const rankBadgeIds = {
  "Ranger Commander": "ranger-commander",
  "Ranger Captain": "ranger-captain",
  "Ranger Marshal": "ranger-marshal",
  Ranger: "ranger",
  Apprentice: "apprentice"
} as const;

const medalRoleIds = new Map([
  ["Wayfinder", "wayfinder"],
  ["Aedra/GM", "aedra-gm"],
  ["Senior Ranger", "senior-ranger"],
  ["Quartermaster", "quartermaster"],
  ["Ambassador", "ambassador"],
  ["Warden", "warden"],
  ["Detective", "detective"],
  ["Craftsman", "craftsman"],
  ["Courier", "courier"],
  ["Ranger Orders", "ranger-orders"],
  ["Retired Ranger", "retired-ranger"],
  ["Allies", "allies"],
  ["Dawnguard", "dawnguard"],
  ["Silver Dawn", "silver-dawn"],
  ["Deceased", "deceased"]
]);

export function buildAtlasDiscordProfile(member: GuildMember): Json {
  const rank = mainRankFromMember(member);
  const medals = [...medalRoleIds.entries()]
    .filter(([roleName]) => member.roles.cache.some((role) => role.name === roleName))
    .map(([label, id]) => ({ id, label }));

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
