import type { Guild, GuildMember } from "discord.js";
import { assertNoDbError, supabase, type CorpsMedalRow, type Json } from "../db/supabase.js";
import { canCreateTrailmarks, mainRankFromMember } from "../utils/permissions.js";
import { MAIN_RANKS } from "../config/ranks.js";
import { roleIdForRank } from "../config/roles.js";
import { rankEmojiName, type WayfinderEmojiName } from "../utils/guildEmojis.js";
import { slugify } from "../utils/slugs.js";
import { listMedals } from "./medalService.js";

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
  ["Agent", { id: "agent", emojiName: "agent" }],
  ["Craftsman", { id: "craftsman", emojiName: "craftsman" }],
  ["Courier", { id: "courier", emojiName: "courier" }],
  ["Instructor", { id: "instructor", emojiName: "instructor" }],
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

type AtlasMedal = {
  id: string;
  label: string;
  rolePosition: number;
};

function listDiscordAwardMedals(member: GuildMember, corpsMedals: readonly CorpsMedalRow[]): AtlasMedal[] {
  const medalByRoleId = new Map(
    corpsMedals.flatMap((medal) => medal.discord_role_id ? [[medal.discord_role_id, medal] as const] : [])
  );
  return member.roles.cache
    .filter((role) => role.name.startsWith("Medal: "))
    .map((role) => {
      const medal = medalByRoleId.get(role.id);
      const label = medal?.name ?? role.name.slice("Medal: ".length).trim();
      const fallbackSlug = slugify(label.replace(/['\u2019]/gu, "").replace(/^the\s+/iu, ""));
      return {
        id: `medal-${medal?.slug || fallbackSlug}`,
        label,
        rolePosition: role.position
      };
    })
    .filter(({ label }) => Boolean(label));
}

export function highestCorpsTitle(member: GuildMember): string | null {
  const badge = listDiscordRoleMedals(member).find(({ roleName }) => titleRoleNames.has(roleName));
  return badge ? displayTitle(badge.label) : null;
}

export function buildAtlasDiscordProfile(member: GuildMember, corpsMedals: readonly CorpsMedalRow[] = []): Json {
  const rank = mainRankFromMember(member);
  const primaryBadge = rank ? { id: rankBadgeIds[rank], label: rank } : null;
  const medals = [
    ...listDiscordRoleMedals(member).map(({ badgeId: id, label, rolePosition }) => ({ id, label, rolePosition })),
    ...listDiscordAwardMedals(member, corpsMedals)
  ]
    .sort((a, b) => b.rolePosition - a.rolePosition || a.label.localeCompare(b.label))
    .filter(({ id }, index, all) => id !== primaryBadge?.id && all.findIndex((candidate) => candidate.id === id) === index)
    .map(({ id, label }) => ({ id, label }));

  return {
    version: 1,
    primary_badge: primaryBadge,
    medals
  };
}

function buildAtlasRangerRoles(member: GuildMember): Json {
  const rank = mainRankFromMember(member);
  return rank ? [{ id: rankBadgeIds[rank], name: rank }] : [];
}

function buildAtlasRangerPermissions(member: GuildMember): string[] {
  return canCreateTrailmarks(member) ? ["trailmarks.manage"] : [];
}

export type AtlasRangerSyncResult = {
  active: boolean;
  linkedAccounts: number;
};

export async function syncAtlasDiscordProfile(
  member: GuildMember,
  corpsMedals: readonly CorpsMedalRow[] | null = null
): Promise<AtlasRangerSyncResult> {
  const availableMedals = corpsMedals ?? await listMedals();
  const rank = mainRankFromMember(member);
  const profile = buildAtlasDiscordProfile(member, availableMedals);
  const { data, error } = await supabase.rpc("set_atlas_ranger_access", {
    discord_user_id_input: member.id,
    display_name_input: member.displayName,
    active_input: Boolean(rank),
    permissions_input: buildAtlasRangerPermissions(member),
    roles_input: buildAtlasRangerRoles(member),
    discord_profile_input: profile
  });
  assertNoDbError(error, "synchronize Ranger Atlas identity");
  return {
    active: Boolean(rank),
    linkedAccounts: typeof data === "number" ? data : 0
  };
}

export async function deactivateAtlasRangerAccess(params: {
  discordUserId: string;
  displayName: string;
}): Promise<number> {
  const { data, error } = await supabase.rpc("set_atlas_ranger_access", {
    discord_user_id_input: params.discordUserId,
    display_name_input: params.displayName,
    active_input: false,
    permissions_input: [],
    roles_input: [],
    discord_profile_input: {}
  });
  assertNoDbError(error, "deactivate Ranger Atlas identity");
  return typeof data === "number" ? data : 0;
}

export async function syncGuildAtlasDiscordProfiles(guild: Guild): Promise<{
  members: number;
  linkedAccounts: number;
  deactivated: number;
}> {
  const [members, corpsMedals, directoryResult] = await Promise.all([
    guild.members.fetch(),
    listMedals(),
    supabase.from("atlas_ranger_directory").select("discord_user_id, display_name, active").eq("active", true)
  ]);
  assertNoDbError(directoryResult.error, "load active Ranger Atlas identities");
  let syncedMembers = 0;
  let linkedAccounts = 0;
  let deactivated = 0;
  for (const member of members.values()) {
    if (member.user.bot || !mainRankFromMember(member)) {
      continue;
    }
    syncedMembers += 1;
    try {
      const result = await syncAtlasDiscordProfile(member, corpsMedals);
      linkedAccounts += result.linkedAccounts;
    } catch (error) {
      console.warn(`Could not synchronize Ranger Atlas identity for ${member.id}:`, error);
    }
  }

  for (const directoryEntry of directoryResult.data ?? []) {
    const member = members.get(directoryEntry.discord_user_id);
    if (member && !member.user.bot && mainRankFromMember(member)) {
      continue;
    }
    try {
      linkedAccounts += await deactivateAtlasRangerAccess({
        discordUserId: directoryEntry.discord_user_id,
        displayName: member?.displayName || directoryEntry.display_name
      });
      deactivated += 1;
    } catch (error) {
      console.warn(`Could not deactivate Ranger Atlas identity for ${directoryEntry.discord_user_id}:`, error);
    }
  }

  return { members: syncedMembers, linkedAccounts, deactivated };
}

const titleRoleNames = new Set([
  ...Object.keys(rankBadgeIds),
  "Senior Ranger",
  "Quartermaster",
  "Ambassador",
  "Warden",
  "Agent",
  "Craftsman",
  "Courier",
  "Instructor",
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
