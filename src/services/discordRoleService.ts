import type { GuildMember } from "discord.js";
import { env } from "../config/env.js";
import { mainRankRoleIds, roleIdForRank } from "../config/roles.js";
import { MAIN_RANKS, rankAtLeast, type MainRank } from "../config/ranks.js";

export function getMemberMainRank(member: GuildMember): MainRank | null {
  return MAIN_RANKS.find((rank) => member.roles.cache.has(roleIdForRank(rank))) ?? null;
}

export async function syncCumulativeMainRanks(member: GuildMember, rank: MainRank): Promise<void> {
  const desiredRoleIds = MAIN_RANKS.filter((candidateRank) => rankAtLeast(rank, candidateRank)).map((candidateRank) =>
    roleIdForRank(candidateRank)
  );
  const desiredRoleIdSet = new Set(desiredRoleIds);
  const rankRoleIds = mainRankRoleIds();
  const removeRoleIds = rankRoleIds.filter((roleId) => !desiredRoleIdSet.has(roleId) && member.roles.cache.has(roleId));
  const addRoleIds = desiredRoleIds.filter((roleId) => !member.roles.cache.has(roleId));

  if (removeRoleIds.length > 0) {
    await member.roles.remove(removeRoleIds, `Sync Ranger cumulative ranks to ${rank}`);
  }

  if (addRoleIds.length > 0) {
    await member.roles.add(addRoleIds, `Sync Ranger cumulative ranks to ${rank}`);
  }
}

export function hasGuestOnly(member: GuildMember): boolean {
  return member.roles.cache.has(env.GUEST_ROLE_ID) && getMemberMainRank(member) === null;
}

export function hasSeniorRangerRole(member: GuildMember): boolean {
  return member.roles.cache.has(env.ROLE_SENIOR_RANGER_ID);
}
