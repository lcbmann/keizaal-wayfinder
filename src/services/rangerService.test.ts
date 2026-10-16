import assert from "node:assert/strict";
import test from "node:test";
import { Collection, type Guild, type GuildMember } from "discord.js";
import { env } from "../config/env.js";
import { mainRankRoleIds, roleIdForRank } from "../config/roles.js";
import { MAIN_RANKS } from "../config/ranks.js";
import { supabase, type RangerRow } from "../db/supabase.js";
import { syncRetiredRangerRoles } from "./discordRoleService.js";
import { sortCorpsHistoryRows, syncMemberToRoster, syncRosterToDiscord } from "./rangerService.js";

function retirementFixture() {
  const guildRoles = new Collection<string, { id: string; name: string; editable: boolean }>(MAIN_RANKS.map((name) => {
    const id = roleIdForRank(name);
    return [id, { id, name, editable: true }];
  }));
  guildRoles.set("retired-role", { id: "retired-role", name: "Retired Ranger", editable: true });
  const cache = new Collection([...guildRoles.entries()].filter(([id]) => id !== "retired-role"));
  for (const id of ["earned-medal", env.ROLE_SENIOR_RANGER_ID, "unrelated-role"]) {
    cache.set(id, { id, name: id, editable: true });
  }
  const changes: string[] = [];
  let member: GuildMember;
  const guild = {
    id: "guild",
    roles: { fetch: async () => guildRoles },
    members: { fetch: async (input: { user: string; force: boolean }) => {
      assert.equal(input.user, "ranger");
      assert.equal(input.force, true);
      return member;
    } }
  } as unknown as Guild;
  member = {
    id: "ranger", guild, displayName: "Ranger Name", user: { username: "ranger", bot: false },
    roles: { cache,
      add: async (id: string) => { changes.push(`add:${id}`); cache.set(id, guildRoles.get(id)!); },
      remove: async (id: string | string[], reason?: string) => {
        if (reason === "Ranger retired from the Corps") {
          assert.equal(typeof id, "string", "use individual endpoints, not a full role replacement");
        }
        for (const roleId of Array.isArray(id) ? id : [id]) {
          changes.push(`remove:${roleId}`); cache.delete(roleId);
        }
      }
    }
  } as unknown as GuildMember;
  return { guild, member, cache, guildRoles, changes };
}

const retiredRanger = {
  id: "roster-id", discord_user_id: "ranger", current_rank: "First Captain", status: "Retired",
  join_date: "2026-06-01", joined_at: "2026-06-01T00:00:00Z", created_at: "2026-06-01T00:00:00Z"
} as RangerRow;

test("retirement removes all cumulative main ranks and grants Retired Ranger without removing recognition", async () => {
  const { guild, cache, changes } = retirementFixture();
  assert.equal(await syncRetiredRangerRoles(guild, "ranger"), true);
  for (const id of mainRankRoleIds()) assert.equal(cache.has(id), false);
  for (const id of ["retired-role", "earned-medal", env.ROLE_SENIOR_RANGER_ID, "unrelated-role"]) {
    assert.equal(cache.has(id), true);
  }
  assert.equal(changes[0], "add:retired-role");
});

test("retirement role changes are idempotent and concurrent member updates share one cleanup", async () => {
  const { guild, changes } = retirementFixture();
  await Promise.all([syncRetiredRangerRoles(guild, "ranger"), syncRetiredRangerRoles(guild, "ranger")]);
  const count = changes.length;
  assert.equal(count, mainRankRoleIds().length + 1);
  await syncRetiredRangerRoles(guild, "ranger");
  assert.equal(changes.length, count);
});

test("retirement still grants its role to an unranked member", async () => {
  const { guild, cache, changes } = retirementFixture();
  for (const id of mainRankRoleIds()) cache.delete(id);
  await syncRetiredRangerRoles(guild, "ranger");
  assert.deepEqual(changes, ["add:retired-role"]);
});

test("retirement skips departed members but does not hide Discord outages", async (t) => {
  const { guild } = retirementFixture();
  const fetch = t.mock.method(guild.members, "fetch", async () => {
    throw Object.assign(new Error("Unknown Member"), { code: 10007 });
  });
  assert.equal(await syncRetiredRangerRoles(guild, "ranger"), false);
  fetch.mock.mockImplementation(async () => { throw new Error("Discord unavailable"); });
  await assert.rejects(syncRetiredRangerRoles(guild, "ranger"), /Discord unavailable/);
});

test("retirement checks role existence and hierarchy before changing roles", async () => {
  for (const problem of ["missing-retired", "retired-hierarchy", "rank-hierarchy"] as const) {
    const { guild, guildRoles, changes } = retirementFixture();
    if (problem === "missing-retired") guildRoles.delete("retired-role");
    else guildRoles.get(problem === "retired-hierarchy" ? "retired-role" : roleIdForRank("First Captain"))!.editable = false;
    await assert.rejects(syncRetiredRangerRoles(guild, "ranger"), /Retirement is recorded/);
    assert.deepEqual(changes, []);
  }
});

test("retirement failures can be retried without restoring removed ranks", async (t) => {
  const { guild, member, cache } = retirementFixture();
  const originalRemove = member.roles.remove.bind(member.roles);
  const removal = t.mock.method(member.roles, "remove", async (id: string) => {
    if (id === roleIdForRank("Marshal")) throw new Error("Temporary role failure");
    return originalRemove(id);
  });
  await assert.rejects(syncRetiredRangerRoles(guild, "ranger"), /Temporary role failure/);
  assert.equal(cache.has("retired-role"), true);
  assert.equal(cache.has(roleIdForRank("First Captain")), false);
  assert.equal(cache.has(roleIdForRank("Captain")), false);
  assert.equal(cache.has(roleIdForRank("Marshal")), true);
  removal.mock.restore();
  await syncRetiredRangerRoles(guild, "ranger");
  for (const id of mainRankRoleIds()) assert.equal(cache.has(id), false);
});

test("a failed Retired Ranger grant does not strip a member's existing ranks", async (t) => {
  const { guild, member, cache } = retirementFixture();
  t.mock.method(member.roles, "add", async () => { throw new Error("Cannot grant role"); });
  await assert.rejects(syncRetiredRangerRoles(guild, "ranger"), /Cannot grant role/);
  for (const id of mainRankRoleIds()) assert.equal(cache.has(id), true);
});

test("retirement repairs role changes made concurrently by duty cleanup", async (t) => {
  const { guild, member, cache } = retirementFixture();
  const remove = member.roles.remove.bind(member.roles);
  let raced = false;
  t.mock.method(member.roles, "remove", async (id: string) => {
    const result = await remove(id);
    if (!raced && id === roleIdForRank("Apprentice")) {
      raced = true;
      cache.delete("retired-role");
      cache.set(roleIdForRank("Captain"), { id: roleIdForRank("Captain"), name: "Captain", editable: true });
    }
    return result;
  });
  await syncRetiredRangerRoles(guild, "ranger");
  assert.equal(cache.has("retired-role"), true);
  for (const id of mainRankRoleIds()) assert.equal(cache.has(id), false);
});

test("roster-to-Discord sync cannot restore retired rank roles", async () => {
  const { member, cache } = retirementFixture();
  await syncRosterToDiscord(member, retiredRanger);
  for (const id of mainRankRoleIds()) assert.equal(cache.has(id), false);
  assert.equal(cache.has("retired-role"), true);
});

test("normal rank synchronization keeps cumulative ranks for non-retired members", async () => {
  for (const status of ["Active", "On Leave", "Inactive"] as const) {
    const { member, cache } = retirementFixture();
    await syncRosterToDiscord(member, { ...retiredRanger, current_rank: "Captain", status });
    assert.equal(cache.has(roleIdForRank("First Captain")), false);
    for (const rank of ["Captain", "Marshal", "Ranger", "Apprentice"] as const) {
      assert.equal(cache.has(roleIdForRank(rank)), true);
    }
    assert.equal(cache.has("retired-role"), false);
  }
});

test("Discord updates preserve a retired Ranger's historical rank without upserting", async (t) => {
  const { member, cache } = retirementFixture();
  t.mock.method(supabase, "from", () => {
    const query = { select: () => query, eq: () => query,
      maybeSingle: async () => ({ data: retiredRanger, error: null }) };
    return query;
  });
  const result = await syncMemberToRoster(member);
  assert.equal(result?.current_rank, "First Captain");
  for (const id of mainRankRoleIds()) assert.equal(cache.has(id), false);
});

test("a Discord update in flight cannot overwrite a newly recorded retirement or regrant ranks", async (t) => {
  const { member, cache } = retirementFixture();
  let upserted: Record<string, unknown> | undefined;
  t.mock.method(supabase, "from", () => {
    const query = { select: () => query, eq: () => query,
      maybeSingle: async () => ({ data: { ...retiredRanger, status: "Active" }, error: null }),
      upsert: (payload: Record<string, unknown>) => { upserted = payload; return query; },
      single: async () => ({ data: retiredRanger, error: null }) };
    return query;
  });
  assert.equal((await syncMemberToRoster(member))?.status, "Retired");
  assert.ok(upserted);
  assert.equal(Object.hasOwn(upserted, "status"), false);
  for (const id of mainRankRoleIds()) assert.equal(cache.has(id), false);
});

test("sorts Corps standing by exact join timestamp before database insertion order", () => {
  const rows = sortCorpsHistoryRows([
    {
      id: "later",
      discord_username: "later",
      join_date: "2026-06-02",
      joined_at: "2026-06-02T22:03:00.000Z",
      created_at: "2026-06-02T00:00:00.000Z",
      currentRangerId: "later"
    },
    {
      id: "earlier",
      discord_username: "earlier",
      join_date: "2026-06-02",
      joined_at: "2026-06-02T18:59:00.000Z",
      created_at: "2026-06-03T00:00:00.000Z",
      currentRangerId: "earlier"
    }
  ]);

  assert.deepEqual(rows.map((row) => row.id), ["earlier", "later"]);
});

test("uses the calendar date as a deterministic fallback when an exact time is unknown", () => {
  const rows = sortCorpsHistoryRows([
    {
      id: "june-3",
      discord_username: "june-3",
      join_date: "2026-06-03",
      joined_at: null,
      created_at: "2026-06-01T00:00:00.000Z",
      currentRangerId: "june-3"
    },
    {
      id: "june-2",
      discord_username: "june-2",
      join_date: "2026-06-02",
      joined_at: null,
      created_at: "2026-06-20T00:00:00.000Z",
      currentRangerId: "june-2"
    }
  ]);

  assert.deepEqual(rows.map((row) => row.id), ["june-2", "june-3"]);
});
