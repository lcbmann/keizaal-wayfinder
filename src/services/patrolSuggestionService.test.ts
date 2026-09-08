import assert from "node:assert/strict";
import test from "node:test";
import { HOLDS } from "../config/holds.js";
import { Collection, type Guild, type GuildMember } from "discord.js";
import { supabase, type TrailmarkRow, type TrailmarkSessionRow } from "../db/supabase.js";
import {
  buildPatrolSuggestion,
  createPatrolSuggestionRotation,
  listTrailmarkSessions,
  patrolRouteOptions,
  rankPatrolLocationsByActivity,
  selectPatrolHold
} from "./patrolSuggestionService.js";

test("route options cycle ranked pairs from only the five least-recently visited locations", () => {
  const ranked = Array.from({ length: 7 }, (_, i) => trailmark(String(i)));
  const options = patrolRouteOptions(ranked);
  assert.equal(options.length, 10);
  assert.deepEqual(options[0]?.map(({ id }) => id), ["0", "1"]);
  assert.deepEqual(options[1]?.map(({ id }) => id), ["0", "2"]);
  assert.equal(new Set(options.map((route) => route.map(({ id }) => id).join(":"))).size, 10);
  assert.ok(options.flat().every(({ id }) => Number(id) < 5));
});

test("route rotation is independent per Ranger and Hold and wraps without immediate repeats", () => {
  const next = createPatrolSuggestionRotation();
  const options = patrolRouteOptions([trailmark("a"), trailmark("b"), trailmark("c")]);
  const seen = Array.from({ length: 4 }, () => options[next("guild:ranger:Whiterun") % options.length]);
  assert.notDeepEqual(seen[0], seen[1]);
  assert.notDeepEqual(seen[1], seen[2]);
  assert.deepEqual(seen[0], seen[3]);
  assert.equal(next("guild:other-ranger:Whiterun"), 0);
  assert.equal(next("guild:ranger:The Rift"), 0);
  for (let i = 0; i < 116; i++) next("guild:ranger:Whiterun");
  assert.equal(next("guild:ranger:Whiterun"), 0);
});

test("route options handle Holds with fewer than two distinct locations", () => {
  assert.deepEqual(patrolRouteOptions([]), [[]]);
  const single = trailmark("a");
  assert.deepEqual(patrolRouteOptions([single]), [[single]]);
  assert.deepEqual(patrolRouteOptions([single, trailmark("b")]).length, 1);
});

test("patrol visit history reads beyond the first database result page", async (t) => {
  const location = trailmark("a");
  const ranges: number[][] = [];
  const first = Array.from({ length: 1000 }, (_, i) => session(String(i), location, "2026-09-07T00:00:00Z"));
  const oldest = session("old", location, "2026-09-01T00:00:00Z");
  t.mock.method(supabase, "from", (table: string) => {
    assert.equal(table, "trailmark_sessions");
    const query = {
      select: () => query, in: () => query, order: () => query,
      range: async (from: number, to: number) => { ranges.push([from, to]); return { data: from === 0 ? first : [oldest], error: null }; }
    };
    return query;
  });
  assert.equal((await listTrailmarkSessions([location])).length, 1001);
  assert.deepEqual(ranges, [[0, 999], [1000, 1999]]);
});

test("patrol embeds rotate routes without querying or targeting any contacts", async (t) => {
  t.mock.method(supabase, "from", (table: string) => {
    assert.ok(["rangers", "trailmarks", "trailmark_sessions"].includes(table), `Unexpected contact query: ${table}`);
    const query = {
      select: () => query, eq: () => query, in: () => query, order: () => query,
      maybeSingle: async () => ({ data: { assigned_hold: "Whiterun" }, error: null }),
      range: async () => ({ data: [], error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [trailmark("a"), trailmark("b"), trailmark("c")], error: null }).then(resolve)
    };
    return query;
  });
  const guild = { id: "patrol-test", emojis: { cache: new Collection() } } as unknown as Guild;
  const member = { id: "patrol-test-ranger" } as GuildMember;
  const first = (await buildPatrolSuggestion({ guild, member })).embed.toJSON();
  const second = (await buildPatrolSuggestion({ guild, member })).embed.toJSON();
  assert.notEqual(first.fields?.[0]?.value, second.fields?.[0]?.value);
  assert.doesNotMatch(JSON.stringify(first), /confirm|contact|group records|needs checking/i);
  assert.match(first.description ?? "", /recorded Trailmark visit/);
});

test("patrol suggestions prefer an explicitly requested Hold", () => {
  assert.equal(selectPatrolHold({
    requestedHold: "The Rift",
    assignedHold: "Whiterun",
    discordUserId: "123",
    date: new Date("2026-08-30T00:00:00Z")
  }), "The Rift");
});

test("patrol suggestions use a Ranger's assigned Hold when no Hold is requested", () => {
  assert.equal(selectPatrolHold({
    assignedHold: "Whiterun",
    discordUserId: "123",
    date: new Date("2026-08-30T00:00:00Z")
  }), "Whiterun");
});

test("unassigned patrol suggestions use a stable daily Hold rotation", () => {
  const input = { discordUserId: "123", date: new Date("2026-08-30T00:00:00Z") };
  const first = selectPatrolHold(input);
  assert.equal(selectPatrolHold(input), first);
  assert.equal(HOLDS.includes(first), true);
});

test("recent activity at a canonical Trailmark keeps its anchored aliases fresh", () => {
  const whiterun = trailmark("whiterun", { name: "Whiterun" });
  const noticeBoard = trailmark("whiterun-notice-board", {
    name: "Whiterun Notice Board",
    patrol_anchor_trailmark_id: whiterun.id
  });
  const rorikstead = trailmark("outside-rorikstead", { name: "Outside Rorikstead" });

  const ranked = rankPatrolLocationsByActivity(
    [noticeBoard, rorikstead, whiterun],
    [
      session("whiterun-recent", whiterun, "2026-09-02T03:00:00.000Z"),
      session("rorikstead-older", rorikstead, "2026-09-01T03:00:00.000Z")
    ]
  );

  assert.deepEqual(ranked.map((item) => item.id), [rorikstead.id, whiterun.id]);
});

test("recent activity at an anchored alias keeps its canonical Trailmark fresh", () => {
  const whiterun = trailmark("whiterun", { name: "Whiterun" });
  const noticeBoard = trailmark("whiterun-notice-board", {
    name: "Whiterun Notice Board",
    patrol_anchor_trailmark_id: whiterun.id
  });
  const rorikstead = trailmark("outside-rorikstead", { name: "Outside Rorikstead" });

  const ranked = rankPatrolLocationsByActivity(
    [whiterun, noticeBoard, rorikstead],
    [
      session("notice-recent", noticeBoard, "2026-09-02T03:00:00.000Z"),
      session("rorikstead-older", rorikstead, "2026-09-01T03:00:00.000Z")
    ]
  );

  assert.deepEqual(ranked.map((item) => item.id), [rorikstead.id, whiterun.id]);
});

test("a co-located Trailmark group appears only once and uses its canonical anchor", () => {
  const whiterun = trailmark("whiterun", { name: "Whiterun" });
  const noticeBoard = trailmark("whiterun-notice-board", {
    name: "Whiterun Notice Board",
    patrol_anchor_trailmark_id: whiterun.id
  });

  for (const input of [[whiterun, noticeBoard], [noticeBoard, whiterun]]) {
    const ranked = rankPatrolLocationsByActivity(input, []);
    assert.deepEqual(ranked.map((item) => item.id), [whiterun.id]);
  }
});

test("unrelated Trailmarks remain separate patrol locations", () => {
  const whiterun = trailmark("whiterun", { name: "Whiterun" });
  const watchtower = trailmark("whiterun-watchtower", { name: "Whiterun Watchtower" });

  const ranked = rankPatrolLocationsByActivity([watchtower, whiterun], []);

  assert.deepEqual(ranked.map((item) => item.id), [whiterun.id, watchtower.id]);
});

test("group freshness uses the true latest session even when sessions are unsorted", () => {
  const whiterun = trailmark("whiterun", { name: "Whiterun" });
  const noticeBoard = trailmark("whiterun-notice-board", {
    name: "Whiterun Notice Board",
    patrol_anchor_trailmark_id: whiterun.id
  });
  const rorikstead = trailmark("outside-rorikstead", { name: "Outside Rorikstead" });

  const ranked = rankPatrolLocationsByActivity(
    [whiterun, noticeBoard, rorikstead],
    [
      session("whiterun-old", whiterun, "2026-08-30T03:00:00.000Z"),
      session("notice-new", noticeBoard, "2026-09-02T03:00:00.000Z"),
      session("rorikstead-middle", rorikstead, "2026-09-01T03:00:00.000Z")
    ]
  );

  assert.deepEqual(ranked.map((item) => item.id), [rorikstead.id, whiterun.id]);
});

test("a missing or inactive anchor uses a deterministic active fallback", () => {
  const inactiveAnchor = trailmark("inactive-whiterun", {
    name: "Whiterun",
    active: false
  });
  const noticeBoard = trailmark("whiterun-notice-board", {
    name: "Whiterun Notice Board",
    patrol_anchor_trailmark_id: inactiveAnchor.id
  });
  const gate = trailmark("whiterun-gate", {
    name: "Whiterun Gate",
    patrol_anchor_trailmark_id: inactiveAnchor.id
  });

  const forward = rankPatrolLocationsByActivity([inactiveAnchor, noticeBoard, gate], []);
  const reversed = rankPatrolLocationsByActivity([gate, noticeBoard, inactiveAnchor], []);
  assert.equal(forward.length, 1);
  assert.equal(forward[0]?.active, true);
  assert.deepEqual(reversed.map((item) => item.id), forward.map((item) => item.id));

  const missingForward = rankPatrolLocationsByActivity([noticeBoard, gate], []);
  const missingReversed = rankPatrolLocationsByActivity([gate, noticeBoard], []);
  assert.equal(missingForward.length, 1);
  assert.deepEqual(missingReversed.map((item) => item.id), missingForward.map((item) => item.id));
});

type PatrolTrailmark = TrailmarkRow & { patrol_anchor_trailmark_id: string | null };

function trailmark(id: string, overrides: Partial<PatrolTrailmark> = {}): PatrolTrailmark {
  return {
    id,
    name: id,
    slug: id,
    hold: "Whiterun",
    location_description: `${id} location`,
    screenshot_url: null,
    discord_channel_id: `${id}-channel`,
    atlas_location_id: null,
    patrol_anchor_trailmark_id: null,
    active: true,
    pinned: false,
    created_by_discord_user_id: "marshal-id",
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    ...overrides
  };
}

function session(id: string, location: TrailmarkRow, createdAt: string): TrailmarkSessionRow {
  return {
    id,
    discord_user_id: "ranger-id",
    trailmark_id: location.id,
    discord_channel_id: location.discord_channel_id,
    expires_at: "2026-09-02T04:00:00.000Z",
    active: false,
    created_at: createdAt
  };
}
