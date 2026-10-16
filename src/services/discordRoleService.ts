import type { Guild, GuildMember } from "discord.js";
import { env } from "../config/env.js";
import { mainRankRoleIds, roleIdForRank } from "../config/roles.js";
import { MAIN_RANKS, rankAtLeast, type MainRank } from "../config/ranks.js";
import { UserFacingError } from "../utils/errors.js";

const activeRetirementSyncs = new Map<string, Promise<boolean>>();

export async function syncRetiredRangerRoles(guild: Guild, discordUserId: string): Promise<boolean> {
  const key = `${guild.id}:${discordUserId}`;
  const active = activeRetirementSyncs.get(key);
  if (active) {
    return active;
  }
  const sync = applyRetiredRangerRoles(guild, discordUserId).finally(() => {
    activeRetirementSyncs.delete(key);
  });
  activeRetirementSyncs.set(key, sync);
  return sync;
}

async function applyRetiredRangerRoles(guild: Guild, discordUserId: string): Promise<boolean> {
  let member: GuildMember;
  try {
    member = await guild.members.fetch({ user: discordUserId, force: true });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 10007) {
      return false;
    }
    throw error;
  }
  const roles = await guild.roles.fetch();
  const retiredRole = roles.find((role) => role.name === "Retired Ranger");
  const rankRoles = mainRankRoleIds().filter((id) => member.roles.cache.has(id));
  if (!retiredRole?.editable || rankRoles.some((id) => !roles.get(id)?.editable)) {
    throw new UserFacingError(
      "Retirement is recorded, but Wayfinder could not finish changing Discord roles. "
      + "Make sure the Retired Ranger role exists and Wayfinder can manage it and all rank roles, then run retirement again."
    );
  }
  // Duty cleanup can run concurrently. Verify fresh state before declaring the
  // retirement complete, and use individual endpoints to preserve other roles.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!member.roles.cache.has(retiredRole.id)) {
      await member.roles.add(retiredRole.id, "Ranger retired from the Corps");
    }
    for (const id of mainRankRoleIds().filter((id) => member.roles.cache.has(id))) {
      await member.roles.remove(id, "Ranger retired from the Corps");
    }
    member = await guild.members.fetch({ user: discordUserId, force: true });
    if (member.roles.cache.has(retiredRole.id) && !mainRankRoleIds().some((id) => member.roles.cache.has(id))) {
      return true;
    }
  }
  throw new UserFacingError("Retirement is recorded, but Discord roles kept changing during cleanup. Run retirement again to finish.");
}

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
