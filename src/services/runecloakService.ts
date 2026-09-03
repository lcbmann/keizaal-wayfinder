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
  type RunecloakMembershipRow,
  type RunecloakMembershipStatus,
  type RunecloakPersonalStudyCreditRow,
  type RunecloakProgramState,
  type RunecloakResearchSiteRow,
  type RunecloakSessionParticipationRow,
  type RunecloakSessionRow,
  type RunecloakSettingsRow,
  type RunecloakSpellUnlockRow,
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
export const DEFAULT_RUNECLOAK_PERSONAL_POINT_TARGET = 300;
export const DEFAULT_RUNECLOAK_PERSONAL_STAGE_TARGET = 5;
export const DEFAULT_RUNECLOAK_REGIONAL_COOLDOWN_HOURS = 72;

const OPEN_APPLICATION_STATES: RunecloakApplicationStatus[] = [
  "Submitted",
  "Survey Requested",
  "Survey Submitted",
  "Revision Requested"
];

const APPLICATION_TRANSITIONS: Record<RunecloakApplicationStatus, RunecloakApplicationStatus[]> = {
  Submitted: ["Survey Requested", "Denied", "Withdrawn"],
  "Survey Requested": ["Survey Submitted", "Denied", "Withdrawn"],
  "Survey Submitted": ["Approved", "Revision Requested", "Denied", "Withdrawn"],
  "Revision Requested": ["Survey Submitted", "Denied", "Withdrawn"],
  Approved: [],
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
  membershipStatus: RunecloakMembershipStatus;
  verifiedPoints: number;
  verifiedStages: number;
  requiredPoints: number;
  requiredStages: number;
  eligible: boolean;
}

export interface RunecloakCompletionPreview {
  details: RunecloakCycleDetails;
  validStageCount: number;
  candidates: RunecloakCompletionCandidate[];
}

export interface RunecloakPersonalProgressDetails {
  progress: RunecloakSpellProgressRow;
  spell: RunecloakSpellRow;
  unlock: RunecloakSpellUnlockRow | null;
}

export function requiredStageAttendance(rosterSize: number, quorumPercent = 51): number {
  if (!Number.isInteger(rosterSize) || rosterSize < 1) {
    throw new Error("Roster size must be a positive integer.");
  }
  return Math.ceil(rosterSize * quorumPercent / 100);
}

export function runecloakPersonalEligibility(input: {
  verifiedPoints: number;
  verifiedStages: number;
  requiredPoints?: number;
  requiredStages?: number;
}): boolean {
  const requiredPoints = input.requiredPoints ?? DEFAULT_RUNECLOAK_PERSONAL_POINT_TARGET;
  const requiredStages = input.requiredStages ?? DEFAULT_RUNECLOAK_PERSONAL_STAGE_TARGET;
  return input.verifiedPoints >= requiredPoints && input.verifiedStages >= requiredStages;
}

export function earliestRunecloakStudySpell<T extends { id: string; sequence: number }>(
  spells: readonly T[],
  completedSpellIds: ReadonlySet<string>,
  campaignSequence: number
): T | null {
  return [...spells]
    .filter((spell) => spell.sequence <= campaignSequence && !completedSpellIds.has(spell.id))
    .sort((left, right) => left.sequence - right.sequence)[0] ?? null;
}

export function runecloakRegionalCooldown(
  previousActualAt: string | null,
  candidateActualAt: string,
  cooldownHours = DEFAULT_RUNECLOAK_REGIONAL_COOLDOWN_HOURS
): { allowed: boolean; eligibleAt: string | null } {
  const candidateTime = new Date(candidateActualAt).getTime();
  if (!Number.isFinite(candidateTime)) {
    throw new Error("The candidate Runecloak session time is invalid.");
  }
  if (!previousActualAt) {
    return { allowed: true, eligibleAt: null };
  }
  const previousTime = new Date(previousActualAt).getTime();
  if (!Number.isFinite(previousTime)) {
    throw new Error("The previous Runecloak session time is invalid.");
  }
  const eligibleTime = previousTime + cooldownHours * 60 * 60 * 1000;
  return {
    allowed: candidateTime >= eligibleTime,
    eligibleAt: new Date(eligibleTime).toISOString()
  };
}

export function runecloakSessionCanBeSubmitted(status: RunecloakSessionRow["status"]): boolean {
  return status === "Planned" || status === "Submitted";
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
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}]`;
}

export function normalizeRunecloakImageUrl(value: string): string {
  const trimmed = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return trimmed;
  }
  const hostname = parsed.hostname.toLocaleLowerCase().replace(/^www\./u, "");
  if (hostname !== "imgur.com" && hostname !== "m.imgur.com" && hostname !== "i.imgur.com") {
    return trimmed;
  }
  const pathParts = parsed.pathname.split("/").filter(Boolean);
  if (pathParts.length !== 1 || !/^[a-z0-9]+(?:\.(?:jpe?g|png|gif|webp))?$/iu.test(pathParts[0] ?? "")) {
    return trimmed;
  }
  const imageName = pathParts[0] ?? "";
  const directName = /\.(?:jpe?g|png|gif|webp)$/iu.test(imageName) ? imageName : `${imageName}.jpg`;
  return `https://i.imgur.com/${directName}`;
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
  deskChannelId: string;
  applicationReviewChannelId: string;
  runecloakChannelId: string;
  learnerChannelId: string;
  expeditionForumId: string;
  guideRoleId: string;
  learnerRoleId: string;
  qualificationRoleId: string;
  actorDiscordUserId: string;
}): Promise<RunecloakSettingsRow> {
  const existing = await getRunecloakSettings(input.guildId);
  const { data, error } = await supabase.from("runecloak_settings").upsert({
    guild_id: input.guildId,
    category_id: input.categoryId,
    desk_channel_id: input.deskChannelId,
    application_review_channel_id: input.applicationReviewChannelId,
    runecloak_channel_id: input.runecloakChannelId,
    learner_channel_id: input.learnerChannelId,
    expedition_forum_id: input.expeditionForumId,
    dashboard_message_id: existing?.dashboard_message_id ?? null,
    guide_role_id: input.guideRoleId,
    learner_role_id: input.learnerRoleId,
    qualification_role_id: input.qualificationRoleId,
    admissions_open: existing?.admissions_open ?? false,
    program_state: existing?.program_state ?? "Organizing",
    registration_reference: existing?.registration_reference ?? null,
    registration_confirmed_by_discord_user_id: existing?.registration_confirmed_by_discord_user_id ?? null,
    registration_confirmed_at: existing?.registration_confirmed_at ?? null,
    minimum_roster_size: existing?.minimum_roster_size ?? 20,
    quorum_percent: existing?.quorum_percent ?? 51,
    point_target: existing?.point_target ?? 8000,
    personal_point_requirement: existing?.personal_point_requirement ?? DEFAULT_RUNECLOAK_PERSONAL_POINT_TARGET,
    personal_stage_requirement: existing?.personal_stage_requirement ?? DEFAULT_RUNECLOAK_PERSONAL_STAGE_TARGET,
    regional_cooldown_hours: existing?.regional_cooldown_hours ?? DEFAULT_RUNECLOAK_REGIONAL_COOLDOWN_HOURS,
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

export async function setRunecloakAdmissionsOpen(input: {
  guildId: string;
  open: boolean;
  actorDiscordUserId: string;
}): Promise<RunecloakSettingsRow> {
  const before = await requireRunecloakSettings(input.guildId);
  const { data, error } = await supabase.from("runecloak_settings").update({
    admissions_open: input.open
  }).eq("guild_id", input.guildId).select("*").single();
  assertNoDbError(error, "update Runecloak admissions");
  await recordRunecloakAudit({
    guildId: input.guildId,
    entityType: "program",
    action: input.open ? "admissions_opened" : "admissions_closed",
    actorDiscordUserId: input.actorDiscordUserId,
    before: { admissions_open: before.admissions_open },
    after: { admissions_open: data.admissions_open }
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
  if (input.state === "Registered" && !before.registration_confirmed_at) {
    const memberships = await listActiveRunecloakMemberships(input.guildId);
    const rangerIds = memberships.map(({ ranger_id }) => ranger_id);
    const { data: rangers, error: rangersError } = rangerIds.length
      ? await supabase.from("rangers").select("id, status, current_rank").in("id", rangerIds)
      : { data: [], error: null };
    assertNoDbError(rangersError, "validate Runecloak registration learners");
    const eligibleCount = (rangers ?? []).filter((ranger) => (
      ranger.status === "Active" && rankAtLeast(ranger.current_rank, "Ranger")
    )).length;
    if (eligibleCount < before.minimum_roster_size) {
      throw new UserFacingError(
        `Moonshadow registration needs at least ${before.minimum_roster_size} active Runecloak learners; ${eligibleCount} are currently eligible.`
      );
    }
  }
  const { data, error } = await supabase.from("runecloak_settings").update({
    program_state: input.state,
    registration_reference: before.registration_confirmed_at
      ? before.registration_reference
      : input.registrationReference?.trim() || before.registration_reference,
    registration_confirmed_by_discord_user_id: input.state === "Registered"
      ? before.registration_confirmed_by_discord_user_id ?? input.actorDiscordUserId
      : before.registration_confirmed_by_discord_user_id,
    registration_confirmed_at: input.state === "Registered"
      ? before.registration_confirmed_at ?? new Date().toISOString()
      : before.registration_confirmed_at
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

export async function getRunecloakMembership(guildId: string, rangerId: string): Promise<RunecloakMembershipRow | null> {
  const { data, error } = await supabase.from("runecloak_memberships").select("*")
    .eq("guild_id", guildId).eq("ranger_id", rangerId).maybeSingle();
  assertNoDbError(error, "get Runecloak membership");
  return data;
}

export async function listActiveRunecloakMemberships(guildId: string): Promise<RunecloakMembershipRow[]> {
  const { data, error } = await supabase.from("runecloak_memberships").select("*")
    .eq("guild_id", guildId)
    .in("status", ["Learner", "Qualified"])
    .order("admitted_at");
  assertNoDbError(error, "list active Runecloak memberships");
  return data ?? [];
}

export async function listRunecloakMemberships(guildId: string): Promise<RunecloakMembershipRow[]> {
  const { data, error } = await supabase.from("runecloak_memberships").select("*")
    .eq("guild_id", guildId).order("admitted_at");
  assertNoDbError(error, "list Runecloak memberships");
  return data ?? [];
}

export async function setRunecloakMembershipStatus(input: {
  guildId: string;
  rangerId: string;
  status: "Withdrawn" | "Ineligible";
  reason: string;
  actorDiscordUserId: string;
}): Promise<RunecloakMembershipRow> {
  const before = await getRunecloakMembership(input.guildId, input.rangerId);
  if (!before || (before.status !== "Learner" && before.status !== "Qualified")) {
    throw new UserFacingError("That Ranger is not an active Runecloak learner or qualified Runecloak.");
  }
  const { data, error } = await supabase.from("runecloak_memberships").update({
    status: input.status,
    status_reason: normalizedRequired(input.reason, 1000),
    status_changed_by_discord_user_id: input.actorDiscordUserId,
    status_changed_at: new Date().toISOString()
  }).eq("id", before.id).select("*").single();
  assertNoDbError(error, "update Runecloak membership");
  await recordRunecloakAudit({
    guildId: input.guildId,
    entityType: "membership",
    entityId: before.id,
    action: `membership_${input.status.toLowerCase()}`,
    actorDiscordUserId: input.actorDiscordUserId,
    reason: input.reason,
    before: { status: before.status },
    after: { status: data.status }
  });
  return data;
}

export async function createRunecloakApplication(input: {
  member: GuildMember;
  reason: string;
  experience: string | null;
  availability: string;
  loyaltiesConflicts: string | null;
  preferredRegionalSlot?: "EU" | "NA" | "Flexible" | null;
}): Promise<RunecloakApplicationDetails> {
  const applicant = await requireRangerByDiscordId(input.member.id);
  if (applicant.status !== "Active" || !rankAtLeast(applicant.current_rank, "Ranger")) {
    throw new UserFacingError("Only active full Rangers or higher may apply for Runecloak study.");
  }
  const settings = await requireRunecloakSettings(input.member.guild.id);
  if (!settings.admissions_open) {
    throw new UserFacingError("Runecloak applications are not currently open.");
  }
  if (await rangerHasRunecloakQualification(applicant.id)) {
    throw new UserFacingError("You already hold the Ranger Runecloak qualification.");
  }
  const membership = await getRunecloakMembership(input.member.guild.id, applicant.id);
  if (membership?.status === "Learner" || membership?.status === "Qualified") {
    throw new UserFacingError("You are already enrolled in Runecloak study.");
  }
  const existing = await getOpenRunecloakApplication(applicant.id);
  if (existing) {
    if (existing.status === "Submitted") {
      const existingDetails = await getRunecloakApplicationDetails(existing.id);
      if (existingDetails) {
        return existingDetails;
      }
    }
    throw new UserFacingError(`You already have a Runecloak application in **${existing.status}** status.`);
  }

  const { data, error } = await supabase.from("runecloak_applications").insert({
    applicant_ranger_id: applicant.id,
    rank_snapshot: applicant.current_rank,
    entry_path: "standard",
    initial_screening_skipped: false,
    preferred_regional_slot: input.preferredRegionalSlot ?? regionalPreferenceFromAvailability(input.availability),
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
    review_channel_id: input.channelId,
    review_message_id: input.messageId,
    review_thread_id: input.threadId
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
  if (input.nextStatus === "Approved") {
    const { error } = await supabase.rpc("approve_runecloak_admission", {
      guild_id_input: input.guildId,
      application_id_input: input.applicationId,
      actor_discord_user_id_input: input.actorDiscordUserId,
      note_input: normalizedOptional(input.note ?? null, 1500)
    });
    assertNoDbError(error, "approve Runecloak admission");
    const approved = await getRunecloakApplicationDetails(input.applicationId);
    if (!approved) {
      throw new Error("The approved Runecloak application could not be reloaded.");
    }
    return approved;
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
  researchRationale: string;
  screenshotUrl: string | null;
}): Promise<RunecloakApplicationDetails> {
  const ranger = await requireRangerByDiscordId(input.rangerDiscordUserId);
  let application = await getOpenRunecloakApplication(ranger.id);
  if (!application && ranger.status === "Active" && rankAtLeast(ranger.current_rank, "Ranger Marshal")) {
    const settings = await requireRunecloakSettings(input.guildId);
    if (!settings.admissions_open) {
      throw new UserFacingError("Runecloak admissions are currently closed.");
    }
    const existingMembership = await getRunecloakMembership(input.guildId, ranger.id);
    if (existingMembership?.status === "Learner" || existingMembership?.status === "Qualified") {
      throw new UserFacingError("You already have a Runecloak membership record.");
    }
    const { data: directApplication, error } = await supabase.from("runecloak_applications").insert({
      applicant_ranger_id: ranger.id,
      rank_snapshot: ranger.current_rank,
      entry_path: "marshal_direct",
      initial_screening_skipped: true,
      preferred_regional_slot: null,
      status: "Survey Requested",
      reason: null,
      experience: null,
      availability: null,
      loyalties_conflicts: null
    }).select("*").single();
    assertNoDbError(error, "open Marshal-direct Runecloak survey");
    await recordRunecloakAudit({
      guildId: input.guildId,
      entityType: "application",
      entityId: directApplication.id,
      action: "marshal_direct_survey_started",
      actorDiscordUserId: input.rangerDiscordUserId,
      after: { status: directApplication.status, entry_path: directApplication.entry_path }
    });
    application = directApplication;
  }
  if (application?.status === "Survey Submitted") {
    const submitted = await getRunecloakApplicationDetails(application.id);
    if (submitted?.site) {
      return submitted;
    }
  }
  if (!application || (application.status !== "Survey Requested" && application.status !== "Revision Requested")) {
    throw new UserFacingError("A Runecloak Guide must request your survey first. Ranger Marshals and above may begin directly while admissions are open.");
  }
  if (input.screenshotUrl) {
    assertHttpsOrDiscordUrl(input.screenshotUrl, "Survey image link");
  }
  const existing = await getRunecloakApplicationDetails(application.id);
  const siteRecord = {
    application_id: application.id,
    ranger_id: ranger.id,
    name: normalizedRequired(input.siteName, 200),
    hold_region: normalizedRequired(input.holdRegion, 100),
    atlas_reference: normalizedRequired(input.atlasReference, 500),
    research_rationale: normalizedRequired(input.researchRationale, 1800),
    screenshot_url: input.screenshotUrl ? normalizeRunecloakImageUrl(input.screenshotUrl) : existing?.site?.screenshot_url || null,
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
  } else if (input.outcome === "Rejected") {
    const { error: appError } = await supabase.from("runecloak_applications").update({
      status: "Denied",
      review_note: normalizedOptional(input.note ?? null, 1500),
      reviewed_by_discord_user_id: input.actorDiscordUserId,
      reviewed_at: new Date().toISOString()
    }).eq("id", site.application_id);
    assertNoDbError(appError, "close rejected Runecloak survey");
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

export async function isRunecloakGuide(member: GuildMember): Promise<boolean> {
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
    .eq("assignment_kind", "guide")
    .eq("active", true)
    .maybeSingle();
  assertNoDbError(error, "check Runecloak Guide");
  return Boolean(data);
}

export async function setRunecloakTeamAssignment(input: {
  guildId: string;
  target: RangerRow;
  active: boolean;
  actorDiscordUserId: string;
  reason?: string | null;
}): Promise<void> {
  if (input.target.status !== "Active" || !rankAtLeast(input.target.current_rank, "Ranger")) {
    throw new UserFacingError("A Runecloak Guide must be an active full Ranger or higher.");
  }
  if (input.active) {
    const { error } = await supabase.from("runecloak_team_assignments").insert({
      ranger_id: input.target.id,
      assignment_kind: "guide",
      assigned_by_discord_user_id: input.actorDiscordUserId
    });
    assertNoDbError(error, "assign Runecloak team role");
  } else {
    const { error } = await supabase.from("runecloak_team_assignments").update({
      active: false,
      ended_by_discord_user_id: input.actorDiscordUserId,
      ended_at: new Date().toISOString(),
      end_reason: normalizedOptional(input.reason ?? null, 1000)
    }).eq("ranger_id", input.target.id).eq("assignment_kind", "guide").eq("active", true);
    assertNoDbError(error, "end Runecloak team assignment");
  }
  await recordRunecloakAudit({
    guildId: input.guildId,
    entityType: "team_assignment",
    action: input.active ? "guide_assigned" : "guide_ended",
    actorDiscordUserId: input.actorDiscordUserId,
    reason: input.reason ?? null,
    after: { ranger_id: input.target.id, kind: "guide", active: input.active }
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
  if (spell.prerequisite_spell_id) {
    const { data: prerequisiteUnlock, error: unlockError } = await supabase.from("runecloak_spell_unlocks")
      .select("id")
      .eq("guild_id", input.guildId)
      .eq("spell_id", spell.prerequisite_spell_id)
      .maybeSingle();
    assertNoDbError(unlockError, "check Runecloak campaign prerequisite");
    if (!prerequisiteUnlock) {
      throw new UserFacingError(`The shared prerequisite for ${spell.name} has not been unlocked yet.`);
    }
  }
  const { data: latest, error: latestError } = await supabase.from("runecloak_cycles").select("sequence").eq("guild_id", input.guildId).order("sequence", { ascending: false }).limit(1).maybeSingle();
  assertNoDbError(latestError, "get latest Runecloak cycle sequence");
  const { data, error } = await supabase.from("runecloak_cycles").insert({
    guild_id: input.guildId,
    spell_id: spell.id,
    label: normalizedRequired(input.label, 150),
    sequence: (latest?.sequence ?? 0) + 1,
    minimum_roster_size: settings.minimum_roster_size,
    quorum_percent: settings.quorum_percent,
    point_target: settings.point_target,
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
    .in("status", ["Awaiting Moonshadow Start", "Active", "Awaiting GM Approval"])
    .maybeSingle();
  assertNoDbError(error, "get current Runecloak cycle");
  return data ? getRunecloakCycleDetails(data.id) : null;
}

export async function prepareRunecloakCycle(cycleId: string, actorDiscordUserId: string): Promise<unknown> {
  const { data, error } = await supabase.rpc("prepare_runecloak_cycle", {
    cycle_id_input: cycleId,
    actor_discord_user_id_input: actorDiscordUserId
  });
  assertNoDbError(error, "prepare Runecloak cycle");
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
  let details = await getRunecloakCycleDetails(input.cycleId);
  if (details?.cycle.status === "Draft") {
    await prepareRunecloakCycle(input.cycleId, input.actorDiscordUserId);
    details = await getRunecloakCycleDetails(input.cycleId);
  }
  if (!details || details.cycle.status !== "Awaiting Moonshadow Start") {
    throw new UserFacingError("That campaign is not waiting for its study start confirmation.");
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
  euPlannedAt: string | null;
  naPlannedAt: string | null;
  notes: string | null;
  actorDiscordUserId: string;
}): Promise<{ stage: RunecloakStageRow; sessions: RunecloakSessionRow[] }> {
  const cycle = await getRunecloakCycleDetails(input.cycleId);
  if (!cycle || cycle.cycle.status !== "Active") {
    throw new UserFacingError("Paired expeditions may only be opened for an active Runecloak campaign.");
  }
  for (const [slot, plannedAt] of [["EU", input.euPlannedAt], ["NA", input.naPlannedAt]] as const) {
    if (!plannedAt) {
      continue;
    }
    const availableAt = await getRunecloakRegionalSlotAvailableAt(input.guildId, slot);
    if (availableAt && new Date(plannedAt).getTime() < new Date(availableAt).getTime()) {
      throw new UserFacingError(`The ${slot} expedition must be scheduled at or after ${availableAt}; its cooldown is independent from the other regional slot.`);
    }
  }
  const { data: created, error } = await supabase.rpc("create_runecloak_stage", {
    cycle_id_input: cycle.cycle.id,
    title_input: normalizedRequired(input.title, 150),
    theme_input: normalizedRequired(input.theme, 1000),
    eu_planned_at_input: input.euPlannedAt,
    na_planned_at_input: input.naPlannedAt,
    notes_input: normalizedOptional(input.notes, 1800),
    actor_discord_user_id_input: input.actorDiscordUserId
  });
  assertNoDbError(error, "create and open Runecloak paired expedition");
  const createdRecord = created && typeof created === "object" && !Array.isArray(created)
    ? created as Record<string, unknown>
    : null;
  const stageId = typeof createdRecord?.stage_id === "string" ? createdRecord.stage_id : null;
  if (!stageId) {
    throw new Error("Supabase did not return the created Runecloak stage ID.");
  }
  const opened = await getRunecloakStage(stageId);
  if (!opened) {
    throw new Error("The newly opened Runecloak stage could not be reloaded.");
  }
  return { stage: opened.stage, sessions: opened.sessions };
}

export async function getRunecloakRegionalSlotAvailableAt(
  guildId: string,
  regionalSlot: "EU" | "NA",
  excludeSessionId?: string | null
): Promise<string | null> {
  const { data, error } = await supabase.rpc("runecloak_regional_slot_available_at", {
    guild_id_input: guildId,
    regional_slot_input: regionalSlot,
    exclude_session_id_input: excludeSessionId ?? null
  });
  assertNoDbError(error, `check ${regionalSlot} Runecloak cooldown`);
  return typeof data === "string" ? data : null;
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
  const [membershipResult, snapshotResult] = await Promise.all([
    supabase.from("runecloak_memberships").select("*")
      .eq("guild_id", input.guildId).eq("ranger_id", ranger.id).maybeSingle(),
    supabase.from("runecloak_stage_eligible_learners").select("ranger_id")
      .eq("stage_id", stageDetails.stage.id).eq("ranger_id", ranger.id).maybeSingle()
  ]);
  assertNoDbError(membershipResult.error, "check Runecloak membership");
  assertNoDbError(snapshotResult.error, "check Runecloak stage eligibility");
  const activeMembership = membershipResult.data
    && (membershipResult.data.status === "Learner" || membershipResult.data.status === "Qualified");
  const kind = activeMembership && snapshotResult.data ? "learner" : "observer";
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
  let studySpellId = existingRoll?.study_spell_id ?? existingSessionRecord?.study_spell_id ?? null;
  if (kind === "learner" && !studySpellId) {
    const [spells, progressResult] = await Promise.all([
      listRunecloakSpells(),
      supabase.from("runecloak_spell_progress").select("spell_id")
        .eq("ranger_id", ranger.id).eq("status", "completed")
    ]);
    assertNoDbError(progressResult.error, "load completed Runecloak spells");
    studySpellId = earliestRunecloakStudySpell(
      spells,
      new Set((progressResult.data ?? []).map(({ spell_id }) => spell_id)),
      stageDetails.spell.sequence
    )?.id ?? null;
  }
  const roll = kind === "learner"
    ? existingRoll && existingRoll.session_id !== session.id
      ? null
      : input.rollValue ?? existingSessionRecord?.roll_value ?? null
    : null;
  const { data, error } = await supabase.from("runecloak_session_participation").upsert({
    stage_id: stageDetails.stage.id,
    session_id: session.id,
    ranger_id: ranger.id,
    study_spell_id: kind === "learner" ? studySpellId : null,
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
    after: { stage_id: stageDetails.stage.id, slot: input.regionalSlot, kind, roll_value: roll, study_spell_id: studySpellId }
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
  if (!runecloakSessionCanBeSubmitted(session.status)) {
    throw new UserFacingError(`The ${input.regionalSlot} session is already ${session.status.toLowerCase()} and cannot be replaced.`);
  }
  const { data: site, error: siteError } = await supabase.from("runecloak_research_sites").select("id").eq("id", input.siteId).eq("status", "Approved").maybeSingle();
  assertNoDbError(siteError, "check approved Runecloak research site");
  if (!site) {
    throw new UserFacingError("Choose an approved Runecloak research site.");
  }
  const availableAt = await getRunecloakRegionalSlotAvailableAt(input.guildId, input.regionalSlot, session.id);
  if (availableAt && new Date(actualAt).getTime() < new Date(availableAt).getTime()) {
    throw new UserFacingError(
      `The ${input.regionalSlot} expedition is still on cooldown. Its next valid time is ${availableAt}; the other regional slot has its own clock.`
    );
  }
  const { data, error } = await supabase.rpc("submit_runecloak_session", {
    guild_id_input: input.guildId,
    session_id_input: session.id,
    actual_at_input: actualAt,
    research_site_id_input: site.id,
    leader_discord_user_id_input: input.leaderDiscordUserId,
    lesson_summary_input: normalizedRequired(input.lessonSummary, 1800),
    study_method_input: normalizedRequired(input.studyMethod, 1800),
    recording_url_input: input.recordingUrl.trim(),
    moonshadow_reference_input: normalizedOptional(input.moonshadowReference, 1000),
    actor_discord_user_id_input: input.actorDiscordUserId
  });
  assertNoDbError(error, "submit Runecloak session record");
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Supabase did not return the submitted Runecloak session.");
  }
  return data as unknown as RunecloakSessionRow;
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
  const { error } = await supabase.rpc("verify_runecloak_session", {
    session_id_input: session.id,
    actor_discord_user_id_input: input.actorDiscordUserId,
    verification_basis_input: input.basis
  });
  assertNoDbError(error, "verify Runecloak session and participation");
  const refreshed = await getRunecloakStage(input.stageId);
  const verifiedSession = refreshed?.sessions.find(({ id }) => id === session.id);
  if (!verifiedSession) {
    throw new Error("The verified Runecloak session could not be reloaded.");
  }
  return verifiedSession;
}

export async function getRunecloakCycleCompletionPreview(cycleId: string): Promise<RunecloakCompletionPreview> {
  const details = await getRunecloakCycleDetails(cycleId);
  if (!details) {
    throw new UserFacingError("That Runecloak cycle no longer exists.");
  }
  if (details.cycle.status !== "Awaiting GM Approval" || details.cycle.verified_points < details.cycle.point_target) {
    throw new UserFacingError("That cycle has not reached its verified target and cannot record GM approval yet.");
  }
  const validStageIds = details.stages.filter(({ status }) => status === "Valid").map(({ id }) => id);
  if (!validStageIds.length) {
    throw new UserFacingError("That cycle has no valid paired stages.");
  }
  const [settings, memberships] = await Promise.all([
    requireRunecloakSettings(details.cycle.guild_id),
    listRunecloakMemberships(details.cycle.guild_id)
  ]);
  const rangerIds = memberships.map(({ ranger_id }) => ranger_id);
  const [rangersResult, progressResult, prerequisiteResult] = rangerIds.length
    ? await Promise.all([
      supabase.from("rangers").select("*").in("id", rangerIds),
      supabase.from("runecloak_spell_progress").select("*").eq("spell_id", details.spell.id).in("ranger_id", rangerIds),
      details.spell.prerequisite_spell_id
        ? supabase.from("runecloak_spell_progress").select("ranger_id")
          .eq("spell_id", details.spell.prerequisite_spell_id).eq("status", "completed").in("ranger_id", rangerIds)
        : Promise.resolve({ data: rangerIds.map((ranger_id) => ({ ranger_id })), error: null })
    ])
    : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
  assertNoDbError(rangersResult.error, "load Runecloak completion Rangers");
  assertNoDbError(progressResult.error, "load Runecloak personal progress");
  assertNoDbError(prerequisiteResult.error, "load Runecloak personal prerequisites");
  const rangersById = new Map((rangersResult.data ?? []).map((ranger) => [ranger.id, ranger]));
  const progressByRangerId = new Map((progressResult.data ?? []).map((progress) => [progress.ranger_id, progress]));
  const prerequisiteCompleted = new Set((prerequisiteResult.data ?? []).map(({ ranger_id }) => ranger_id));
  const candidates = memberships.flatMap((membership): RunecloakCompletionCandidate[] => {
    const ranger = rangersById.get(membership.ranger_id);
    if (!ranger) {
      return [];
    }
    const progress = progressByRangerId.get(membership.ranger_id);
    const verifiedPoints = progress?.verified_points ?? 0;
    const verifiedStages = progress?.verified_valid_stages ?? 0;
    const requiredPoints = progress?.required_points ?? settings.personal_point_requirement;
    const requiredStages = progress?.required_valid_stages ?? settings.personal_stage_requirement;
    const activeMembership = membership.status === "Learner" || membership.status === "Qualified";
    return [{
      ranger,
      membershipStatus: membership.status,
      verifiedPoints,
      verifiedStages,
      requiredPoints,
      requiredStages,
      eligible: activeMembership
        && ranger.status === "Active"
        && rankAtLeast(ranger.current_rank, "Ranger")
        && progress?.status !== "completed"
        && prerequisiteCompleted.has(membership.ranger_id)
        && runecloakPersonalEligibility({ verifiedPoints, verifiedStages, requiredPoints, requiredStages })
    }];
  });
  return { details, validStageCount: validStageIds.length, candidates };
}

export async function completeRunecloakCycle(input: {
  cycleId: string;
  actorDiscordUserId: string;
  gmApprovalReference: string;
}): Promise<{ unlock_id: string; eligible_learners: number; verified_points: number }> {
  await getRunecloakCycleCompletionPreview(input.cycleId);
  const { data, error } = await supabase.rpc("complete_runecloak_cycle", {
    cycle_id_input: input.cycleId,
    actor_discord_user_id_input: input.actorDiscordUserId,
    gm_approval_reference_input: normalizedRequired(input.gmApprovalReference, 1000)
  });
  assertNoDbError(error, "complete Runecloak cycle");
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Supabase did not return the Runecloak cycle-completion result.");
  }
  return data as { unlock_id: string; eligible_learners: number; verified_points: number };
}

export async function recordRunecloakSpellDelivery(input: {
  guildId: string;
  rangerId: string;
  spellId: string;
  deliveryReference: string;
  actorDiscordUserId: string;
}): Promise<{
  ranger_id: string;
  spell_id: string;
  status: "completed";
  unlock_id: string;
  unlock_reference: string;
  source_cycle_id: string;
  delivery_reference: string;
  newly_completed: boolean;
}> {
  const { data, error } = await supabase.rpc("record_runecloak_spell_delivery", {
    guild_id_input: input.guildId,
    ranger_id_input: input.rangerId,
    spell_id_input: input.spellId,
    delivery_reference_input: normalizedRequired(input.deliveryReference, 1000),
    actor_discord_user_id_input: input.actorDiscordUserId
  });
  assertNoDbError(error, "record Runecloak spell delivery");
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Supabase did not return the Runecloak spell-delivery result.");
  }
  return data as {
    ranger_id: string;
    spell_id: string;
    status: "completed";
    unlock_id: string;
    unlock_reference: string;
    source_cycle_id: string;
    delivery_reference: string;
    newly_completed: boolean;
  };
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
  if (!cycle || !["Awaiting Moonshadow Start", "Active", "Awaiting GM Approval"].includes(cycle.cycle.status)) {
    throw new UserFacingError("Choose an unfinished Runecloak campaign.");
  }
  const { error } = await supabase.rpc("set_runecloak_cycle_member_status", {
    guild_id_input: input.guildId,
    cycle_id_input: input.cycleId,
    ranger_id_input: input.rangerId,
    status_input: input.status,
    reason_input: normalizedRequired(input.reason, 1000),
    actor_discord_user_id_input: input.actorDiscordUserId
  });
  assertNoDbError(error, "update Runecloak campaign member status");
  return [];
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

export async function listRunecloakSpellProgress(rangerId: string, guildId: string): Promise<RunecloakPersonalProgressDetails[]> {
  const [progressResult, spellResult, unlockResult] = await Promise.all([
    supabase.from("runecloak_spell_progress").select("*").eq("ranger_id", rangerId),
    supabase.from("runecloak_spells").select("*").order("sequence"),
    supabase.from("runecloak_spell_unlocks").select("*").eq("guild_id", guildId)
  ]);
  assertNoDbError(progressResult.error, "list Runecloak spell progress");
  assertNoDbError(spellResult.error, "list Runecloak spells");
  assertNoDbError(unlockResult.error, "list shared Runecloak approvals");
  const byId = new Map((spellResult.data ?? []).map((spell) => [spell.id, spell]));
  const unlockBySpellId = new Map((unlockResult.data ?? []).map((unlock) => [unlock.spell_id, unlock]));
  return (progressResult.data ?? []).flatMap((progress) => {
    const spell = byId.get(progress.spell_id);
    return spell ? [{ progress, spell, unlock: unlockBySpellId.get(progress.spell_id) ?? null }] : [];
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

function regionalPreferenceFromAvailability(value: string): "EU" | "NA" | "Flexible" | null {
  const normalized = value.toLocaleUpperCase();
  const mentionsEu = /(^|\W)EU($|\W)/u.test(normalized);
  const mentionsNa = /(^|\W)NA($|\W)/u.test(normalized);
  if (mentionsEu && mentionsNa) {
    return "Flexible";
  }
  return mentionsEu ? "EU" : mentionsNa ? "NA" : null;
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
