export const RANKS = {
  "Ranger Commander": {
    sort: 1,
    envRoleKey: "ROLE_RANGER_COMMANDER_ID",
    canManageAll: true,
    canSeeAllTrailmarks: true,
    canApprovePromotions: true,
    canOpenPromotionVotes: true,
    canCreateTrailmarks: true,
    canRecruit: true
  },
  "Ranger Captain": {
    sort: 2,
    envRoleKey: "ROLE_RANGER_CAPTAIN_ID",
    canSeeAllTrailmarks: true,
    canApprovePromotions: true,
    canOpenPromotionVotes: true,
    canCreateTrailmarks: true,
    canRecruit: true
  },
  "Ranger Marshal": {
    sort: 3,
    envRoleKey: "ROLE_RANGER_MARSHAL_ID",
    canOpenPromotionVotes: true,
    canCreateTrailmarks: true,
    canRecruit: true
  },
  Ranger: {
    sort: 4,
    envRoleKey: "ROLE_RANGER_ID",
    canVoteOnApprenticePromotions: true
  },
  Apprentice: {
    sort: 5,
    envRoleKey: "ROLE_APPRENTICE_ID"
  }
} as const;

export type MainRank = keyof typeof RANKS;

export const MAIN_RANKS = Object.keys(RANKS) as MainRank[];

export function isMainRank(value: string): value is MainRank {
  return value in RANKS;
}

export function rankSort(rank: MainRank): number {
  return RANKS[rank].sort;
}

export function rankAtLeast(rank: MainRank, minimum: MainRank): boolean {
  return rankSort(rank) <= rankSort(minimum);
}
