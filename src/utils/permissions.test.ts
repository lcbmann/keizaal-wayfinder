import assert from "node:assert/strict";
import test from "node:test";
import { Collection, type GuildMember } from "discord.js";
import { env } from "../config/env.js";
import { roleIdForRank } from "../config/roles.js";
import { canCreateTrailmarks, canManageAll, canUseTrailmarks, mainRankFromMember } from "./permissions.js";

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
