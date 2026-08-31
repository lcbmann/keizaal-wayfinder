import type { GuildMember } from "discord.js";
import { rankAtLeast } from "../config/ranks.js";
import {
  assertNoDbError,
  supabase,
  type RangerQualificationRow,
  type RangerRow,
  type RunecloakApplicationRow,
  type RunecloakApplicationStatus,
  type RunecloakAuditEventRow,
  type RunecloakCycleMemberRow,
  type RunecloakCycleRow,
  type RunecloakProgramState,
  type RunecloakResearchSiteRow,
  type RunecloakSessionParticipationRow,
  type RunecloakSessionRow,
  type RunecloakSettingsRow,
  type RunecloakSpellProgressRow,
  type RunecloakSpellRow,
  type RunecloakStageRow,
  type RunecloakTeamAssignmentRow
} from "../db/supabase.js";
import { UserFacingError } from "../utils/errors.js";
import { mainRankFromMember, memberRankAtLeast } from "../utils/permissions.js";
import { requireRangerByDiscordId } from "./rangerService.js";

export const RUNECLOAK_QUALIFICATION_SLUG = "ranger-runecloak";
export const DEFAULT_RUNECLOAK_ROLE_ID = "1543999251820839073";

const OPEN_APPLICATION_STATES: RunecloakApplicationStatus[] = [
  "Submitted",
  "Survey Requested",
  "Survey Submitted",
  "Revision Requested",
  "Approved"
];

const APPLICATION_TRANSITIONS: Record<RunecloakApplicationStatus, RunecloakApplicationStatus[]> = {
  Submitted: ["Survey Requested", "Denied", "Withdrawn"],
  "Survey Requested": ["Survey Submitted", "Denied", "Withdrawn"],
  "Survey Submitted": ["Approved", "Revision Requested", "Denied", "Withdrawn"],
  "Revision Requested": ["Survey Submitted", "Denied", "Withdrawn"],
  Approved: ["Withdrawn"],
  Denied: [],
  Withdrawn: []
};

export interface RunecloakApplicationDetails {
  application: RunecloakApplicationRow;
  applicant: RangerRow;
  site: RunecloakResearchSiteRow | null;
}

export interface RunecloakCycleDetails {
  cycle: RunecloakCycleRow;
  spell: RunecloakSpellRow;
  members: RunecloakCycleMemberRow[];
  stages: RunecloakStageRow[];
}

export interface RunecloakCompletionCandidate {
  ranger: RangerRow;
  participationStatus: RunecloakCycleMemberRow["participation_status"];
  priorAttendanceCredits: number;
  cycleAttendanceCredits: number;
  retainedAttendanceCredits: number;
  requiredAttendanceCredits: number;
  eligible: boolean;
}

export interface RunecloakCompletionPreview {
  details: RunecloakCycleDetails;
  validStageCount: number;
  candidates: RunecloakCompletionCandidate[];
}

export function requiredStageAttendance(rosterSize: number, quorumPercent = 51): number {
  if (!Number.isInteger(rosterSize) || rosterSize < 1) {
    throw new Error("Roster size must be a positive integer.");
  }
  return Math.ceil(rosterSize * quorumPercent / 100);
}

export function requiredPersonalAttendance(validStageCount: number): number {
  if (!Number.isInteger(validStageCount) || validStageCount < 1) {
    throw new Error("A completed Runecloak cycle needs at least one valid stage.");
  }
  return Math.floor(validStageCount / 2) + 1;
}

export function calculateRunecloakAttendanceCredit(input: {
  priorCredits: number;
  requiredCredits: number;
  attendedStages: number;
}): { earnedCredits: number; retainedCredits: number; complete: boolean } {
  const priorCredits = Math.max(0, Math.min(input.priorCredits, input.requiredCredits));
  const earnedCredits = Math.max(0, Math.min(input.attendedStages, input.requiredCredits - priorCredits));
  const retainedCredits = priorCredits + earnedCredits;
  return { earnedCredits, retainedCredits, complete: retainedCredits >= input.requiredCredits };
}

export function evaluateRunecloakStage(
  records: readonly {
    rangerId: string;
    kind: "learner" | "support" | "observer";
    verified: boolean;
    rollValue: number | null;
  }[],
  requiredAttendance: number
): { uniqueAttendance: number; points: number; valid: boolean } {
  const learners = records.filter(({ kind, verified }) => kind === "learner" && verified);
  const uniqueAttendance = new Set(learners.map(({ rangerId }) => rangerId)).size;
  const acceptedRolls = new Map<string, number>();
  for (const record of learners) {
    if (record.rollValue === null) {
      continue;
    }
    if (!Number.isInteger(record.rollValue) || record.rollValue < 1 || record.rollValue > 100) {
      throw new Error("Runecloak roll values must be integers from 1 through 100.");
    }
    const existing = acceptedRolls.get(record.rangerId);
    if (existing !== undefined && existing !== record.rollValue) {
      throw new Error("A learner cannot contribute two different rolls to one paired stage.");
    }
    acceptedRolls.set(record.rangerId, record.rollValue);
  }
  const valid = uniqueAttendance >= requiredAttendance;
  return {
    uniqueAttendance,
    points: valid ? [...acceptedRolls.values()].reduce((sum, roll) => sum + roll, 0) : 0,
    valid
  };
}

export function runecloakProgressBar(value: number, target: number, width = 10): string {
  const safeTarget = Math.max(1, target);
  const filled = Math.min(width, Math.max(0, Math.floor(value / safeTarget * width)));
  return `[${"#".repeat(filled)}${"-".repeat(width - filled)}]`;
}

export function parseDiscordUserIds(value: string): string[] {
  return [...new Set(value.match(/\d{16,22}/gu) ?? [])];
}

export function canTransitionRunecloakApplication(
  current: RunecloakApplicationStatus,
  next: RunecloakApplicationStatus
): boolean {
  return APPLICATION_TRANSITIONS[current].includes(next);
}

export async function getRunecloakSettings(guildId: string): Promise<RunecloakSettingsRow | null> {
  const { data, error } = await supabase.from("runecloak_settings").select("*").eq("guild_id", guildId).maybeSingle();
  assertNoDbError(error, "get Runecloak settings");
  return data;
}

export async function requireRunecloakSettings(guildId: string): Promise<RunecloakSettingsRow> {
  const settings = await getRunecloakSettings(guildId);
  if (!settings) {
    throw new UserFacingError("The Runecloak desk has not been set up yet. The Commander must run `/runecloak setup` first.");
  }
  return settings;
}

export async function saveRunecloakSettings(input: {
  guildId: string;
  categoryId: string;
  informationChannelId: string;
  discussionChannelId: string;
  expeditionForumId: string;
  organizerRoleId: string | null;
  learnerRoleId: string | null;
  qualificationRoleId: string;
  actorDiscordUserId: string;
}): Promise<RunecloakSettingsRow> {
  const existing = await getRunecloakSettings(input.guildId);
  const { data, error } = await supabase.from("runecloak_settings").upsert({
    guild_id: input.guildId,
    category_id: input.categoryId,
    information_channel_id: input.informationChannelId,
    discussion_channel_id: input.discussionChannelId,
    expedition_forum_id: input.expeditionForumId,
    dashboard_message_id: existing?.dashboard_message_id ?? null,
    organizer_role_id: input.organizerRoleId,
    learner_role_id: input.learnerRoleId,
    qualification_role_id: input.qualificationRoleId,
    program_state: existing?.program_state ?? "Organizing",
    registration_reference: existing?.registration_reference ?? null,
    registration_confirmed_by_discord_user_id: existing?.registration_confirmed_by_discord_user_id ?? null,
    registration_confirmed_at: existing?.registration_confirmed_at ?? null,
    minimum_roster_size: existing?.minimum_roster_size ?? 20,
    quorum_percent: existing?.quorum_percent ?? 51,
    point_target: existing?.point_target ?? 8000,
    configured_by_discord_user_id: input.actorDiscordUserId
  }).select("*").single();
  assertNoDbError(error, "save Runecloak settings");
  if (!data) {
    throw new Error("Supabase did not return the Runecloak settings.");
  }
  await updateRunecloakQualificationRole(input.qualificationRoleId);
  await recordRunecloakAudit({
    guildId: input.guildId,
    entityType: "settings",
    action: existing ? "settings_updated" : "settings_created",
    actorDiscordUserId: input.actorDiscordUserId,
    before: existing,
    after: data
  });
  return data;
}

export async function setRunecloakDashboardMessage(guildId: string, messageId: string): Promise<void> {
  const { error } = await supabase.from("runecloak_settings").update({ dashboard_message_id: messageId }).eq("guild_id", guildId);
  assertNoDbError(error, "save Runecloak dashboard message");
}

export async function setRunecloakProgramState(input: {
  guildId: string;
  state: RunecloakProgramState;
  actorDiscordUserId: string;
  registrationReference?: string | null;
}): Promise<RunecloakSettingsRow> {
  const before = await requireRunecloakSettings(input.guildId);
  if (input.state === "Registered" && !input.registrationReference?.trim() && !before.registration_reference) {
    throw new UserFacingError("Record the Moonshadow registration reference before marking the program Registered.");
  }
  const { data, error } = await supabase.from("runecloak_settings").update({
    program_state: input.state,
    registration_reference: input.registrationReference?.trim() || before.registration_reference,
    registration_confirmed_by_discord_user_id: input.state === "Registered" ? input.actorDiscordUserId : before.registration_confirmed_by_discord_user_id,
    registration_confirmed_at: input.state === "Registered" ? new Date().toISOString() : before.registration_confirmed_at
  }).eq("guild_id", input.guildId).select("*").single();
  assertNoDbError(error, "update Runecloak program state");
  if (!data) {
    throw new Error("Supabase did not return the updated Runecloak settings.");
  }
  await recordRunecloakAudit({
    guildId: input.guildId,
    entityType: "program",
    action: `program_${input.state.toLowerCase().replaceAll(" ", "_")}`,
    actorDiscordUserId: input.actorDiscordUserId,
    before,
    after: data,
    reason: input.registrationReference ?? null
  });
  return data;
}

export async function createRunecloakApplication(input: {
  member: GuildMember;
  reason: string;
  experience: string | null;
  availability: string;
  loyaltiesConflicts: string | null;
}): Promise<RunecloakApplicationDetails> {
  const applicant = await requireRangerByDiscordId(input.member.id);
  if (applicant.status !== "Active" || !rankAtLeast(applicant.current_rank, "Ranger")) {
    throw new UserFacingError("Only active full Rangers or higher may apply for Runecloak study.");
  }
  const settings = await requireRunecloakSettings(input.member.guild.id);
  if (settings.program_state !== "Admissions Open" && settings.program_state !== "Organizing") {
    throw new UserFacingError("Runecloak applications are not currently open.");
  }
  if (await rangerHasRunecloakQualification(applicant.id)) {
    throw new UserFacingError("You already hold the Ranger Runecloak qualification.");
  }
  const existing = await getOpenRunecloakApplication(applicant.id);
  if (existing) {
    throw new UserFacingError(`You already have a Runecloak application in **${existing.status}** status.`);
  }

  const { data, error } = await supabase.from("runecloak_applications").insert({
    applicant_ranger_id: applicant.id,
    rank_snapshot: applicant.current_rank,
    reason: normalizedRequired(input.reason, 1500),
    experience: normalizedOptional(input.experience, 1500),
    availability: normalizedRequired(input.availability, 1000),
    loyalties_conflicts: normalizedOptional(input.loyaltiesConflicts, 1500)
  }).select("*").single();
  assertNoDbError(error, "create Runecloak application");
  if (!data) {
    throw new Error("Supabase did not return the Runecloak application.");
  }
  await recordRunecloakAudit({
    guildId: input.member.guild.id,
    entityType: "application",
    entityId: data.id,
    action: "application_submitted",
    actorDiscordUserId: input.member.id,
    after: { status: data.status, applicant_ranger_id: applicant.id }
  });
  return { application: data, applicant, site: null };
}

export async function attachRunecloakApplicationReview(input: {
  applicationId: string;
  channelId: string;
  messageId: string;
  threadId: string;
}): Promise<RunecloakApplicationRow> {
  const { data, error } = await supabase.from("runecloak_applications").update({
    strongbox_channel_id: input.channelId,
    strongbox_message_id: input.messageId,
    strongbox_thread_id: input.threadId
  }).eq("id", input.applicationId).select("*").single();
  assertNoDbError(error, "attach Runecloak review thread");
  if (!data) {
    throw new Error("Supabase did not return the attached Runecloak application.");
  }
  return data;
}

export async function getRunecloakApplicationDetails(applicationId: string): Promise<RunecloakApplicationDetails | null> {
  const { data: application, error } = await supabase.from("runecloak_applications").select("*").eq("id", applicationId).maybeSingle();
  assertNoDbError(error, "get Runecloak application");
  if (!application) {
    return null;
  }
  const [applicantResult, siteResult] = await Promise.all([
    supabase.from("rangers").select("*").eq("id", application.applicant_ranger_id).single(),
    supabase.from("runecloak_research_sites").select("*").eq("application_id", application.id).neq("status", "Retired").maybeSingle()
  ]);
  assertNoDbError(applicantResult.error, "get Runecloak applicant");
  assertNoDbError(siteResult.error, "get Runecloak research site");
  return { application, applicant: applicantResult.data, site: siteResult.data };
}

export async function getOpenRunecloakApplication(rangerId: string): Promise<RunecloakApplicationRow | null> {
  const { data, error } = await supabase.from("runecloak_applications")
    .select("*")
    .eq("applicant_ranger_id", rangerId)
    .in("status", OPEN_APPLICATION_STATES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  assertNoDbError(error, "get open Runecloak application");
  return data;
}

export async function getLatestRunecloakApplication(rangerId: string): Promise<RunecloakApplicationRow | null> {
  const { data, error } = await supabase.from("runecloak_applications")
    .select("*")
    .eq("applicant_ranger_id", rangerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  assertNoDbError(error, "get latest Runecloak application");
  return data;
}

export async function listRunecloakApplications(statuses?: RunecloakApplicationStatus[]): Promise<RunecloakApplicationDetails[]> {
  let query = supabase.from("runecloak_applications").select("id").order("created_at", { ascending: true });
  if (statuses?.length) {
    query = query.in("status", statuses);
  }
  const { data, error } = await query.limit(200);
  assertNoDbError(error, "list Runecloak applications");
  const details = await Promise.all((data ?? []).map(({ id }) => getRunecloakApplicationDetails(id)));
  return details.filter((entry): entry is RunecloakApplicationDetails => entry !== null);
}

export async function transitionRunecloakApplication(input: {
  guildId: string;
  applicationId: string;
  nextStatus: RunecloakApplicationStatus;
  actorDiscordUserId: string;
  note?: string | null;
}): Promise<RunecloakApplicationDetails> {
  const details = await getRunecloakApplicationDetails(input.applicationId);
  if (!details) {
    throw new UserFacingError("That Runecloak application no longer exists.");
  }
  if (!canTransitionRunecloakApplication(details.application.status, input.nextStatus)) {
    throw new UserFacingError(`A **${details.application.status}** application cannot move to **${input.nextStatus}**.`);
  }
  if (input.nextStatus === "Approved" && details.site?.status !== "Approved") {
    throw new UserFacingError("Approve the applicant's research site before approving their Runecloak admission.");
  }
  const { data, error } = await supabase.from("runecloak_applications").update({
    status: input.nextStatus,
    review_note: normalizedOptional(input.note ?? null, 1500),
    reviewed_by_discord_user_id: input.actorDiscordUserId,
    reviewed_at: new Date().toISOString()
  }).eq("id", input.applicationId).eq("status", details.application.status).select("*").single();
  assertNoDbError(error, "review Runecloak application");
  if (!data) {
    throw new UserFacingError("That application changed while you were reviewing it. Open the current record and try again.");
  }
  await recordRunecloakAudit({
    guildId: input.guildId,
    entityType: "application",
    entityId: input.applicationId,
    action: `application_${input.nextStatus.toLowerCase().replaceAll(" ", "_")}`,
    actorDiscordUserId: input.actorDiscordUserId,
    reason: input.note ?? null,
    before: { status: details.application.status },
    after: { status: input.nextStatus }
  });
  return { ...details, application: data };
}

export async function submitRunecloakSurvey(input: {
  guildId: string;
  rangerDiscordUserId: string;
  siteName: string;
  holdRegion: string;
  atlasReference: string;
  reportUrl: string;
  resonanceDescription: string;
  screenshotUrl?: string | null;
}): Promise<RunecloakApplicationDetails> {
  const ranger = await requireRangerByDiscordId(input.rangerDiscordUserId);
  const application = await getOpenRunecloakApplication(ranger.id);
  if (!application || (application.status !== "Survey Requested" && application.status !== "Revision Requested")) {
    throw new UserFacingError("Leadership must request your Runecloak survey before you can submit it.");
  }
  assertHttpsOrDiscordUrl(input.reportUrl, "Ranger report link");
  if (input.screenshotUrl) {
    assertHttpsOrDiscordUrl(input.screenshotUrl, "Screenshot");
  }
  const existing = await getRunecloakApplicationDetails(application.id);
  const siteRecord = {
    application_id: application.id,
    ranger_id: ranger.id,
    name: normalizedRequired(input.siteName, 200),
    hold_region: normalizedRequired(input.holdRegion, 100),
    atlas_reference: normalizedRequired(input.atlasReference, 500),
    report_url: input.reportUrl.trim(),
    resonance_description: normalizedRequired(input.resonanceDescription, 1800),
    screenshot_url: input.screenshotUrl?.trim() || existing?.site?.screenshot_url || null,
    status: "Proposed" as const,
    review_note: null,
    reviewed_by_discord_user_id: null,
    reviewed_at: null
  };
  const query = existing?.site
    ? supabase.from("runecloak_research_sites").update(siteRecord).eq("id", existing.site.id)
    : supabase.from("runecloak_research_sites").insert(siteRecord);
  const { data: site, error: siteError } = await query.select("*").single();
  assertNoDbError(siteError, "submit Runecloak research survey");
  if (!site) {
    throw new Error("Supabase did not return the Runecloak research site.");
  }
  const { data: updatedApplication, error: applicationError } = await supabase.from("runecloak_applications").update({
    status: "Survey Submitted",
    review_note: null
  }).eq("id", application.id).select("*").single();
  assertNoDbError(applicationError, "mark Runecloak survey submitted");
  await recordRunecloakAudit({
    guildId: input.guildId,
    entityType: "research_site",
    entityId: site.id,
    action: existing?.site ? "survey_revised" : "survey_submitted",
    actorDiscordUserId: input.rangerDiscordUserId,
    after: { application_id: application.id, atlas_reference: site.atlas_reference, status: site.status }
  });
  return { application: updatedApplication, applicant: ranger, site };
}

export async function attachRunecloakSiteForumPost(input: {
  siteId: string;
  threadId: string;
  messageId: string | null;
}): Promise<RunecloakResearchSiteRow> {
  const { data, error } = await supabase.from("runecloak_research_sites").update({
    forum_thread_id: input.threadId,
    forum_message_id: input.messageId
  }).eq("id", input.siteId).select("*").single();
  assertNoDbError(error, "attach Runecloak research-site post");
  return data;
}

export async function reviewRunecloakSite(input: {
  guildId: string;
  siteId: string;
  outcome: "Approved" | "Revision Requested" | "Rejected" | "Retired";
  actorDiscordUserId: string;
  note?: string | null;
}): Promise<RunecloakApplicationDetails> {
  const { data: before, error: beforeError } = await supabase.from("runecloak_research_sites").select("*").eq("id", input.siteId).single();
  assertNoDbError(beforeError, "get Runecloak research site");
  const allowed = before.status === "Proposed"
    ? ["Approved", "Revision Requested", "Rejected"]
    : before.status === "Approved" ? ["Retired"] : [];
  if (!allowed.includes(input.outcome)) {
    throw new UserFacingError(`A **${before.status}** research site cannot move to **${input.outcome}**.`);
  }
  const { data: site, error } = await supabase.from("runecloak_research_sites").update({
    status: input.outcome,
    review_note: normalizedOptional(input.note ?? null, 1500),
    reviewed_by_discord_user_id: input.actorDiscordUserId,
    reviewed_at: new Date().toISOString()
  }).eq("id", input.siteId).eq("status", before.status).select("*").single();
  assertNoDbError(error, "review Runecloak research site");
  if (input.outcome === "Revision Requested") {
    const { error: appError } = await supabase.from("runecloak_applications").update({
      status: "Revision Requested",
      review_note: normalizedOptional(input.note ?? null, 1500),
      reviewed_by_discord_user_id: input.actorDiscordUserId,
      reviewed_at: new Date().toISOString()
    }).eq("id", site.application_id);
    assertNoDbError(appError, "request Runecloak survey revision");
  }
  await recordRunecloakAudit({
    guildId: input.guildId,
    entityType: "research_site",
    entityId: site.id,
    action: `site_${input.outcome.toLowerCase().replaceAll(" ", "_")}`,
    actorDiscordUserId: input.actorDiscordUserId,
    reason: input.note ?? null,
    before: { status: before.status },
    after: { status: site.status }
  });
  const details = await getRunecloakApplicationDetails(site.application_id);
  if (!details) {
    throw new Error("The Runecloak application for this site is missing.");
  }
  return details;
}

export async function isAuthorizedRunecloakMarshal(member: GuildMember): Promise<boolean> {
  if (memberRankAtLeast(member, "Ranger Captain")) {
    return true;
  }
  if (!memberRankAtLeast(member, "Ranger Marshal")) {
    return false;
  }
  const ranger = await requireRangerByDiscordId(member.id);
  const { data, error } = await supabase.from("runecloak_team_assignments")
    .select("id")
    .eq("ranger_id", ranger.id)
    .eq("assignment_kind", "authorized_marshal")
    .eq("active", true)
    .maybeSingle();
  assertNoDbError(error, "check authorized Runecloak Marshal");
  return Boolean(data);
}

export async function isRunecloakOrganizer(member: GuildMember): Promise<boolean> {
  if (memberRankAtLeast(member, "Ranger Captain")) {
    return true;
  }
  if (!memberRankAtLeast(member, "Ranger")) {
    return false;
  }
  const ranger = await requireRangerByDiscordId(member.id);
  const { data, error } = await supabase.from("runecloak_team_assignments")
    .select("id")
    .eq("ranger_id", ranger.id)
    .eq("assignment_kind", "organizer")
    .eq("active", true)
    .maybeSingle();
  assertNoDbError(error, "check Runecloak organizer");
  return Boolean(data);
}

export async function setRunecloakTeamAssignment(input: {
  guildId: string;
  target: RangerRow;
  kind: "organizer" | "authorized_marshal";
  active: boolean;
  actorDiscordUserId: string;
  reason?: string | null;
}): Promise<void> {
  if (input.target.status !== "Active" || !rankAtLeast(input.target.current_rank, input.kind === "organizer" ? "Ranger" : "Ranger Marshal")) {
    throw new UserFacingError(input.kind === "organizer"
      ? "A Runecloak organizer must be an active full Ranger or higher."
      : "An authorized Runecloak Marshal must be an active Ranger Marshal or higher.");
  }
  if (input.active) {
    const { error } = await supabase.from("runecloak_team_assignments").insert({
      ranger_id: input.target.id,
      assignment_kind: input.kind,
      assigned_by_discord_user_id: input.actorDiscordUserId
    });
    assertNoDbError(error, "assign Runecloak team role");
  } else {
    const { error } = await supabase.from("runecloak_team_assignments").update({
      active: false,
      ended_by_discord_user_id: input.actorDiscordUserId,
      ended_at: new Date().toISOString(),
      end_reason: normalizedOptional(input.reason ?? null, 1000)
    }).eq("ranger_id", input.target.id).eq("assignment_kind", input.kind).eq("active", true);
    assertNoDbError(error, "end Runecloak team assignment");
  }
  await recordRunecloakAudit({
    guildId: input.guildId,
    entityType: "team_assignment",
    action: input.active ? `${input.kind}_assigned` : `${input.kind}_ended`,
    actorDiscordUserId: input.actorDiscordUserId,
    reason: input.reason ?? null,
    after: { ranger_id: input.target.id, kind: input.kind, active: input.active }
  });
}

export async function listActiveRunecloakTeamAssignments(): Promise<RunecloakTeamAssignmentRow[]> {
  const { data, error } = await supabase.from("runecloak_team_assignments").select("*").eq("active", true).order("assigned_at");
  assertNoDbError(error, "list Runecloak team assignments");
  return data ?? [];
}

export async function listRunecloakSpells(): Promise<RunecloakSpellRow[]> {
  const { data, error } = await supabase.from("runecloak_spells").select("*").eq("active", true).order("sequence");
  assertNoDbError(error, "list Runecloak spells");
  return data ?? [];
}

export async function createRunecloakCycle(input: {
  guildId: string;
  spellId: string;
  label: string;
  actorDiscordUserId: string;
}): Promise<RunecloakCycleRow> {
  const settings = await requireRunecloakSettings(input.guildId);
  const { data: spell, error: spellError } = await supabase.from("runecloak_spells").select("*").eq("id", input.spellId).eq("active", true).single();
  assertNoDbError(spellError, "get Runecloak spell");
  const { data: latest, error: latestError } = await supabase.from("runecloak_cycles").select("sequence").eq("guild_id", input.guildId).order("sequence", { ascending: false }).limit(1).maybeSingle();
  assertNoDbError(latestError, "get latest Runecloak cycle sequence");
  const { data, error } = await supabase.from("runecloak_cycles").insert({
    guild_id: input.guildId,
    spell_id: spell.id,
    label: normalizedRequired(input.label, 150),
    sequence: (latest?.sequence ?? 0) + 1,
    minimum_roster_size: settings.minimum_roster_size,
    quorum_percent: settings.quorum_percent,
    point_target: spell.default_target_points || settings.point_target,
    created_by_discord_user_id: input.actorDiscordUserId
  }).select("*").single();
  assertNoDbError(error, "create Runecloak cycle");
  await recordRunecloakAudit({
    guildId: input.guildId,
    entityType: "cycle",
    entityId: data.id,
    action: "cycle_created",
    actorDiscordUserId: input.actorDiscordUserId,
    after: data
  });
  return data;
}

export async function listRunecloakCycles(guildId: string): Promise<RunecloakCycleRow[]> {
  const { data, error } = await supabase.from("runecloak_cycles").select("*").eq("guild_id", guildId).order("sequence", { ascending: false });
  assertNoDbError(error, "list Runecloak cycles");
  return data ?? [];
}

export async function getRunecloakCycleDetails(cycleId: string): Promise<RunecloakCycleDetails | null> {
  const { data: cycle, error } = await supabase.from("runecloak_cycles").select("*").eq("id", cycleId).maybeSingle();
  assertNoDbError(error, "get Runecloak cycle");
  if (!cycle) {
    return null;
  }
  const [spellResult, membersResult, stagesResult] = await Promise.all([
    supabase.from("runecloak_spells").select("*").eq("id", cycle.spell_id).single(),
    supabase.from("runecloak_cycle_members").select("*").eq("cycle_id", cycle.id).order("selected_at"),
    supabase.from("runecloak_stages").select("*").eq("cycle_id", cycle.id).order("sequence")
  ]);
  assertNoDbError(spellResult.error, "get Runecloak cycle spell");
  assertNoDbError(membersResult.error, "get Runecloak cycle members");
  assertNoDbError(stagesResult.error, "get Runecloak cycle stages");
  return { cycle, spell: spellResult.data, members: membersResult.data ?? [], stages: stagesResult.data ?? [] };
}

export async function getCurrentRunecloakCycle(guildId: string): Promise<RunecloakCycleDetails | null> {
  const { data, error } = await supabase.from("runecloak_cycles").select("id")
    .eq("guild_id", guildId)
    .in("status", ["Locked", "Awaiting Moonshadow Start", "Active", "Awaiting Moonshadow Grant"])
    .maybeSingle();
  assertNoDbError(error, "get current Runecloak cycle");
  return data ? getRunecloakCycleDetails(data.id) : null;
}

export async function addRunecloakCycleMember(input: {
  cycleId: string;
  applicationId: string;
  actorDiscordUserId: string;
}): Promise<RunecloakCycleMemberRow> {
  const [cycle, application] = await Promise.all([
    getRunecloakCycleDetails(input.cycleId),
    getRunecloakApplicationDetails(input.applicationId)
  ]);
  if (!cycle || cycle.cycle.status !== "Draft") {
    throw new UserFacingError("Learners may only be added to a Draft Runecloak cycle.");
  }
  if (!application || application.application.status !== "Approved" || application.site?.status !== "Approved") {
    throw new UserFacingError("Choose an approved applicant with an approved research site.");
  }
  const { data: completedSpell, error: completedSpellError } = await supabase.from("runecloak_spell_progress")
    .select("ranger_id")
    .eq("ranger_id", application.applicant.id)
    .eq("spell_id", cycle.spell.id)
    .eq("status", "completed")
    .maybeSingle();
  assertNoDbError(completedSpellError, "check completed Runecloak spell");
  if (completedSpell || (cycle.spell.sequence === 1 && await rangerHasRunecloakQualification(application.applicant.id))) {
    throw new UserFacingError(`That Ranger has already completed ${cycle.spell.name}.`);
  }
  const { data, error } = await supabase.from("runecloak_cycle_members").insert({
    cycle_id: cycle.cycle.id,
    ranger_id: application.applicant.id,
    application_id: application.application.id,
    selected_by_discord_user_id: input.actorDiscordUserId
  }).select("*").single();
  assertNoDbError(error, "add Runecloak cycle learner");
  await recordRunecloakAudit({
    guildId: cycle.cycle.guild_id,
    entityType: "cycle_member",
    entityId: data.id,
    action: "learner_selected",
    actorDiscordUserId: input.actorDiscordUserId,
    after: { cycle_id: cycle.cycle.id, ranger_id: data.ranger_id, application_id: data.application_id }
  });
  return data;
}

export async function removeRunecloakCycleMember(input: {
  cycleId: string;
  rangerId: string;
  actorDiscordUserId: string;
}): Promise<void> {
  const cycle = await getRunecloakCycleDetails(input.cycleId);
  if (!cycle || cycle.cycle.status !== "Draft") {
    throw new UserFacingError("Learners may only be removed from a Draft Runecloak cycle.");
  }
  const { data: member, error: memberError } = await supabase.from("runecloak_cycle_members").select("*")
    .eq("cycle_id", input.cycleId).eq("ranger_id", input.rangerId).maybeSingle();
  assertNoDbError(memberError, "get draft Runecloak learner");
  if (!member) {
    throw new UserFacingError("That Ranger is not on the selected draft roster.");
  }
  const { error } = await supabase.from("runecloak_cycle_members").delete().eq("id", member.id);
  assertNoDbError(error, "remove Runecloak cycle learner");
  await recordRunecloakAudit({
    guildId: cycle.cycle.guild_id,
    entityType: "cycle_member",
    entityId: member.id,
    action: "learner_removed_before_lock",
    actorDiscordUserId: input.actorDiscordUserId,
    before: { cycle_id: cycle.cycle.id, ranger_id: member.ranger_id, application_id: member.application_id }
  });
}

export async function lockRunecloakCycle(cycleId: string, actorDiscordUserId: string): Promise<unknown> {
  const { data, error } = await supabase.rpc("lock_runecloak_cycle", {
    cycle_id_input: cycleId,
    actor_discord_user_id_input: actorDiscordUserId
  });
  assertNoDbError(error, "lock Runecloak cycle");
  return data;
}

export async function startRunecloakCycle(input: {
  guildId: string;
  cycleId: string;
  reference: string;
  actorDiscordUserId: string;
}): Promise<RunecloakCycleRow> {
  const settings = await requireRunecloakSettings(input.guildId);
  if (settings.program_state !== "Registered") {
    throw new UserFacingError("Moonshadow registration must be confirmed before an official cycle starts.");
  }
  const details = await getRunecloakCycleDetails(input.cycleId);
  if (!details || (details.cycle.status !== "Locked" && details.cycle.status !== "Awaiting Moonshadow Start")) {
    throw new UserFacingError("That cycle is not waiting for Moonshadow start confirmation.");
  }
  const { data, error } = await supabase.from("runecloak_cycles").update({
    status: "Active",
    start_reference: normalizedRequired(input.reference, 1000),
    started_by_discord_user_id: input.actorDiscordUserId,
    started_at: new Date().toISOString()
  }).eq("id", input.cycleId).select("*").single();
  assertNoDbError(error, "start Runecloak cycle");
  await recordRunecloakAudit({
    guildId: input.guildId,
    entityType: "cycle",
    entityId: input.cycleId,
    action: "cycle_started",
    actorDiscordUserId: input.actorDiscordUserId,
    reason: input.reference,
    before: { status: details.cycle.status },
    after: { status: data.status }
  });
  return data;
}

export async function createRunecloakStage(input: {
  guildId: string;
  cycleId: string;
  title: string;
  theme: string;
  cooldownLabel: string;
  euPlannedAt: string | null;
  naPlannedAt: string | null;
  notes: string | null;
  actorDiscordUserId: string;
}): Promise<{ stage: RunecloakStageRow; sessions: RunecloakSessionRow[] }> {
  const cycle = await getRunecloakCycleDetails(input.cycleId);
  if (!cycle || cycle.cycle.status !== "Active" || !cycle.cycle.required_stage_attendance) {
    throw new UserFacingError("Stages may only be opened for an active, locked cycle.");
  }
  const sequence = (cycle.stages.at(-1)?.sequence ?? 0) + 1;
  const { data: stage, error } = await supabase.from("runecloak_stages").insert({
    cycle_id: cycle.cycle.id,
    sequence,
    cooldown_label: normalizedRequired(input.cooldownLabel, 100),
    title: normalizedRequired(input.title, 150),
    theme: normalizedRequired(input.theme, 1000),
    notes: normalizedOptional(input.notes, 1800),
    status: "Open",
    required_unique_attendance: cycle.cycle.required_stage_attendance,
    created_by_discord_user_id: input.actorDiscordUserId
  }).select("*").single();
  assertNoDbError(error, "create Runecloak stage");
  const { data: sessions, error: sessionsError } = await supabase.from("runecloak_sessions").insert([
    { stage_id: stage.id, regional_slot: "EU", planned_at: input.euPlannedAt, logged_by_discord_user_id: input.actorDiscordUserId },
    { stage_id: stage.id, regional_slot: "NA", planned_at: input.naPlannedAt, logged_by_discord_user_id: input.actorDiscordUserId }
  ]).select("*");
  assertNoDbError(sessionsError, "create Runecloak regional sessions");
  await recordRunecloakAudit({
    guildId: input.guildId,
    entityType: "stage",
    entityId: stage.id,
    action: "stage_opened",
    actorDiscordUserId: input.actorDiscordUserId,
    after: { sequence, title: stage.title, cooldown: stage.cooldown_label }
  });
  return { stage, sessions: sessions ?? [] };
}

export async function attachRunecloakStageForumPost(input: {
  stageId: string;
  threadId: string;
  messageId: string | null;
}): Promise<void> {
  const { error } = await supabase.from("runecloak_stages").update({
    forum_thread_id: input.threadId,
    forum_message_id: input.messageId
  }).eq("id", input.stageId);
  assertNoDbError(error, "attach Runecloak stage post");
}

export async function getRunecloakStage(stageId: string): Promise<{
  stage: RunecloakStageRow;
  cycle: RunecloakCycleRow;
  spell: RunecloakSpellRow;
  sessions: RunecloakSessionRow[];
  participation: RunecloakSessionParticipationRow[];
} | null> {
  const { data: stage, error } = await supabase.from("runecloak_stages").select("*").eq("id", stageId).maybeSingle();
  assertNoDbError(error, "get Runecloak stage");
  if (!stage) {
    return null;
  }
  const cycleDetails = await getRunecloakCycleDetails(stage.cycle_id);
  if (!cycleDetails) {
    return null;
  }
  const [sessionsResult, participationResult] = await Promise.all([
    supabase.from("runecloak_sessions").select("*").eq("stage_id", stage.id).order("regional_slot"),
    supabase.from("runecloak_session_participation").select("*").eq("stage_id", stage.id).order("submitted_at")
  ]);
  assertNoDbError(sessionsResult.error, "get Runecloak sessions");
  assertNoDbError(participationResult.error, "get Runecloak participation");
  return {
    stage,
    cycle: cycleDetails.cycle,
    spell: cycleDetails.spell,
    sessions: sessionsResult.data ?? [],
    participation: participationResult.data ?? []
  };
}

export async function recordRunecloakParticipation(input: {
  guildId: string;
  stageId: string;
  regionalSlot: "EU" | "NA";
  member: GuildMember;
  rollValue: number | null;
}): Promise<{ participation: RunecloakSessionParticipationRow; kind: "learner" | "observer" }> {
  const stageDetails = await getRunecloakStage(input.stageId);
  if (!stageDetails || stageDetails.stage.status !== "Open" || stageDetails.cycle.status !== "Active") {
    throw new UserFacingError("That Runecloak expedition is not accepting participation records.");
  }
  const ranger = await requireRangerByDiscordId(input.member.id);
  const { data: cycleMember, error: memberError } = await supabase.from("runecloak_cycle_members").select("*")
    .eq("cycle_id", stageDetails.cycle.id).eq("ranger_id", ranger.id).maybeSingle();
  assertNoDbError(memberError, "check Runecloak cycle learner");
  const kind = cycleMember?.participation_status === "Active" ? "learner" : "observer";
  if (kind === "learner" && (ranger.status !== "Active" || !rankAtLeast(ranger.current_rank, "Ranger"))) {
    throw new UserFacingError("Only an active full Ranger may submit official Runecloak study results.");
  }
  if (kind === "observer" && !mainRankFromMember(input.member)) {
    throw new UserFacingError("An Apprentice or Ranger Corps rank is required to observe this expedition.");
  }
  if (kind === "learner" && (input.rollValue === null || !Number.isInteger(input.rollValue) || input.rollValue < 1 || input.rollValue > 100)) {
    throw new UserFacingError("Enter the result of your in-game `/roll 100`, from 1 through 100.");
  }
  const session = stageDetails.sessions.find(({ regional_slot }) => regional_slot === input.regionalSlot);
  if (!session || session.status === "Cancelled" || session.status === "Verified") {
    throw new UserFacingError(`The ${input.regionalSlot} session is not accepting new records.`);
  }
  const existingRoll = stageDetails.participation.find((entry) =>
    entry.ranger_id === ranger.id && entry.status !== "rejected" && entry.roll_value !== null
  );
  const existingSessionRecord = stageDetails.participation.find((entry) =>
    entry.ranger_id === ranger.id && entry.session_id === session.id && entry.status !== "rejected"
  );
  const roll = kind === "learner"
    ? existingRoll && existingRoll.session_id !== session.id
      ? null
      : input.rollValue ?? existingSessionRecord?.roll_value ?? null
    : null;
  const { data, error } = await supabase.from("runecloak_session_participation").upsert({
    stage_id: stageDetails.stage.id,
    session_id: session.id,
    ranger_id: ranger.id,
    participation_kind: kind,
    status: "provisional",
    roll_value: roll,
    submitted_by_discord_user_id: input.member.id,
    submitted_at: new Date().toISOString()
  }, { onConflict: "session_id,ranger_id" }).select("*").single();
  assertNoDbError(error, "record Runecloak participation");
  await recordRunecloakAudit({
    guildId: input.guildId,
    entityType: "participation",
    entityId: data.id,
    action: kind === "learner" ? "learner_participation_recorded" : "observer_participation_recorded",
    actorDiscordUserId: input.member.id,
    after: { stage_id: stageDetails.stage.id, slot: input.regionalSlot, kind, roll_value: roll }
  });
  return { participation: data, kind };
}

export async function submitRunecloakSession(input: {
  guildId: string;
  stageId: string;
  regionalSlot: "EU" | "NA";
  actualAt: string;
  siteId: string;
  leaderDiscordUserId: string;
  lessonSummary: string;
  studyMethod: string;
  recordingUrl: string;
  moonshadowReference: string | null;
  actorDiscordUserId: string;
}): Promise<RunecloakSessionRow> {
  assertHttpsOrDiscordUrl(input.recordingUrl, "Recording URL");
  const actualAt = parsedDateTime(input.actualAt, "actual session time");
  const stage = await getRunecloakStage(input.stageId);
  const session = stage?.sessions.find(({ regional_slot }) => regional_slot === input.regionalSlot);
  if (!stage || !session || stage.stage.status !== "Open") {
    throw new UserFacingError("That Runecloak session is not open for a lesson record.");
  }
  const { data: site, error: siteError } = await supabase.from("runecloak_research_sites").select("id").eq("id", input.siteId).eq("status", "Approved").maybeSingle();
  assertNoDbError(siteError, "check approved Runecloak research site");
  if (!site) {
    throw new UserFacingError("Choose an approved Runecloak research site.");
  }
  const { data, error } = await supabase.from("runecloak_sessions").update({
    actual_at: actualAt,
    research_site_id: site.id,
    leader_discord_user_id: input.leaderDiscordUserId,
    lesson_summary: normalizedRequired(input.lessonSummary, 1800),
    study_method: normalizedRequired(input.studyMethod, 1800),
    recording_url: input.recordingUrl.trim(),
    moonshadow_reference: normalizedOptional(input.moonshadowReference, 1000),
    status: "Submitted",
    logged_by_discord_user_id: input.actorDiscordUserId
  }).eq("id", session.id).select("*").single();
  assertNoDbError(error, "submit Runecloak session record");
  await recordRunecloakAudit({
    guildId: input.guildId,
    entityType: "session",
    entityId: session.id,
    action: "session_submitted",
    actorDiscordUserId: input.actorDiscordUserId,
    after: { stage_id: input.stageId, slot: input.regionalSlot, recording_url: data.recording_url }
  });
  return data;
}

export async function verifyRunecloakSession(input: {
  guildId: string;
  stageId: string;
  regionalSlot: "EU" | "NA";
  basis: "present" | "recording_review";
  actorDiscordUserId: string;
}): Promise<RunecloakSessionRow> {
  const stage = await getRunecloakStage(input.stageId);
  const session = stage?.sessions.find(({ regional_slot }) => regional_slot === input.regionalSlot);
  if (!stage || !session || session.status !== "Submitted") {
    throw new UserFacingError("Submit the complete session record before verifying it.");
  }
  if (!session.actual_at || !session.research_site_id || !session.leader_discord_user_id || !session.lesson_summary
      || !session.study_method || !session.recording_url) {
    throw new UserFacingError("The session record is missing required fieldwork or recording details.");
  }
  const verifiedAt = new Date().toISOString();
  const [sessionResult, participationResult] = await Promise.all([
    supabase.from("runecloak_sessions").update({
      status: "Verified",
      verified_by_discord_user_id: input.actorDiscordUserId,
      verification_basis: input.basis,
      verified_at: verifiedAt
    }).eq("id", session.id).select("*").single(),
    supabase.from("runecloak_session_participation").update({
      status: "verified",
      verified_by_discord_user_id: input.actorDiscordUserId,
      verified_at: verifiedAt
    }).eq("session_id", session.id).eq("status", "provisional")
  ]);
  assertNoDbError(sessionResult.error, "verify Runecloak session");
  assertNoDbError(participationResult.error, "verify Runecloak session participation");
  await recordRunecloakAudit({
    guildId: input.guildId,
    entityType: "session",
    entityId: session.id,
    action: "session_verified",
    actorDiscordUserId: input.actorDiscordUserId,
    after: { stage_id: input.stageId, slot: input.regionalSlot, basis: input.basis }
  });
  return sessionResult.data;
}

export async function verifyRunecloakStage(input: {
  stageId: string;
  actorDiscordUserId: string;
  reason?: string | null;
}): Promise<unknown> {
  const { data, error } = await supabase.rpc("verify_runecloak_stage", {
    stage_id_input: input.stageId,
    actor_discord_user_id_input: input.actorDiscordUserId,
    reason_input: input.reason ?? null
  });
  assertNoDbError(error, "verify paired Runecloak stage");
  return data;
}

export async function getRunecloakCycleCompletionPreview(cycleId: string): Promise<RunecloakCompletionPreview> {
  const details = await getRunecloakCycleDetails(cycleId);
  if (!details) {
    throw new UserFacingError("That Runecloak cycle no longer exists.");
  }
  if (details.cycle.status !== "Awaiting Moonshadow Grant" || details.cycle.verified_points < details.cycle.point_target) {
    throw new UserFacingError("That cycle has not reached its verified target and cannot receive a final grant yet.");
  }
  const validStageIds = details.stages.filter(({ status }) => status === "Valid").map(({ id }) => id);
  if (!validStageIds.length) {
    throw new UserFacingError("That cycle has no valid paired stages.");
  }
  const rangerIds = details.members.map(({ ranger_id }) => ranger_id);
  const [rangersResult, progressResult, attendanceResult] = await Promise.all([
    supabase.from("rangers").select("*").in("id", rangerIds),
    supabase.from("runecloak_spell_progress").select("*").eq("spell_id", details.spell.id).in("ranger_id", rangerIds),
    supabase.from("runecloak_session_participation").select("ranger_id, stage_id")
      .eq("participation_kind", "learner")
      .eq("status", "verified")
      .in("stage_id", validStageIds)
      .in("ranger_id", rangerIds)
  ]);
  assertNoDbError(rangersResult.error, "load Runecloak completion Rangers");
  assertNoDbError(progressResult.error, "load Runecloak carried attendance");
  assertNoDbError(attendanceResult.error, "load Runecloak cycle attendance");
  const rangersById = new Map((rangersResult.data ?? []).map((ranger) => [ranger.id, ranger]));
  const progressByRangerId = new Map((progressResult.data ?? []).map((progress) => [progress.ranger_id, progress]));
  const stagesByRangerId = new Map<string, Set<string>>();
  for (const attendance of attendanceResult.data ?? []) {
    const stages = stagesByRangerId.get(attendance.ranger_id) ?? new Set<string>();
    stages.add(attendance.stage_id);
    stagesByRangerId.set(attendance.ranger_id, stages);
  }
  const defaultRequired = requiredPersonalAttendance(validStageIds.length);
  const candidates = details.members.flatMap((member): RunecloakCompletionCandidate[] => {
    const ranger = rangersById.get(member.ranger_id);
    if (!ranger) {
      return [];
    }
    const progress = progressByRangerId.get(member.ranger_id);
    const requiredAttendanceCredits = progress?.required_attendance_credits ?? defaultRequired;
    const credit = calculateRunecloakAttendanceCredit({
      priorCredits: progress?.verified_attendance_credits ?? 0,
      requiredCredits: requiredAttendanceCredits,
      attendedStages: stagesByRangerId.get(member.ranger_id)?.size ?? 0
    });
    return [{
      ranger,
      participationStatus: member.participation_status,
      priorAttendanceCredits: progress?.verified_attendance_credits ?? 0,
      cycleAttendanceCredits: credit.earnedCredits,
      retainedAttendanceCredits: credit.retainedCredits,
      requiredAttendanceCredits,
      eligible: credit.complete && member.participation_status !== "Withdrawn" && member.participation_status !== "Ineligible"
    }];
  });
  return { details, validStageCount: validStageIds.length, candidates };
}

export async function completeRunecloakCycle(input: {
  cycleId: string;
  actorDiscordUserId: string;
  grantReference: string;
  confirmedRangerIds: string[];
}): Promise<unknown> {
  const preview = await getRunecloakCycleCompletionPreview(input.cycleId);
  const eligibleRangerIds = new Set(preview.candidates.filter(({ eligible }) => eligible).map(({ ranger }) => ranger.id));
  const confirmed = [...new Set(input.confirmedRangerIds)];
  const invalid = confirmed.filter((rangerId) => !eligibleRangerIds.has(rangerId));
  if (invalid.length) {
    throw new UserFacingError("The confirmed list contains a Ranger who is not currently eligible. Refresh the completion preview and try again.");
  }
  const { data, error } = await supabase.rpc("complete_runecloak_cycle", {
    cycle_id_input: input.cycleId,
    actor_discord_user_id_input: input.actorDiscordUserId,
    grant_reference_input: input.grantReference,
    confirmed_ranger_ids_input: confirmed
  });
  assertNoDbError(error, "complete Runecloak cycle");
  return data;
}

export async function setRunecloakCycleMemberStatus(input: {
  guildId: string;
  cycleId: string;
  rangerId: string;
  status: "Withdrawn" | "Ineligible";
  reason: string;
  actorDiscordUserId: string;
}): Promise<string[]> {
  const cycle = await getRunecloakCycleDetails(input.cycleId);
  if (!cycle || !["Locked", "Awaiting Moonshadow Start", "Active", "Awaiting Moonshadow Grant"].includes(cycle.cycle.status)) {
    throw new UserFacingError("Only a learner on a locked, unfinished Runecloak cycle may be withdrawn or marked ineligible.");
  }
  const { data: before, error: beforeError } = await supabase.from("runecloak_cycle_members").select("*")
    .eq("cycle_id", input.cycleId).eq("ranger_id", input.rangerId).single();
  assertNoDbError(beforeError, "get Runecloak cycle learner");
  const { error } = await supabase.from("runecloak_cycle_members").update({
    participation_status: input.status,
    status_reason: normalizedRequired(input.reason, 1000),
    status_changed_by_discord_user_id: input.actorDiscordUserId,
    status_changed_at: new Date().toISOString()
  }).eq("id", before.id);
  assertNoDbError(error, "update Runecloak cycle learner status");
  await recordRunecloakAudit({
    guildId: input.guildId,
    entityType: "cycle_member",
    entityId: before.id,
    action: `learner_${input.status.toLowerCase()}`,
    actorDiscordUserId: input.actorDiscordUserId,
    reason: input.reason,
    before: { status: before.participation_status },
    after: { status: input.status }
  });
  if (input.status !== "Ineligible" || (cycle.cycle.status !== "Active" && cycle.cycle.status !== "Awaiting Moonshadow Grant")) {
    return [];
  }
  const revalidatedStageIds: string[] = [];
  for (const stage of cycle.stages.filter(({ status }) => status === "Valid" || status === "Invalid")) {
    await verifyRunecloakStage({
      stageId: stage.id,
      actorDiscordUserId: input.actorDiscordUserId,
      reason: `Recalculated after ${input.reason}`
    });
    revalidatedStageIds.push(stage.id);
  }
  return revalidatedStageIds;
}

export async function listRangerQualifications(rangerId: string): Promise<Array<{
  award: RangerQualificationRow;
  name: string;
  emoji: string | null;
}>> {
  const { data: awards, error } = await supabase.from("ranger_qualifications").select("*")
    .eq("ranger_id", rangerId).is("revoked_at", null).order("awarded_at");
  assertNoDbError(error, "list Ranger qualifications");
  const { data: definitions, error: definitionsError } = await supabase.from("corps_qualifications").select("*").eq("active", true);
  assertNoDbError(definitionsError, "list Corps qualifications");
  const byId = new Map((definitions ?? []).map((definition) => [definition.id, definition]));
  return (awards ?? []).flatMap((award) => {
    const definition = byId.get(award.qualification_id);
    return definition ? [{ award, name: definition.name, emoji: definition.emoji }] : [];
  });
}

export async function listRunecloakSpellProgress(rangerId: string): Promise<Array<{
  progress: RunecloakSpellProgressRow;
  spell: RunecloakSpellRow;
}>> {
  const [progressResult, spellResult] = await Promise.all([
    supabase.from("runecloak_spell_progress").select("*").eq("ranger_id", rangerId),
    supabase.from("runecloak_spells").select("*").order("sequence")
  ]);
  assertNoDbError(progressResult.error, "list Runecloak spell progress");
  assertNoDbError(spellResult.error, "list Runecloak spells");
  const byId = new Map((spellResult.data ?? []).map((spell) => [spell.id, spell]));
  return (progressResult.data ?? []).flatMap((progress) => {
    const spell = byId.get(progress.spell_id);
    return spell ? [{ progress, spell }] : [];
  });
}

export async function rangerHasRunecloakQualification(rangerId: string): Promise<boolean> {
  const { data: qualification, error: qualificationError } = await supabase.from("corps_qualifications").select("id")
    .eq("slug", RUNECLOAK_QUALIFICATION_SLUG).maybeSingle();
  assertNoDbError(qualificationError, "get Runecloak qualification");
  if (!qualification) {
    return false;
  }
  const { data, error } = await supabase.from("ranger_qualifications").select("id")
    .eq("qualification_id", qualification.id).eq("ranger_id", rangerId).is("revoked_at", null).maybeSingle();
  assertNoDbError(error, "check Ranger Runecloak qualification");
  return Boolean(data);
}

export async function listRunecloakAuditEvents(guildId: string, cycleId?: string | null): Promise<RunecloakAuditEventRow[]> {
  const { data, error } = await supabase.from("runecloak_audit_events").select("*")
    .eq("guild_id", guildId).order("created_at").limit(5000);
  assertNoDbError(error, "list Runecloak audit events");
  const events = data ?? [];
  if (!cycleId) {
    return events;
  }
  const details = await getRunecloakCycleDetails(cycleId);
  if (!details || details.cycle.guild_id !== guildId) {
    throw new UserFacingError("That Runecloak cycle does not exist in this server.");
  }
  const stageIds = details.stages.map(({ id }) => id);
  const [sessionsResult, participationResult] = stageIds.length
    ? await Promise.all([
      supabase.from("runecloak_sessions").select("id").in("stage_id", stageIds),
      supabase.from("runecloak_session_participation").select("id").in("stage_id", stageIds)
    ])
    : [{ data: [], error: null }, { data: [], error: null }];
  assertNoDbError(sessionsResult.error, "load Runecloak cycle sessions for audit");
  assertNoDbError(participationResult.error, "load Runecloak cycle participation for audit");
  const entityIds = new Set([
    cycleId,
    ...details.members.map(({ id }) => id),
    ...stageIds,
    ...(sessionsResult.data ?? []).map(({ id }) => id),
    ...(participationResult.data ?? []).map(({ id }) => id)
  ]);
  const referencesCycle = (value: unknown): boolean => Boolean(
    value && typeof value === "object" && !Array.isArray(value)
      && "cycle_id" in value && String((value as Record<string, unknown>).cycle_id) === cycleId
  );
  return events.filter((event) => (
    Boolean(event.entity_id && entityIds.has(event.entity_id))
    || referencesCycle(event.before_snapshot)
    || referencesCycle(event.after_snapshot)
  ));
}

export async function recordRunecloakAudit(input: {
  guildId: string;
  entityType: string;
  entityId?: string | null;
  action: string;
  actorDiscordUserId: string;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  sourceUrl?: string | null;
}): Promise<void> {
  const { error } = await supabase.from("runecloak_audit_events").insert({
    guild_id: input.guildId,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    action: input.action,
    actor_discord_user_id: input.actorDiscordUserId,
    reason: input.reason ?? null,
    before_snapshot: jsonValue(input.before),
    after_snapshot: jsonValue(input.after),
    source_url: input.sourceUrl ?? null
  });
  assertNoDbError(error, "record Runecloak audit event");
}

export function assertRunecloakCaptain(member: GuildMember): void {
  if (!memberRankAtLeast(member, "Ranger Captain")) {
    throw new UserFacingError("Ranger Captain or higher is required for that Runecloak decision.");
  }
}

export function assertRunecloakCommander(member: GuildMember): void {
  if (!memberRankAtLeast(member, "Ranger Commander")) {
    throw new UserFacingError("Ranger Commander is required to configure the Runecloak system.");
  }
}

async function updateRunecloakQualificationRole(roleId: string): Promise<void> {
  const { error } = await supabase.from("corps_qualifications").update({ discord_role_id: roleId }).eq("slug", RUNECLOAK_QUALIFICATION_SLUG);
  assertNoDbError(error, "update Runecloak qualification role");
}

function normalizedRequired(value: string, maxLength: number): string {
  const result = value.trim().slice(0, maxLength);
  if (!result) {
    throw new UserFacingError("Required Runecloak fields cannot be blank.");
  }
  return result;
}

function normalizedOptional(value: string | null | undefined, maxLength: number): string | null {
  const result = value?.trim().slice(0, maxLength) ?? "";
  return result || null;
}

function assertHttpsOrDiscordUrl(value: string, label: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new UserFacingError(`${label} must be a complete HTTPS link.`);
  }
  if (parsed.protocol !== "https:") {
    throw new UserFacingError(`${label} must use HTTPS.`);
  }
}

function parsedDateTime(value: string, label: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new UserFacingError(`Enter the ${label} as an ISO date and time, such as 2026-09-14T20:00:00Z.`);
  }
  return parsed.toISOString();
}

function jsonValue(value: unknown): never {
  return (value === undefined ? null : JSON.parse(JSON.stringify(value))) as never;
}
