import { env } from "./env.js";
import { MAIN_RANKS, RANKS, type MainRank } from "./ranks.js";

export function roleIdForRank(rank: MainRank): string {
  return env[RANKS[rank].envRoleKey];
}

export function mainRankRoleIds(): string[] {
  return MAIN_RANKS.map((rank) => roleIdForRank(rank));
}

export const careerRoleIds = [
  env.CAREER_TAILOR_ROLE_ID,
  env.CAREER_COOK_ROLE_ID,
  env.CAREER_HUNTER_ROLE_ID,
  env.CAREER_WARRIOR_ROLE_ID,
  env.CAREER_ALCHEMIST_ROLE_ID,
  env.CAREER_BLACKSMITH_ROLE_ID,
  env.CAREER_MINER_ROLE_ID,
  env.CAREER_WOODWORKER_ROLE_ID
];
