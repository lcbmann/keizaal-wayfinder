import assert from "node:assert/strict";
import test from "node:test";
import { Collection, type Guild, type GuildMember } from "discord.js";
import { env } from "../config/env.js";
import { roleIdForRank } from "../config/roles.js";
import type { MainRank } from "../config/ranks.js";
import { supabase, type RangerRow } from "../db/supabase.js";
import { eligibleForSeniorRanger, synchronizeSeniorRangerRole, synchronizeSeniorRangers } from "./seniorRangerService.js";

const ranger = {
  discord_user_id: "ranger",
  current_rank: "Ranger",
  status: "Active",
  joined_at: "2026-01-01T12:00:00.000Z",
  join_date: "2026-01-01"
} as RangerRow;
const ninetyDays = new Date("2026-04-01T12:00:00.000Z");

test("Senior Ranger uses the exact 90-day Long Watch threshold", () => {
  assert.equal(eligibleForSeniorRanger(ranger, new Date(ninetyDays.getTime() - 1)), false);
  assert.equal(eligibleForSeniorRanger(ranger, ninetyDays), true);
});

test("Apprentices cannot receive Senior Ranger, while full Rangers and leadership can", () => {
  assert.equal(eligibleForSeniorRanger({ ...ranger, current_rank: "Apprentice" }, ninetyDays), false);
  for (const current_rank of ["Ranger", "Ranger Marshal", "Ranger Captain", "Ranger Commander"] as const) {
    assert.equal(eligibleForSeniorRanger({ ...ranger, current_rank }, ninetyDays), true);
  }
});

test("Senior Ranger includes members on leave but excludes new grants to retired or inactive members", () => {
  assert.equal(eligibleForSeniorRanger({ ...ranger, status: "On Leave" }, ninetyDays), true);
  assert.equal(eligibleForSeniorRanger({ ...ranger, status: "Retired" }, ninetyDays), false);
  assert.equal(eligibleForSeniorRanger({ ...ranger, status: "Inactive" }, ninetyDays), false);
});

test("Senior Ranger falls back to the recorded Corps join date and rejects invalid dates", () => {
  assert.equal(eligibleForSeniorRanger({ ...ranger, joined_at: null }, new Date("2026-04-01T00:00:00Z")), true);
  assert.equal(eligibleForSeniorRanger({ ...ranger, joined_at: "invalid" }, ninetyDays), false);
  assert.equal(eligibleForSeniorRanger({ ...ranger, joined_at: "2027-01-01T00:00:00Z" }, ninetyDays), false);
});

function memberFixture(id: string, rank: MainRank | null, hasSenior = false) {
  const added: string[] = [];
  const cache = new Collection<string, { id: string }>();
  if (rank) {
    cache.set(roleIdForRank(rank), { id: roleIdForRank(rank) });
  }
  if (hasSenior) {
    cache.set(env.ROLE_SENIOR_RANGER_ID, { id: env.ROLE_SENIOR_RANGER_ID });
  }
  const member = {
    id, user: { bot: false },
    roles: {
      cache,
      add: async (role: string) => { added.push(role); cache.set(role, { id: role }); }
    }
  } as unknown as GuildMember;
  return { member, added };
}

test("eligible members receive the recognition once without changing their main rank", async () => {
  const { member, added } = memberFixture("ranger", "Ranger Captain");
  assert.equal(await synchronizeSeniorRangerRole(member, { ...ranger, current_rank: "Ranger Captain" }), true);
  assert.equal(await synchronizeSeniorRangerRole(member, ranger), false);
  assert.deepEqual(added, [env.ROLE_SENIOR_RANGER_ID]);
  assert.equal(member.roles.cache.has(roleIdForRank("Ranger Captain")), true);
});

test("a stale roster cannot grant recognition to someone who no longer has a full Ranger role", async () => {
  for (const rank of [null, "Apprentice"] as const) {
    const { member, added } = memberFixture("ranger", rank);
    assert.equal(await synchronizeSeniorRangerRole(member, ranger), false);
    assert.equal(added.length, 0);
  }
});

test("previous Senior Ranger recognition is preserved after retirement", async () => {
  const { member, added } = memberFixture("ranger", null, true);
  assert.equal(await synchronizeSeniorRangerRole(member, { ...ranger, status: "Retired" }), false);
  assert.equal(member.roles.cache.has(env.ROLE_SENIOR_RANGER_ID), true);
  assert.equal(added.length, 0);
});

test("startup backfill grants current members, skips departed members, and avoids Gateway member queries", async (t) => {
  const rows = [ranger, { ...ranger, discord_user_id: "departed" }];
  t.mock.method(supabase, "from", (table: string) => {
    assert.equal(table, "rangers");
    const query = {
      select: () => query,
      in: () => query,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve)
    };
    return query;
  });
  const { member, added } = memberFixture("ranger", "Ranger");
  const fetched: string[] = [];
  const guild = {
    roles: { fetch: async () => ({ editable: true }) },
    members: {
      fetch: async (input: { user: string; force: boolean }) => {
        assert.equal(input.force, true);
        fetched.push(input.user);
        if (input.user === "departed") {
          throw Object.assign(new Error("Unknown Member"), { code: 10007 });
        }
        return member;
      }
    }
  } as unknown as Guild;
  assert.equal(await synchronizeSeniorRangers(guild), 1);
  assert.deepEqual(fetched, ["ranger", "departed"]);
  assert.deepEqual(added, [env.ROLE_SENIOR_RANGER_ID]);
});
