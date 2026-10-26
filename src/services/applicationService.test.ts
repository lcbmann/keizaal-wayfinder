import assert from "node:assert/strict";
import test from "node:test";
import { Collection, PermissionsBitField, type ButtonInteraction, type Guild, type GuildMember, type Role } from "discord.js";
import { roleIdForRank } from "../config/roles.js";
import { memberRankAtLeast } from "../utils/permissions.js";
import { supabase, type ApplicationFormConfigRow, type CorpsDutyRow, type DutyApplicationRow, type RangerRow } from "../db/supabase.js";
import {
  assertHoldWardenApplicationVacant,
  applicationMinimumRank,
  applicationReviewMinimumRank,
  applicationTitle,
  type CorpsApplicationDetails
} from "./applicationService.js";
import { applicationFormDefinition } from "./applicationFormService.js";
import { leadershipApplicationChannelStateKey } from "./applicationChannelState.js";
import { applicationConfigurationModal, assertSafeApplicationRole, configuredApplicationDefinition, getApplicationPosition, mergeApplicationPositions,
  openApplicationConfiguration, validateApplicationQuestions, type ConfiguredApplicationPosition } from "./applicationConfigurationService.js";
import { configuredCorpsApplicationModal } from "./applicationFormService.js";
import { assignmentsEmbeds } from "./assignmentBoardService.js";
import type { DutyAssignmentDetails } from "./dutyService.js";
import { applicationCommand } from "../commands/application.js";
import { dutyCommand } from "../commands/duty.js";

const guideDuty = { id: "guide-duty", name: "Warden", display_name: "Guide", active: true,
  assignment_mode: "general", minimum_rank: "Ranger", description: "Rangers who guide and train the Corps.", discord_role_id: "guide-role" } as CorpsDutyRow;
const guideConfig = { key: "Guide", duty_id: guideDuty.id, enabled: true, minimum_rank: "Ranger", description: "",
  questions: ["Why do you wish to become a Guide?", "Relevant skills and local knowledge"],
  revision: "12345678-1234-1234-1234-123456789012" } as ApplicationFormConfigRow;
function guidePosition(): ConfiguredApplicationPosition {
  return mergeApplicationPositions([guideConfig], [guideDuty]).find(({ key }) => key === "Guide")!;
}

test("custom positions use persisted questions and roles rather than fixed slash-command choices", () => {
  const guide = guidePosition();
  assert.equal(guide.enabled, true);
  assert.equal(guide.minimumRank, "Ranger");
  assert.equal(guide.duty?.id, "guide-duty");
  assert.equal(configuredApplicationDefinition(guide).fields[0]?.label, "Why do you wish to become a Guide?");
  const modal = configuredCorpsApplicationModal(guide).toJSON();
  assert.ok(modal.custom_id.length <= 100);
  assert.ok(modal.custom_id.endsWith(guideConfig.revision));
  assert.equal(modal.components.length, 2);
  for (const command of [applicationCommand, dutyCommand]) {
    const definition = command.data.toJSON();
    const encoded = JSON.stringify(definition);
    assert.ok(encoded.includes('"autocomplete":true'));
    assert.ok(!encoded.includes('"name":"Instructor","value":"Instructor"'));
  }
});

test("closing old application types does not remove duties or their appointment history", () => {
  const configs = [guideConfig, ...["Hold Warden", "Local Warden", "Instructor"].map((key) => ({ ...guideConfig, key, enabled: false }))];
  const positions = mergeApplicationPositions(configs, [guideDuty]);
  assert.equal(positions.find(({ key }) => key === "Guide")?.enabled, true);
  for (const key of ["Hold Warden", "Local Warden", "Instructor"]) assert.equal(positions.find((position) => position.key === key)?.enabled, false);
  assert.equal(guideDuty.active, true);
});

test("deactivated duties cannot accept applications even if their old form is enabled", () => {
  assert.equal(mergeApplicationPositions([guideConfig], [{ ...guideDuty, active: false }]).find(({ key }) => key === "Guide")?.enabled, false);
});

test("leadership application rank gates cannot be weakened by configuration", () => {
  const positions = mergeApplicationPositions([...["Captain", "Marshal"].map((key) => ({ ...guideConfig, key, minimum_rank: "Apprentice" as const }))], [guideDuty]);
  assert.equal(positions.find(({ key }) => key === "Captain")?.minimumRank, "Marshal");
  assert.equal(positions.find(({ key }) => key === "Marshal")?.minimumRank, "Ranger");
});

test("custom questions respect Discord's component and label limits", () => {
  assert.throws(() => validateApplicationQuestions([]), /between 1 and 5/);
  assert.throws(() => validateApplicationQuestions(Array(6).fill("Question")), /between 1 and 5/);
  assert.throws(() => validateApplicationQuestions(["x".repeat(46)]), /45 characters/);
  assert.doesNotThrow(() => validateApplicationQuestions(["x".repeat(45)]));
});

test("editing legacy Warden forms cannot discard required geography", () => {
  const position: ConfiguredApplicationPosition = { ...guidePosition(), key: "Local Warden", builtinTarget: "Local Warden", questions: ["Why this Range?", "Your local knowledge", "Availability"] };
  const definition = configuredApplicationDefinition(position);
  assert.equal(definition.fields.length, 5);
  assert.ok(definition.fields.some(({ destination }) => destination === "hold"));
  assert.ok(definition.fields.some(({ destination }) => destination === "range"));
  assert.throws(() => configuredApplicationDefinition({ ...position, questions: Array(4).fill("Question") }), /between 1 and 3/);
});

test("closed applications are rejected at submission lookup, not just hidden in autocomplete", async (t) => {
  t.mock.method(supabase, "from", (table: string) => ({ select: async () => ({
    data: table === "application_form_configs" ? [{ ...guideConfig, enabled: false }] : [guideDuty], error: null
  }) }));
  await assert.rejects(getApplicationPosition("Guide"), /not currently open/);
});

test("custom duty roles cannot grant rank or Discord moderation privileges", () => {
  const role = (name: string, id = "regular-role", flags: bigint[] = []) => ({ id, name, guild: { id: "guild" }, managed: false,
    editable: true, permissions: new PermissionsBitField(flags) } as unknown as Role);
  assert.doesNotThrow(() => assertSafeApplicationRole(role("Guide")));
  for (const name of ["First Captain", "Captain", "Marshal", "Retired Ranger", "Senior Ranger"]) {
    assert.throws(() => assertSafeApplicationRole(role(name)), /regular duty role/);
  }
  assert.throws(() => assertSafeApplicationRole(role("Not a rank name", roleIdForRank("Captain"))), /regular duty role/);
  assert.throws(() => assertSafeApplicationRole(role("Administrator", "admin", [PermissionsBitField.Flags.Administrator])), /regular duty role/);
  assert.throws(() => assertSafeApplicationRole(role("Role manager", "manager", [PermissionsBitField.Flags.ManageRoles])), /regular duty role/);
});

test("configuration drafts cannot be opened by another Captain", async (t) => {
  t.mock.method(supabase, "from", () => {
    const query = { select: () => query, eq: () => query, gt: () => query, maybeSingle: async () => ({ data: null, error: null }) };
    return query;
  });
  const captain = { roles: { cache: new Collection([[roleIdForRank("Captain"), {}]]) } } as unknown as GuildMember;
  const interaction = { inCachedGuild: () => true, member: captain, guild: { id: "guild" }, user: { id: "other-captain" },
    customId: "application:configure-open:12345678-1234-1234-1234-123456789012" } as unknown as ButtonInteraction;
  await assert.rejects(openApplicationConfiguration(interaction), /editor expired/);
});

test("a new position can bind a new duty role without falsely claiming leadership owns it", async (t) => {
  let payload: unknown;
  t.mock.method(supabase, "from", (table: string) => ({
    select: async () => ({ data: [], error: null }),
    delete: () => ({ lt: async () => ({ error: null }) }),
    insert: async (value: unknown) => { assert.equal(table, "application_configuration_drafts"); payload = value; return { error: null }; }
  }));
  const actor = { id: "captain", roles: { cache: new Collection([[roleIdForRank("Captain"), {}]]) } } as unknown as GuildMember;
  const role = { id: "new-duty-role", name: "Scouts", managed: false, editable: true,
    guild: { id: "guild" }, permissions: new PermissionsBitField() } as unknown as Role;
  const modal = await applicationConfigurationModal({ guild: { id: "guild" } as Guild, actor,
    positionName: "Scouts", role, minimumRank: null, replaces: "" });
  assert.ok(payload);
  assert.equal(modal.toJSON().components.length, 2);
});

test("renaming a configured duty requires explicitly replacing its current application", async (t) => {
  t.mock.method(supabase, "from", (table: string) => ({ select: async () => ({
    data: table === "application_form_configs" ? [guideConfig] : [guideDuty], error: null
  }) }));
  const actor = { id: "captain", roles: { cache: new Collection([[roleIdForRank("Captain"), {}]]) } } as unknown as GuildMember;
  const role = { id: "guide-role", name: "Guide", managed: false, editable: true,
    guild: { id: "guild" }, permissions: new PermissionsBitField() } as unknown as Role;
  await assert.rejects(applicationConfigurationModal({ guild: { id: "guild" } as Guild, actor,
    positionName: "Trail Guide", role, minimumRank: null, replaces: "Warden" }), /replaces:Guide/);
});

test("Guide roster entries retain old ranges without duplicate member listings or Warden panels", () => {
  const guild = { emojis: { cache: new Collection() }, roles: { cache: new Collection() } } as unknown as Guild;
  const ranger = { id: "member", discord_user_id: "123", discord_display_name: "Guide Name", current_rank: "Ranger", status: "Active" } as RangerRow;
  const entries = ["Whiterun", "Oakwood"].map((range) => ({ duty: guideDuty, ranger,
    assignment: { assignment_detail: range, warden_scope: "local_range", parent_hold: "Falkreath" } } as DutyAssignmentDetails));
  const embeds = assignmentsEmbeds(guild, [ranger], entries, [], [], [guideDuty]).map((embed) => embed.toJSON());
  assert.equal(embeds.some(({ title }) => /Hold Wardens|Local Wardens|Instructors/.test(title ?? "")), false);
  const guide = embeds.find(({ title }) => title === "Guides")!;
  const value = guide.fields![0]!.value;
  assert.equal(value.match(/<@123>/g)?.length, 1);
  assert.ok(value.includes("Whiterun") && value.includes("Oakwood"));
  assert.equal(applicationTitle({ duty: guideDuty, applicant: ranger,
    application: { application_kind: "Duty", warden_scope: "hold_primary", parent_hold: "Whiterun" } as DutyApplicationRow }), "Guide");
});

test("application targets enforce the intended member rank", () => {
  assert.equal(applicationMinimumRank("Craftsman"), "Apprentice");
  assert.equal(applicationMinimumRank("Courier"), "Apprentice");
  assert.equal(applicationMinimumRank("Hold Warden"), "Ranger");
  assert.equal(applicationMinimumRank("Local Warden"), "Ranger");
  assert.equal(applicationMinimumRank("Instructor"), "Ranger");
  assert.equal(applicationMinimumRank("Marshal"), "Ranger");
  assert.equal(applicationMinimumRank("Captain"), "Marshal");
});

test("application review rank scales with appointment authority", () => {
  assert.equal(applicationReviewMinimumRank(details({ application_kind: "Duty", warden_scope: null })), "Marshal");
  assert.equal(applicationReviewMinimumRank(details({ application_kind: "Duty", warden_scope: "hold_primary" })), "Captain");
  assert.equal(applicationReviewMinimumRank(details({ application_kind: "Marshal", warden_scope: null })), "Captain");
  assert.equal(applicationReviewMinimumRank(details({ application_kind: "Captain", warden_scope: null })), "Captain");
});

test("leadership applications use separate private channel state", () => {
  assert.equal(leadershipApplicationChannelStateKey("Marshal"), "marshal-applications-channel");
  assert.equal(leadershipApplicationChannelStateKey("Captain"), "captain-applications-channel");
});

test("Captains can review both leadership application types while Marshals cannot", () => {
  for (const application_kind of ["Captain", "Marshal"] as const) {
    const minimum = applicationReviewMinimumRank(details({ application_kind, warden_scope: null }));
    for (const rank of ["Captain", "First Captain", "Marshal"] as const) {
      const roleId = roleIdForRank(rank);
      const member = { roles: { cache: new Collection([[roleId, { id: roleId }]]) } } as unknown as GuildMember;
      assert.equal(memberRankAtLeast(member, minimum), rank !== "Marshal");
    }
  }
});

test("Hold Warden applications reject Holds with an active appointment", () => {
  assert.doesNotThrow(() => assertHoldWardenApplicationVacant("Whiterun", false));
  assert.throws(
    () => assertHoldWardenApplicationVacant("Whiterun", true),
    /Whiterun already has an appointed Ranger of the Hold/
  );
});

test("leadership applications ask about loyalties and responsibilities", () => {
  for (const target of ["Marshal", "Captain"] as const) {
    const fields = applicationFormDefinition(target).fields;
    assert.equal(fields.length, 5);
    assert.ok(fields.some((field) => field.label === "Other loyalties/responsibilities, or none"));
    assert.ok(fields.some((field) => field.label === "Availability and potential conflicts"));
  }
});

test("Warden application forms collect the correct geography", () => {
  const holdRangerFields = applicationFormDefinition("Hold Warden").fields;
  assert.ok(holdRangerFields.some((field) => field.destination === "hold"));
  assert.equal(holdRangerFields.some((field) => field.destination === "range"), false);

  const localWardenFields = applicationFormDefinition("Local Warden").fields;
  assert.ok(localWardenFields.some((field) => field.destination === "hold"));
  assert.ok(localWardenFields.some((field) => field.destination === "range"));
});

test("Instructor applications collect teaching-specific information", () => {
  const labels = applicationFormDefinition("Instructor").fields.map((field) => field.label);
  assert.deepEqual(labels, [
    "Why do you wish to become an Instructor?",
    "Teaching, mentoring, and field experience",
    "Skills or subjects you can teach",
    "How would you structure practical training?",
    "Availability and current responsibilities"
  ]);
});

test("duty application forms use position-specific questions", () => {
  const quartermaster = applicationFormDefinition("Quartermaster").fields.map((field) => field.label);
  const agent = applicationFormDefinition("Agent").fields.map((field) => field.label);
  assert.ok(quartermaster.includes("Would you change how supplies are organized?"));
  assert.ok(agent.includes("Approach to evidence and confidentiality"));
  assert.notDeepEqual(quartermaster, agent);
});

function details(application: Pick<DutyApplicationRow, "application_kind" | "warden_scope">): CorpsApplicationDetails {
  return {
    application: application as DutyApplicationRow,
    applicant: {} as RangerRow,
    duty: {} as CorpsDutyRow
  };
}
