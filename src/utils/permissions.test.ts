import assert from "node:assert/strict";
import test from "node:test";
import { Collection, type GuildMember } from "discord.js";
import { env } from "../config/env.js";
import { roleIdForRank } from "../config/roles.js";
import { canApprovePromotions, canCreateTrailmarks, canManageAll, canOpenPromotionVotes, canUseTrailmarks, mainRankFromMember } from "./permissions.js";
import { RANKS } from "../config/ranks.js";

function memberWithRoles(...ids: string[]): GuildMember {
  return { roles: { cache: new Collection(ids.map((id) => [id, { id }])) } } as unknown as GuildMember;
}

test("Aedra can use Trailmarks without having a Corps rank", () => {
  const member = memberWithRoles(env.ROLE_AEDRA_ID);
  assert.equal(canUseTrailmarks(member), true);
  assert.equal(mainRankFromMember(member), null);
  assert.equal(canCreateTrailmarks(member), false);
  assert.equal(canManageAll(member), false);
});

test("all existing Corps ranks retain Trailmark access", () => {
  for (const rank of ["Apprentice", "Ranger", "Ranger Marshal", "Ranger Captain", "Ranger Commander"] as const) {
    assert.equal(canUseTrailmarks(memberWithRoles(roleIdForRank(rank))), true, rank);
  }
});

test("unrelated roles and members without roles do not gain Trailmark access", () => {
  assert.equal(canUseTrailmarks(memberWithRoles("unrelated-role")), false);
  assert.equal(canUseTrailmarks(memberWithRoles()), false);
});

test("Captains and Commanders have identical configured management privileges", () => {
  const { sort: captainSort, envRoleKey: captainRole, ...captainPrivileges } = RANKS["Ranger Captain"];
  const { sort: commanderSort, envRoleKey: commanderRole, ...commanderPrivileges } = RANKS["Ranger Commander"];
  assert.deepEqual(captainPrivileges, commanderPrivileges);
  assert.notEqual(captainSort, commanderSort);
  assert.notEqual(captainRole, commanderRole);
  for (const rank of ["Ranger Captain", "Ranger Commander"] as const) {
    const member = memberWithRoles(roleIdForRank(rank));
    for (const canManage of [canManageAll, canApprovePromotions, canOpenPromotionVotes, canCreateTrailmarks]) {
      assert.equal(canManage(member), true);
    }
  }
  assert.equal(canManageAll(memberWithRoles(roleIdForRank("Ranger Marshal"))), false);
  assert.equal(canApprovePromotions(memberWithRoles(roleIdForRank("Ranger Marshal"))), false);
});
