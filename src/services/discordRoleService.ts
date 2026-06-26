import type { GuildMember } from "discord.js";
import { env } from "../config/env.js";
import { mainRankRoleIds, roleIdForRank } from "../config/roles.js";
import { MAIN_RANKS, type MainRank } from "../config/ranks.js";

export function getMemberMainRank(member: GuildMember): MainRank | null {
  return MAIN_RANKS.find((rank) => member.roles.cache.has(roleIdForRank(rank))) ?? null;
}

export async function setExactlyOneMainRank(member: GuildMember, rank: MainRank): Promise<void> {
  const targetRoleId = roleIdForRank(rank);
  const rankRoleIds = mainRankRoleIds();
  const removeRoleIds = rankRoleIds.filter((roleId) => roleId !== targetRoleId && member.roles.cache.has(roleId));

  if (removeRoleIds.length > 0) {
    await member.roles.remove(removeRoleIds, `Sync Ranger main rank to ${rank}`);
  }

  if (!member.roles.cache.has(targetRoleId)) {
    await member.roles.add(targetRoleId, `Sync Ranger main rank to ${rank}`);
  }
}

export function hasGuestOnly(member: GuildMember): boolean {
  return member.roles.cache.has(env.GUEST_ROLE_ID) && getMemberMainRank(member) === null;
}

export function hasSeniorRangerRole(member: GuildMember): boolean {
  return member.roles.cache.has(env.ROLE_SENIOR_RANGER_ID);
}
