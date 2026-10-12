import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Collection, type Guild, type GuildMember } from "discord.js";
import { roleIdForRank } from "../config/roles.js";
import type { MainRank } from "../config/ranks.js";
import { supabase } from "../db/supabase.js";
import {
  apprenticeshipRequestExpired,
  cleanupApprenticeshipRecords
} from "./apprenticeshipService.js";

const now = Date.parse("2026-10-12T12:00:00Z");
const day = 24 * 60 * 60 * 1000;
const old = new Date(now - 31 * day).toISOString();
const recent = new Date(now - day).toISOString();

test("waiting requests expire at 30 days, including when their notices were recently repaired", () => {
  assert.equal(apprenticeshipRequestExpired(new Date(now - 30 * day + 1).toISOString(), now), false);
  assert.equal(apprenticeshipRequestExpired(new Date(now - 30 * day).toISOString(), now), true);
  assert.equal(apprenticeshipRequestExpired(old, now), true);
  assert.equal(apprenticeshipRequestExpired(recent, now), false);
});

type Row = Record<string, unknown>;
function request(id: string, createdAt = recent): Row {
  return { discord_user_id: id, seeking: "Apprentice", created_at: createdAt, updated_at: recent };
}
function pairing(status = "Active"): Row {
  return {
    id: "pairing", mentor_discord_user_id: "mentor", apprentice_discord_user_id: "apprentice",
    status, created_at: old, updated_at: recent
  };
}

function cleanupFixture(t: TestContext, options: {
  preferences?: Row[];
  pairings?: Row[];
  missing?: string[];
  noRank?: string[];
  retired?: string[];
  onLeave?: string[];
  unavailable?: string[];
  noRoster?: string[];
  inactive?: string[];
  renewBeforeDelete?: boolean;
}) {
  t.mock.method(Date, "now", () => now);
  const tables: Record<string, Row[]> = {
    apprenticeship_preferences: options.preferences ?? [],
    apprenticeships: options.pairings ?? [],
    rangers: ["mentor", "apprentice", "requester"].map((id) => ({
      discord_user_id: id,
      status: options.retired?.includes(id) ? "Retired" : options.onLeave?.includes(id) ? "On Leave"
        : options.inactive?.includes(id) ? "Inactive" : "Active"
    })).filter((ranger) => !options.noRoster?.includes(ranger.discord_user_id))
  };
  t.mock.method(supabase, "from", (table: string) => {
    assert.ok(tables[table], `Unexpected table ${table}`);
    let operation = "select";
    let update: Row = {};
    const filters: Array<(row: Row) => boolean> = [];
    const result = () => {
      const rows = tables[table] ?? [];
      const matched = rows.filter((row) => filters.every((filter) => filter(row)));
      if (operation === "delete") {
        tables[table] = rows.filter((row) => !matched.includes(row));
      } else if (operation === "update") {
        matched.forEach((row) => Object.assign(row, update));
      }
      return { data: matched.map((row) => ({ ...row })), error: null };
    };
    const query = {
      select: () => query,
      order: () => query,
      eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return query; },
      in: (key: string, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return query; },
      delete: () => {
        operation = "delete";
        if (options.renewBeforeDelete) {
          rowsRenewed(tables[table] ?? []);
        }
        return query;
      },
      update: (payload: Row) => { operation = "update"; update = payload; return query; },
      maybeSingle: async () => ({ data: result().data[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve)
    };
    return query;
  });
  const guild = {
    id: t.name,
    members: {
      fetch: async ({ user }: { user: string }) => {
        if (options.unavailable?.includes(user)) {
          throw Object.assign(new Error("Discord unavailable"), { code: 50013 });
        }
        if (options.missing?.includes(user)) {
          throw Object.assign(new Error("Unknown Member"), { code: 10007 });
        }
        const rank: MainRank = user === "apprentice" ? "Apprentice" : "Ranger";
        const roles = options.noRank?.includes(user) ? [] : [roleIdForRank(rank)];
        return { roles: { cache: new Collection(roles.map((id) => [id, { id }])) } } as unknown as GuildMember;
      }
    },
    channels: { fetch: async () => null }
  } as unknown as Guild;
  return { guild, tables };
}

function rowsRenewed(rows: Row[]) {
  for (const row of rows) {
    row.created_at = new Date(now).toISOString();
    row.updated_at = new Date(now).toISOString();
  }
}

test("cleanup removes old waiting requests even if updated_at is recent", async (t) => {
  const { guild, tables } = cleanupFixture(t, { preferences: [request("requester", old)] });
  assert.equal(await cleanupApprenticeshipRecords(guild), 1);
  assert.equal(tables.apprenticeship_preferences?.length, 0);
});

for (const kind of ["missing", "retired", "noRank"] as const) {
  test(`cleanup removes requests and ends active pairings when a member is ${kind}`, async (t) => {
    const { guild, tables } = cleanupFixture(t, {
      preferences: [request("mentor")], pairings: [pairing()], [kind]: ["mentor"]
    });
    assert.equal(await cleanupApprenticeshipRecords(guild), 2);
    assert.equal(tables.apprenticeship_preferences?.length, 0);
    assert.equal(tables.apprenticeships?.[0]?.status, "Ended");
    assert.ok(tables.apprenticeships?.[0]?.ended_at);
  });
}

test("cleanup preserves old active pairings and members on leave", async (t) => {
  const { guild, tables } = cleanupFixture(t, {
    preferences: [request("mentor")], pairings: [pairing()], onLeave: ["mentor"]
  });
  assert.equal(await cleanupApprenticeshipRecords(guild), 0);
  assert.equal(tables.apprenticeship_preferences?.length, 1);
  assert.equal(tables.apprenticeships?.[0]?.status, "Active");
});

test("pending pairings expire after 30 days without deleting their history", async (t) => {
  const { guild, tables } = cleanupFixture(t, { pairings: [pairing("Proposed")] });
  assert.equal(await cleanupApprenticeshipRecords(guild), 1);
  assert.equal(tables.apprenticeships?.length, 1);
  assert.equal(tables.apprenticeships?.[0]?.status, "Ended");
  assert.match(String(tables.apprenticeships?.[0]?.end_reason), /30 days/);
});

test("a failed member lookup cannot delete a valid request", async (t) => {
  const { guild, tables } = cleanupFixture(t, { preferences: [request("requester")], unavailable: ["requester"] });
  await assert.rejects(cleanupApprenticeshipRecords(guild), /Discord unavailable/);
  assert.equal(tables.apprenticeship_preferences?.length, 1);
});

test("cleanup cannot delete a waiting request renewed during the sweep", async (t) => {
  const { guild, tables } = cleanupFixture(t, { preferences: [request("requester", old)], renewBeforeDelete: true });
  assert.equal(await cleanupApprenticeshipRecords(guild), 0);
  assert.equal(tables.apprenticeship_preferences?.length, 1);
});

test("a recent sponsored recruit can await Marshal review before gaining a Corps rank", async (t) => {
  const pending = { ...pairing("Pending Marshal"), created_at: recent };
  const { guild, tables } = cleanupFixture(t, {
    pairings: [pending], noRoster: ["apprentice"], noRank: ["apprentice"]
  });
  assert.equal(await cleanupApprenticeshipRecords(guild), 0);
  assert.equal(tables.apprenticeships?.[0]?.status, "Pending Marshal");
});

test("a sponsorship closes if the unranked recruit leaves the server", async (t) => {
  const pending = { ...pairing("Pending Marshal"), created_at: recent };
  const { guild, tables } = cleanupFixture(t, {
    pairings: [pending], noRoster: ["apprentice"], missing: ["apprentice"]
  });
  assert.equal(await cleanupApprenticeshipRecords(guild), 1);
  assert.equal(tables.apprenticeships?.[0]?.status, "Ended");
});

test("a promoted Apprentice's outdated mentor request is removed", async (t) => {
  const { guild, tables } = cleanupFixture(t, {
    preferences: [{ ...request("requester"), seeking: "Mentor" }]
  });
  assert.equal(await cleanupApprenticeshipRecords(guild), 1);
  assert.equal(tables.apprenticeship_preferences?.length, 0);
});

test("inactive members stop advertising for new Apprentices", async (t) => {
  const { guild, tables } = cleanupFixture(t, {
    preferences: [request("requester")], inactive: ["requester"]
  });
  assert.equal(await cleanupApprenticeshipRecords(guild), 1);
  assert.equal(tables.apprenticeship_preferences?.length, 0);
});
