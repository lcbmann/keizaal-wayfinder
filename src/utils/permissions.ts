import type { GuildMember } from "discord.js";
import { env } from "../config/env.js";
import { roleIdForRank } from "../config/roles.js";
import { rankAtLeast, type MainRank } from "../config/ranks.js";

export function memberHasRole(member: GuildMember, roleId: string): boolean {
  return member.roles.cache.has(roleId);
}

export function mainRankFromMember(member: GuildMember): MainRank | null {
  const ranks: MainRank[] = [
    "Ranger Commander",
    "Ranger Captain",
    "Ranger Marshal",
    "Ranger",
    "Apprentice"
  ];

  return ranks.find((rank) => member.roles.cache.has(roleIdForRank(rank))) ?? null;
}

export function memberRankAtLeast(member: GuildMember, minimum: MainRank): boolean {
  const rank = mainRankFromMember(member);
  return rank ? rankAtLeast(rank, minimum) : false;
}

export function canManageAll(member: GuildMember): boolean {
  return memberRankAtLeast(member, "Ranger Captain");
}

export function canOpenPromotionVotes(member: GuildMember): boolean {
  return memberRankAtLeast(member, "Ranger Marshal");
}

export function canApprovePromotions(member: GuildMember): boolean {
  return memberRankAtLeast(member, "Ranger Captain");
}

export function canUseTrailmarks(member: GuildMember): boolean {
  return mainRankFromMember(member) !== null;
}

export function canCreateTrailmarks(member: GuildMember): boolean {
  return memberRankAtLeast(member, "Ranger Marshal");
}

export function hasSeniorRanger(member: GuildMember): boolean {
  return member.roles.cache.has(env.ROLE_SENIOR_RANGER_ID);
}
