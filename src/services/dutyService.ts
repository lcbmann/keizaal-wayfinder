import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  type Guild,
  type GuildMember
} from "discord.js";
import {
  assertNoDbError,
  supabase,
  type CorpsDutyRow,
  type DutyApplicationRow,
  type RangerDutyAssignmentRow,
  type RangerRow
} from "../db/supabase.js";
import { UserFacingError } from "../utils/errors.js";
import { emojiTitle } from "../utils/guildEmojis.js";
import { requireRangerByDiscordId } from "./rangerService.js";
import { postStrongboxThread } from "./strongboxService.js";

export const DUTY_NAMES = ["Quartermaster", "Craftsman", "Warden", "Detective", "Courier"] as const;

export interface DutyApplicationDetails {
  application: DutyApplicationRow;
  duty: CorpsDutyRow;
  applicant: RangerRow;
}

export interface DutyAssignmentDetails {
  assignment: RangerDutyAssignmentRow;
  duty: CorpsDutyRow;
  ranger: RangerRow;
}

export async function listDuties(): Promise<CorpsDutyRow[]> {
  const { data, error } = await supabase
    .from("corps_duties")
    .select("*")
    .eq("active", true)
    .order("name", { ascending: true });
  assertNoDbError(error, "list Corps duties");
  return data ?? [];
}

export async function getDutyByName(name: string): Promise<CorpsDutyRow | null> {
  const { data, error } = await supabase
    .from("corps_duties")
    .select("*")
    .ilike("name", name.trim())
    .eq("active", true)
    .maybeSingle();
  assertNoDbError(error, "get Corps duty");
  return data;
}

export async function setupDutyRoles(guild: Guild): Promise<CorpsDutyRow[]> {
  const duties = await listDuties();
  const updated: CorpsDutyRow[] = [];
  await guild.roles.fetch();

  for (const duty of duties) {
    let role = duty.discord_role_id ? guild.roles.cache.get(duty.discord_role_id) : undefined;
    role ??= guild.roles.cache.find((candidate) => candidate.name.toLocaleLowerCase() === duty.name.toLocaleLowerCase());
    role ??= await guild.roles.create({
      name: duty.name,
      hoist: false,
      mentionable: false,
      reason: "Set up Wayfinder Corps duties"
    });

    const { data, error } = await supabase
      .from("corps_duties")
      .update({ discord_role_id: role.id })
      .eq("id", duty.id)
      .select("*")
      .single();
    assertNoDbError(error, `store ${duty.name} role`);
    updated.push(data);
  }

  return updated;
}

export async function createDutyApplication(params: {
  guild: Guild;
  applicantDiscordUserId: string;
  dutyName: string;
  reason: string;
  assignmentDetail: string | null;
}): Promise<DutyApplicationDetails> {
  const applicant = await requireRangerByDiscordId(params.applicantDiscordUserId);
  if (applicant.status !== "Active") {
    throw new UserFacingError("Only active roster members can volunteer for Corps duties.");
  }

  const duty = await requireDuty(params.dutyName);
  const assignmentDetail = normalizedDetail(duty, params.assignmentDetail);
  await assertNoActiveDutyAssignment(applicant.id, duty.id);

  const { data: existing, error: existingError } = await supabase
    .from("duty_applications")
    .select("id")
    .eq("applicant_ranger_id", applicant.id)
    .eq("duty_id", duty.id)
    .eq("status", "Pending")
    .maybeSingle();
  assertNoDbError(existingError, "check pending duty application");
  if (existing) {
    throw new UserFacingError(`You already have a pending ${duty.name} application.`);
  }

  const { data: application, error } = await supabase
    .from("duty_applications")
    .insert({
      duty_id: duty.id,
      applicant_ranger_id: applicant.id,
      status: "Pending",
      reason: params.reason,
      assignment_detail: assignmentDetail,
      reviewed_by_discord_user_id: null,
      reviewed_at: null,
      strongbox_channel_id: null,
      strongbox_message_id: null,
      strongbox_thread_id: null
    })
    .select("*")
    .single();
  assertNoDbError(error, "create duty application");

  try {
    const entry = await postStrongboxThread({
      guild: params.guild,
      threadName: `Duty - ${duty.name} - ${displayName(applicant)}`,
      embed: dutyApplicationEmbed(params.guild, { application, duty, applicant }),
      components: [dutyApplicationActionRow(application.id)],
      reason: `${duty.name} application from ${displayName(applicant)}`
    });
    const { data: attached, error: attachError } = await supabase
      .from("duty_applications")
      .update({
        strongbox_channel_id: entry.channel.id,
        strongbox_message_id: entry.message.id,
        strongbox_thread_id: entry.thread.id
      })
      .eq("id", application.id)
      .select("*")
      .single();
    assertNoDbError(attachError, "attach duty application Strongbox thread");
    return { application: attached, duty, applicant };
  } catch (error) {
    await supabase.from("duty_applications").delete().eq("id", application.id);
    throw error;
  }
}

export async function getDutyApplicationDetails(applicationId: string): Promise<DutyApplicationDetails | null> {
  const { data: application, error } = await supabase
    .from("duty_applications")
    .select("*")
    .eq("id", applicationId)
    .maybeSingle();
  assertNoDbError(error, "get duty application");
  if (!application) {
    return null;
  }

  const [dutyResult, rangerResult] = await Promise.all([
    supabase.from("corps_duties").select("*").eq("id", application.duty_id).single(),
    supabase.from("rangers").select("*").eq("id", application.applicant_ranger_id).single()
  ]);
  assertNoDbError(dutyResult.error, "get application duty");
  assertNoDbError(rangerResult.error, "get duty applicant");
  return { application, duty: dutyResult.data, applicant: rangerResult.data };
}

export async function reviewDutyApplication(params: {
  guild: Guild;
  applicationId: string;
  reviewerDiscordUserId: string;
  approve: boolean;
}): Promise<DutyApplicationDetails> {
  const details = await getDutyApplicationDetails(params.applicationId);
  if (!details) {
    throw new UserFacingError("That duty application no longer exists.");
  }
  if (details.application.status !== "Pending") {
    throw new UserFacingError(`That duty application is already ${details.application.status.toLocaleLowerCase()}.`);
  }

  if (params.approve) {
    await assignDuty({
      guild: params.guild,
      rangerDiscordUserId: details.applicant.discord_user_id,
      dutyName: details.duty.name,
      assignmentDetail: details.application.assignment_detail,
      assignedByDiscordUserId: params.reviewerDiscordUserId,
      applicationId: details.application.id
    });
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("duty_applications")
    .update({
      status: params.approve ? "Approved" : "Denied",
      reviewed_by_discord_user_id: params.reviewerDiscordUserId,
      reviewed_at: now
    })
    .eq("id", details.application.id)
    .eq("status", "Pending")
    .select("*")
    .single();
  assertNoDbError(error, "review duty application");
  return { ...details, application: data };
}

export async function withdrawDutyApplication(params: {
  guild: Guild;
  discordUserId: string;
  dutyName: string;
}): Promise<DutyApplicationDetails | null> {
  const ranger = await requireRangerByDiscordId(params.discordUserId);
  const duty = await requireDuty(params.dutyName);
  const { data: existing, error: existingError } = await supabase
    .from("duty_applications")
    .select("*")
    .eq("applicant_ranger_id", ranger.id)
    .eq("duty_id", duty.id)
    .eq("status", "Pending")
    .maybeSingle();
  assertNoDbError(existingError, "get pending duty application");
  if (!existing) {
    return null;
  }

  const { data, error } = await supabase
    .from("duty_applications")
    .update({ status: "Withdrawn" })
    .eq("id", existing.id)
    .eq("status", "Pending")
    .select("*")
    .single();
  assertNoDbError(error, "withdraw duty application");
  const details = { application: data, duty, applicant: ranger };

  if (data.strongbox_channel_id && data.strongbox_message_id) {
    const channel = await params.guild.channels.fetch(data.strongbox_channel_id).catch(() => null);
    if (channel?.type === ChannelType.GuildText) {
      const message = await channel.messages.fetch(data.strongbox_message_id).catch(() => null);
      await message?.edit({
        embeds: [dutyApplicationEmbed(params.guild, details)],
        components: [dutyApplicationActionRow(data.id, true)]
      });
    }
  }
  if (data.strongbox_thread_id) {
    const thread = await params.guild.channels.fetch(data.strongbox_thread_id).catch(() => null);
    if (thread?.isThread()) {
      await thread.send(`<@${params.discordUserId}> withdrew this application.`);
    }
  }
  return details;
}

export async function assignDuty(params: {
  guild: Guild;
  rangerDiscordUserId: string;
  dutyName: string;
  assignmentDetail: string | null;
  assignedByDiscordUserId: string;
  applicationId?: string | null;
}): Promise<DutyAssignmentDetails> {
  const duty = await requireDuty(params.dutyName);
  if (!duty.discord_role_id) {
    throw new UserFacingError("Duty roles have not been set up. Ask a Marshal to run `/duty setup`.");
  }
  const ranger = await requireRangerByDiscordId(params.rangerDiscordUserId);
  if (ranger.status !== "Active") {
    throw new UserFacingError("Only active roster members can be assigned Corps duties.");
  }
  const detail = normalizedDetail(duty, params.assignmentDetail);
  await assertNoActiveDutyAssignment(ranger.id, duty.id);
  await assertDutyCapacity(duty);

  const member = await params.guild.members.fetch(ranger.discord_user_id).catch(() => null);
  if (!member) {
    throw new UserFacingError("That Ranger is no longer in the Discord server.");
  }

  const { data: assignment, error } = await supabase
    .from("ranger_duty_assignments")
    .insert({
      duty_id: duty.id,
      ranger_id: ranger.id,
      application_id: params.applicationId ?? null,
      status: "Active",
      assignment_detail: detail,
      assigned_by_discord_user_id: params.assignedByDiscordUserId,
      started_at: new Date().toISOString(),
      ended_at: null,
      end_reason: null
    })
    .select("*")
    .single();
  assertNoDbError(error, "assign Corps duty");

  try {
    await member.roles.add(duty.discord_role_id, `Assigned ${duty.name} by ${params.assignedByDiscordUserId}`);
  } catch (error) {
    await supabase.from("ranger_duty_assignments").delete().eq("id", assignment.id);
    throw error;
  }

  return { assignment, duty, ranger };
}

export async function ensureWardenDutyForHold(params: {
  guild: Guild;
  rangerDiscordUserId: string;
  hold: string;
  assignedByDiscordUserId: string;
}): Promise<DutyAssignmentDetails> {
  const duty = await requireDuty("Warden");
  if (!duty.discord_role_id) {
    throw new UserFacingError("Duty roles have not been set up. Ask a Marshal to run `/duty setup`.");
  }
  const ranger = await requireRangerByDiscordId(params.rangerDiscordUserId);
  const { data: existing, error: existingError } = await supabase
    .from("ranger_duty_assignments")
    .select("*")
    .eq("duty_id", duty.id)
    .eq("ranger_id", ranger.id)
    .eq("status", "Active")
    .maybeSingle();
  assertNoDbError(existingError, "get existing Warden assignment");

  if (!existing) {
    return assignDuty({
      guild: params.guild,
      rangerDiscordUserId: params.rangerDiscordUserId,
      dutyName: duty.name,
      assignmentDetail: params.hold,
      assignedByDiscordUserId: params.assignedByDiscordUserId
    });
  }

  const { data: assignment, error } = await supabase
    .from("ranger_duty_assignments")
    .update({ assignment_detail: params.hold })
    .eq("id", existing.id)
    .select("*")
    .single();
  assertNoDbError(error, "update Warden hold assignment");

  const member = await params.guild.members.fetch(ranger.discord_user_id).catch(() => null);
  if (!member) {
    throw new UserFacingError("That Ranger is no longer in the Discord server.");
  }
  if (!member.roles.cache.has(duty.discord_role_id)) {
    await member.roles.add(duty.discord_role_id, `Assigned Warden through hold assignment by ${params.assignedByDiscordUserId}`);
  }
  return { assignment, duty, ranger };
}

export async function syncHoldWardenAssignments(params: {
  guild: Guild;
  rangers: RangerRow[];
  assignedByDiscordUserId: string;
}): Promise<{ synced: number; skipped: number }> {
  let synced = 0;
  let skipped = 0;
  for (const ranger of params.rangers) {
    if (!ranger.assigned_hold) {
      continue;
    }
    try {
      await ensureWardenDutyForHold({
        guild: params.guild,
        rangerDiscordUserId: ranger.discord_user_id,
        hold: ranger.assigned_hold,
        assignedByDiscordUserId: params.assignedByDiscordUserId
      });
      synced += 1;
    } catch (error) {
      skipped += 1;
      console.warn(`Could not sync Warden duty for ${ranger.discord_user_id}:`, error);
    }
  }
  return { synced, skipped };
}

export async function removeDuty(params: {
  guild: Guild;
  rangerDiscordUserId: string;
  dutyName: string;
  removedByDiscordUserId: string;
  reason: string | null;
}): Promise<DutyAssignmentDetails | null> {
  const duty = await requireDuty(params.dutyName);
  const ranger = await requireRangerByDiscordId(params.rangerDiscordUserId);
  if (duty.name === "Warden" && ranger.assigned_hold) {
    throw new UserFacingError(`Clear ${ranger.assigned_hold} as this Ranger's assigned hold before removing the Warden duty.`);
  }
  const { data: assignment, error: assignmentError } = await supabase
    .from("ranger_duty_assignments")
    .select("*")
    .eq("duty_id", duty.id)
    .eq("ranger_id", ranger.id)
    .eq("status", "Active")
    .maybeSingle();
  assertNoDbError(assignmentError, "get active duty assignment");
  if (!assignment) {
    return null;
  }

  const { data: ended, error } = await supabase
    .from("ranger_duty_assignments")
    .update({
      status: "Ended",
      ended_at: new Date().toISOString(),
      end_reason: params.reason ?? `Removed by ${params.removedByDiscordUserId}`
    })
    .eq("id", assignment.id)
    .select("*")
    .single();
  assertNoDbError(error, "end duty assignment");

  if (duty.discord_role_id) {
    const member = await params.guild.members.fetch(ranger.discord_user_id).catch(() => null);
    if (member?.roles.cache.has(duty.discord_role_id)) {
      await member.roles.remove(duty.discord_role_id, params.reason ?? `Removed by ${params.removedByDiscordUserId}`);
    }
  }
  return { assignment: ended, duty, ranger };
}

export async function listActiveDutyAssignments(dutyName?: string): Promise<DutyAssignmentDetails[]> {
  const duty = dutyName ? await requireDuty(dutyName) : null;
  let query = supabase.from("ranger_duty_assignments").select("*").eq("status", "Active");
  if (duty) {
    query = query.eq("duty_id", duty.id);
  }
  const { data, error } = await query.order("started_at", { ascending: true });
  assertNoDbError(error, "list duty assignments");

  const duties = new Map((await listDuties()).map((entry) => [entry.id, entry]));
  const results: DutyAssignmentDetails[] = [];
  for (const assignment of data ?? []) {
    const assignedDuty = duties.get(assignment.duty_id);
    if (!assignedDuty) {
      continue;
    }
    const { data: ranger, error: rangerError } = await supabase
      .from("rangers")
      .select("*")
      .eq("id", assignment.ranger_id)
      .single();
    assertNoDbError(rangerError, "get assigned Ranger");
    results.push({ assignment, duty: assignedDuty, ranger });
  }
  return results;
}

export async function listPendingDutyApplications(): Promise<DutyApplicationDetails[]> {
  const { data, error } = await supabase
    .from("duty_applications")
    .select("*")
    .eq("status", "Pending")
    .order("created_at", { ascending: true });
  assertNoDbError(error, "list pending duty applications");
  const results: DutyApplicationDetails[] = [];
  for (const application of data ?? []) {
    const details = await getDutyApplicationDetails(application.id);
    if (details) {
      results.push(details);
    }
  }
  return results;
}

export function dutyApplicationActionRow(applicationId: string, disabled = false): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`duty:review:${applicationId}:approve`)
      .setLabel("Approve")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`duty:review:${applicationId}:deny`)
      .setLabel("Deny")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );
}

export function dutyApplicationEmbed(guild: Guild, details: DutyApplicationDetails): EmbedBuilder {
  const { application, duty, applicant } = details;
  const embed = new EmbedBuilder()
    .setTitle(emojiTitle(guild, "duty", `Duty Application: ${duty.name}`))
    .setDescription(application.reason)
    .addFields(
      { name: "Applicant", value: `<@${applicant.discord_user_id}>`, inline: true },
      { name: "Current rank", value: applicant.current_rank, inline: true },
      { name: "Status", value: application.status, inline: true }
    )
    .setColor(application.status === "Approved" ? 0x3ba55d : application.status === "Denied" ? 0xed4245 : 0x587c4a)
    .setTimestamp(new Date(application.created_at));
  if (application.assignment_detail) {
    embed.addFields({ name: duty.requires_detail ? "Range" : "Details", value: application.assignment_detail });
  }
  if (application.reviewed_by_discord_user_id) {
    embed.addFields({ name: "Reviewed by", value: `<@${application.reviewed_by_discord_user_id}>`, inline: true });
  }
  return embed;
}

async function requireDuty(name: string): Promise<CorpsDutyRow> {
  const duty = await getDutyByName(name);
  if (!duty) {
    throw new UserFacingError("That Corps duty was not found.");
  }
  return duty;
}

function normalizedDetail(duty: CorpsDutyRow, value: string | null): string | null {
  const detail = value?.trim() || null;
  if (duty.requires_detail && !detail) {
    throw new UserFacingError(`${duty.name} requires an assigned Range.`);
  }
  return detail;
}

async function assertNoActiveDutyAssignment(rangerId: string, dutyId: string): Promise<void> {
  const { data, error } = await supabase
    .from("ranger_duty_assignments")
    .select("id")
    .eq("ranger_id", rangerId)
    .eq("duty_id", dutyId)
    .eq("status", "Active")
    .maybeSingle();
  assertNoDbError(error, "check active duty assignment");
  if (data) {
    throw new UserFacingError("That Ranger already holds this duty.");
  }
}

async function assertDutyCapacity(duty: CorpsDutyRow): Promise<void> {
  if (!duty.max_active_holders) {
    return;
  }
  const { count, error } = await supabase
    .from("ranger_duty_assignments")
    .select("id", { count: "exact", head: true })
    .eq("duty_id", duty.id)
    .eq("status", "Active");
  assertNoDbError(error, "check duty capacity");
  if ((count ?? 0) >= duty.max_active_holders) {
    throw new UserFacingError(`${duty.name} already has its maximum number of active holders.`);
  }
}

function displayName(ranger: RangerRow): string {
  return ranger.discord_display_name ?? ranger.in_game_name ?? ranger.discord_username ?? "Ranger";
}

export function memberDisplay(member: GuildMember): string {
  return `<@${member.id}> (${member.displayName})`;
}
