import assert from "node:assert/strict";
import test from "node:test";
import { ChannelType, Collection, type Guild, type GuildMember } from "discord.js";
import { supabase } from "../db/supabase.js";
import { roleIdForRank } from "../config/roles.js";
import { resolveRunecloakImageUrl, runecloakAlbumCover } from "./runecloakImageService.js";
import { listRunecloakSyncMembers, runecloakApplicationReviewRows, runecloakSitePayload, syncRunecloakApplicantAccess, upsertRunecloakSitePost } from "./runecloakDiscordService.js";
import type { RunecloakApplicationDetails } from "./runecloakService.js";
import {
  assertRunecloakCaptain,
  canTransitionRunecloakApplication,
  earliestRunecloakStudySpell,
  evaluateRunecloakStage,
  normalizeRunecloakImageUrl,
  parseDiscordUserIds,
  requiredStageAttendance,
  runecloakPersonalEligibility,
  runecloakProgressBar,
  runecloakRegionalCooldown,
  runecloakSessionCanBeSubmitted
} from "./runecloakService.js";

test("Runecloak configuration uses the same Captain+ authority as other management decisions", () => {
  for (const rank of ["Captain", "First Captain", "Marshal"] as const) {
    const roleId = roleIdForRank(rank);
    const member = { roles: { cache: new Collection([[roleId, { id: roleId }]]) } } as unknown as GuildMember;
    if (rank === "Marshal") {
      assert.throws(() => assertRunecloakCaptain(member), /Captain or higher/);
    } else {
      assert.doesNotThrow(() => assertRunecloakCaptain(member));
    }
  }
});

test("Runecloak stage quorum rounds upward from 51 percent", () => {
  assert.equal(requiredStageAttendance(20), 11);
  assert.equal(requiredStageAttendance(21), 11);
  assert.equal(requiredStageAttendance(22), 12);
});

test("personal spell eligibility requires both 300 points and five paired stages", () => {
  assert.equal(runecloakPersonalEligibility({ verifiedPoints: 299, verifiedStages: 5 }), false);
  assert.equal(runecloakPersonalEligibility({ verifiedPoints: 300, verifiedStages: 4 }), false);
  assert.equal(runecloakPersonalEligibility({ verifiedPoints: 300, verifiedStages: 5 }), true);
  assert.equal(runecloakPersonalEligibility({ verifiedPoints: 420, verifiedStages: 5 }), true);
});

test("paired regional attendance counts a learner once and accepts one roll", () => {
  const result = evaluateRunecloakStage([
    { rangerId: "a", kind: "learner", verified: true, rollValue: 70 },
    { rangerId: "a", kind: "learner", verified: true, rollValue: null },
    { rangerId: "b", kind: "learner", verified: true, rollValue: 25 },
    { rangerId: "observer", kind: "observer", verified: true, rollValue: null }
  ], 2);
  assert.deepEqual(result, { uniqueAttendance: 2, points: 95, valid: true });
});

test("invalid stages preserve attendance but add no shared points", () => {
  const result = evaluateRunecloakStage([
    { rangerId: "a", kind: "learner", verified: true, rollValue: 100 }
  ], 2);
  assert.deepEqual(result, { uniqueAttendance: 1, points: 0, valid: false });
});

test("overflow stays on the earliest unfinished spell instead of carrying forward", () => {
  const spells = [
    { id: "oakflesh", sequence: 1 },
    { id: "lesser-ward", sequence: 2 }
  ];

  assert.deepEqual(earliestRunecloakStudySpell(spells, new Set(), 2), spells[0]);
  assert.deepEqual(earliestRunecloakStudySpell(spells, new Set(["oakflesh"]), 2), spells[1]);
  assert.equal(earliestRunecloakStudySpell(spells, new Set(["oakflesh", "lesser-ward"]), 2), null);
});

test("regional cooldown accepts the exact 72-hour boundary", () => {
  assert.deepEqual(runecloakRegionalCooldown(null, "2026-09-02T18:00:00.000Z"), {
    allowed: true,
    eligibleAt: null
  });
  assert.deepEqual(runecloakRegionalCooldown(
    "2026-09-01T18:00:00.000Z",
    "2026-09-04T18:00:00.000Z"
  ), {
    allowed: true,
    eligibleAt: "2026-09-04T18:00:00.000Z"
  });
  assert.deepEqual(runecloakRegionalCooldown(
    "2026-09-01T18:00:00.000Z",
    "2026-09-04T17:59:59.000Z"
  ), {
    allowed: false,
    eligibleAt: "2026-09-04T18:00:00.000Z"
  });
});

test("EU and NA cooldown histories are evaluated independently", () => {
  const eu = runecloakRegionalCooldown(
    "2026-09-01T18:00:00.000Z",
    "2026-09-03T18:00:00.000Z"
  );
  const na = runecloakRegionalCooldown(
    "2026-08-31T18:00:00.000Z",
    "2026-09-03T18:00:00.000Z"
  );

  assert.equal(eu.allowed, false);
  assert.equal(na.allowed, true);
});

test("application transitions require survey review before approval", () => {
  assert.equal(canTransitionRunecloakApplication("Submitted", "Survey Requested"), true);
  assert.equal(canTransitionRunecloakApplication("Submitted", "Approved"), false);
  assert.equal(canTransitionRunecloakApplication("Survey Submitted", "Approved"), true);
  assert.equal(canTransitionRunecloakApplication("Approved", "Denied"), false);
  assert.equal(canTransitionRunecloakApplication("Approved", "Withdrawn"), false);
});

test("verified or cancelled Runecloak session evidence cannot be replaced", () => {
  assert.equal(runecloakSessionCanBeSubmitted("Planned"), true);
  assert.equal(runecloakSessionCanBeSubmitted("Submitted"), true);
  assert.equal(runecloakSessionCanBeSubmitted("Verified"), false);
  assert.equal(runecloakSessionCanBeSubmitted("Cancelled"), false);
});

test("Discord IDs are deduplicated when parsed from mentions", () => {
  assert.deepEqual(parseDiscordUserIds("<@123456789012345678> 123456789012345678 <@!987654321098765432>"), [
    "123456789012345678",
    "987654321098765432"
  ]);
});

test("progress bars cap at their configured width", () => {
  assert.equal(runecloakProgressBar(4000, 8000), "[█████░░░░░]");
  assert.equal(runecloakProgressBar(9000, 8000), "[██████████]");
});

test("Imgur share links become direct image URLs for Discord embeds", () => {
  assert.equal(normalizeRunecloakImageUrl("https://imgur.com/XbKDqO3"), "https://i.imgur.com/XbKDqO3.jpg");
  assert.equal(normalizeRunecloakImageUrl("https://www.imgur.com/XbKDqO3.png?example=1"), "https://i.imgur.com/XbKDqO3.png");
  assert.equal(normalizeRunecloakImageUrl("https://i.imgur.com/XbKDqO3.jpg"), "https://i.imgur.com/XbKDqO3.jpg");
  assert.equal(normalizeRunecloakImageUrl("https://imgur.com/a/example"), "https://imgur.com/a/example");
  assert.equal(normalizeRunecloakImageUrl("https://cdn.example.com/image.png"), "https://cdn.example.com/image.png");
});

test("Imgur albums resolve the cover image without treating the album ID as an image", async () => {
  const requested: string[] = [];
  const fakeFetch: typeof fetch = async (url, options) => {
    requested.push(String(url));
    assert.equal(options?.redirect, "error");
    return new Response('<meta content="https://i.imgur.com/b8l8WR8.jpeg?fb" property="og:image">');
  };
  assert.equal(await resolveRunecloakImageUrl("https://imgur.com/a/M3ugpxk?share=1", fakeFetch), "https://i.imgur.com/b8l8WR8.jpeg");
  assert.deepEqual(requested, ["https://imgur.com/a/M3ugpxk"]);
  assert.equal(runecloakAlbumCover('<meta property="og:image" content="https://example.com/tracker.jpg">'), null);
});

test("album failures retain the survey link without a broken image or failed post", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Imgur unavailable"); });
  const guild = { emojis: { cache: new Collection() } } as unknown as Guild;
  const details = {
    applicant: { in_game_name: "Test Ranger" },
    site: { name: "Test site", research_rationale: "Survey notes", hold_region: "Winterhold", status: "Approved", atlas_reference: "ATLAS123", updated_at: "2026-09-07T00:00:00Z", screenshot_url: "https://imgur.com/a/M3ugpxk" }
  } as RunecloakApplicationDetails;
  const payload = await runecloakSitePayload(guild, details);
  const embed = payload.embeds[0]!.toJSON();
  assert.equal(embed.image, undefined);
  assert.ok(embed.fields?.some(({ value }) => value.includes("https://imgur.com/a/M3ugpxk")));
  assert.equal(details.site?.screenshot_url, "https://imgur.com/a/M3ugpxk");
});

test("approved applications retain an access recovery button", () => {
  const details = { application: { id: "approved-app", status: "Approved" } } as RunecloakApplicationDetails;
  const rows = runecloakApplicationReviewRows(details);
  const button = rows[0]!.components[0]!.toJSON();
  assert.equal("custom_id" in button ? button.custom_id : null, "runecloak:application:refresh-access:approved-app");
});

test("submitted surveys offer explicit new and existing location acceptance", () => {
  const details = { application: { id: "app", status: "Survey Submitted" }, site: { id: "survey", status: "Proposed" } } as RunecloakApplicationDetails;
  const buttons = runecloakApplicationReviewRows(details)[0]!.components.map((button) => button.toJSON());
  assert.deepEqual(buttons.slice(0, 2).map((button) => "label" in button ? button.label : null), ["Accept as New Location", "Accept into Existing Location"]);
  assert.ok(buttons.some((button) => "custom_id" in button && button.custom_id === "runecloak:application:existing:app:0"));
});

function linkedSurveyFixture(): RunecloakApplicationDetails {
  return {
    application: { id: "app" },
    applicant: { in_game_name: "Second Ranger", discord_user_id: "ranger" },
    site: { id: "survey", existing_site_id: "location", name: "Another name for the grove", research_rationale: "Independent findings and hazards", hold_region: "Whiterun", status: "Approved", atlas_reference: "MY-OWN-ATLAS", updated_at: "2026-09-07T00:00:00Z", screenshot_url: "https://i.imgur.com/example.jpg", forum_thread_id: null, forum_message_id: null }
  } as RunecloakApplicationDetails;
}

test("additional survey payload keeps its author, findings, Atlas entry and image without location controls", async () => {
  const guild = { emojis: { cache: new Collection() } } as unknown as Guild;
  const payload = await runecloakSitePayload(guild, linkedSurveyFixture());
  const embed = payload.embeds[0]!.toJSON();
  assert.equal(embed.title, "Field Survey: Another name for the grove");
  assert.equal(embed.description, "Independent findings and hazards");
  assert.equal(embed.fields?.find(({ name }) => name === "Atlas location code/reference")?.value, "MY-OWN-ATLAS");
  assert.match(embed.fields?.find(({ name }) => name === "Surveyed by")?.value ?? "", /<@ranger>.*Second Ranger/);
  assert.equal(embed.image?.url, "https://i.imgur.com/example.jpg");
  assert.deepEqual(payload.components, []);
});

test("linked survey publication appends to its location and recovers a send before database acknowledgement", async (t) => {
  const details = linkedSurveyFixture();
  const writes: unknown[] = [];
  t.mock.method(supabase, "from", (table: string) => {
    let update: unknown;
    const query = {
      select: () => query, eq: () => query,
      update: (value: unknown) => { update = value; return query; },
      maybeSingle: async () => ({ data: { expedition_forum_id: "forum" }, error: null }),
      single: async () => {
        assert.equal(table, "runecloak_research_sites");
        if (update) writes.push(update);
        return { data: update ? details.site : { application_id: "parent-app", forum_thread_id: "thread" }, error: null };
      }
    };
    return query;
  });
  let sends = 0;
  let edits = 0;
  const messages = new Collection<string, any>();
  const thread = {
    id: "thread", parentId: "forum", archived: false, isThread: () => true,
    fetchStarterMessage: () => { throw new Error("Original location must not be edited"); },
    messages: { fetch: async () => messages },
    send: async (payload: any) => {
      sends++;
      assert.equal(payload.enforceNonce, true);
      assert.deepEqual(payload.allowedMentions, { parse: [] });
      const reply = { id: "reply", author: { id: "bot" }, embeds: payload.embeds.map((embed: any) => embed.toJSON()), edit: async () => { edits++; return reply; } };
      messages.set("reply", reply);
      return reply;
    }
  };
  const forum = { id: "forum", type: ChannelType.GuildForum, threads: { create: () => { throw new Error("No duplicate location thread"); } } };
  const guild = { id: "guild", emojis: { cache: new Collection() }, client: { user: { id: "bot" } }, channels: { fetch: async (id: string) => id === "forum" ? forum : thread } } as unknown as Guild;
  await upsertRunecloakSitePost(guild, details);
  // Retry with stale database metadata, as if the first acknowledgement failed.
  await upsertRunecloakSitePost(guild, details);
  assert.equal(sends, 1);
  assert.equal(edits, 1);
  assert.deepEqual(writes, Array(2).fill({ forum_thread_id: "thread", forum_message_id: "reply" }));
});

test("full Runecloak role reconciliation paginates REST without a Gateway member request", async () => {
  const options: { limit: number; after?: string }[] = [];
  const first = new Collection<string, GuildMember>(Array.from({ length: 1000 }, (_, i) => [String(i + 1), {} as GuildMember]));
  const last = new Collection<string, GuildMember>([["1001", {} as GuildMember]]);
  const guild = { members: {
    fetch: () => { throw new Error("Gateway bulk fetch must not be used"); },
    list: async (input: { limit: number; after?: string }) => { options.push(input); return options.length === 1 ? first : last; }
  } } as unknown as Guild;
  assert.equal((await listRunecloakSyncMembers(guild)).size, 1001);
  assert.equal(options[0]?.limit, 1000);
  assert.equal(options[1]?.after, "1000");
});

test("admission access recovery fetches only the approved learner and is safe to repeat", async (t) => {
  const tables: Record<string, unknown> = {
    runecloak_settings: { learner_role_id: "learner", qualification_role_id: "qualified", guide_role_id: "guide" },
    corps_qualifications: { id: "qualification" },
    rangers: { id: "ranger", status: "Active", current_rank: "Ranger" },
    runecloak_memberships: { status: "Learner" },
    ranger_qualifications: null,
    runecloak_team_assignments: []
  };
  t.mock.method(supabase, "from", (table: string) => {
    const query = {
      select: () => query, eq: () => query, is: () => query,
      maybeSingle: async () => ({ data: tables[table], error: null }),
      then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: tables[table], error: null }).then(resolve)
    };
    return query;
  });
  const roles = new Collection<string, object>();
  let additions = 0;
  const member = { id: "member", user: { bot: false }, roles: {
    cache: roles,
    add: async (id: string) => { additions++; roles.set(id, {}); },
    remove: async () => { throw new Error("No existing roles should be removed"); }
  } } as unknown as GuildMember;
  const guild = { id: "guild", members: { fetch: async (options: { user: string; force: boolean }) => {
    assert.deepEqual(options, { user: "member", force: true });
    return member;
  } } } as unknown as Guild;
  Object.assign(member, { guild });
  const details = { applicant: { discord_user_id: "member" } } as RunecloakApplicationDetails;
  await syncRunecloakApplicantAccess(guild, details);
  await syncRunecloakApplicantAccess(guild, details);
  assert.equal(roles.has("learner"), true);
  assert.equal(additions, 1);
});
