import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ThreadAutoArchiveDuration,
  type Guild,
  type GuildMember,
  type Message,
  type TextChannel
} from "discord.js";
import { isHold } from "../config/holds.js";
import { rankAtLeast, type MainRank } from "../config/ranks.js";
import {
  assertNoDbError,
  supabase,
  type CorpsApplicationKind,
  type CorpsDutyRow,
  type DutyApplicationRow,
  type Json,
  type RangerRow,
  type WardenScope
} from "../db/supabase.js";
import { UserFacingError } from "../utils/errors.js";
import { dutyEmojiName, emojiEmbed, rankEmojiName } from "../utils/guildEmojis.js";
import { memberRankAtLeast } from "../utils/permissions.js";
import { roleIdForRank } from "../config/roles.js";
import {
  CAPTAIN_APPLICATION_CHANNEL_STATE_KEY,
  leadershipApplicationChannelStateKey,
  MARSHAL_APPLICATION_CHANNEL_STATE_KEY
} from "./applicationChannelState.js";
import { getStoredTextChannel, saveBotMessageState } from "./botMessageStateService.js";
import { assignDuty, getDutyByName } from "./dutyService.js";
import {
  attachPromotionVoteMessage,
  createPromotionVote,
  denyPromotionVote,
  getPromotionVote,
  refreshPromotionVoteMessage
} from "./promotionService.js";
import { requireRangerByDiscordId } from "./rangerService.js";
import { postStrongboxThread } from "./strongboxService.js";

export const APPLICATION_TARGETS = [
  "Quartermaster",
  "Craftsman",
  "Agent",
  "Courier",
  "Ambassador",
  "Hold Warden",
  "Local Warden",
  "Ranger Marshal",
  "Ranger Captain"
] as const;
export type ApplicationTarget = typeof APPLICATION_TARGETS[number];

export interface CorpsApplicationDetails {
  application: DutyApplicationRow;
  applicant: RangerRow;
  duty: CorpsDutyRow | null;
}

export interface ApplicationReviewResult extends CorpsApplicationDetails {
  promotionVoteId: string | null;
}

export interface CorpsApplicationResponse {
  label: string;
  value: string;
}

export function isApplicationTarget(value: string): value is ApplicationTarget {
  return (APPLICATION_TARGETS as readonly string[]).includes(value);
}

export function applicationMinimumRank(target: ApplicationTarget): MainRank {
  if (target === "Ranger Captain") {
    return "Ranger Marshal";
  }
  if (target === "Ranger Marshal" || target === "Hold Warden" || target === "Local Warden"
    || target === "Quartermaster" || target === "Agent" || target === "Ambassador") {
    return "Ranger";
  }
  return "Apprentice";
}

export function applicationReviewMinimumRank(details: CorpsApplicationDetails): MainRank {
  if (details.application.application_kind === "Captain") {
    return "Ranger Commander";
  }
  if (details.application.application_kind === "Marshal" || details.application.warden_scope === "hold_primary") {
    return "Ranger Captain";
  }
  return "Ranger Marshal";
}

export function assertHoldWardenApplicationVacant(hold: string, hasActiveHolder: boolean): void {
  if (hasActiveHolder) {
    throw new UserFacingError(`${hold} already has an appointed Ranger of the Hold and is not accepting Hold Warden applications.`);
  }
}

export async function configureApplicationChannels(params: {
  marshalChannel: TextChannel;
  captainChannel: TextChannel;
}): Promise<void> {
  await Promise.all([
    configureLeadershipVoteChannel(params.marshalChannel, "Ranger Marshal"),
    configureLeadershipVoteChannel(params.captainChannel, "Ranger Captain")
  ]);
  await Promise.all([
    saveBotMessageState(MARSHAL_APPLICATION_CHANNEL_STATE_KEY, params.marshalChannel.id, []),
    saveBotMessageState(CAPTAIN_APPLICATION_CHANNEL_STATE_KEY, params.captainChannel.id, [])
  ]);
}

async function configureLeadershipVoteChannel(channel: TextChannel, minimumRank: "Ranger Marshal" | "Ranger Captain"): Promise<void> {
  await channel.permissionOverwrites.edit(channel.guild.roles.everyone, {
    ViewChannel: false,
    ReadMessageHistory: false
  }, { reason: "Restrict leadership application votes" });
  await channel.permissionOverwrites.edit(roleIdForRank(minimumRank), {
    ViewChannel: true,
    ReadMessageHistory: true,
    SendMessages: false,
    SendMessagesInThreads: true
  }, { reason: `Allow ${minimumRank}+ to review leadership applications` });
  const deniedRanks: MainRank[] = minimumRank === "Ranger Captain"
    ? ["Apprentice", "Ranger", "Ranger Marshal"]
    : ["Apprentice", "Ranger"];
  await Promise.all(deniedRanks.map((rank) => channel.permissionOverwrites.edit(roleIdForRank(rank), {
    ViewChannel: false,
    ReadMessageHistory: false
  }, { reason: `Keep ${rank} below this leadership vote channel` })));
  await channel.permissionOverwrites.edit(channel.guild.client.user.id, {
    ViewChannel: true,
    ReadMessageHistory: true,
    SendMessages: true,
    EmbedLinks: true,
    CreatePublicThreads: true,
    SendMessagesInThreads: true,
    ManageThreads: true
  }, { reason: "Allow Wayfinder to maintain leadership application votes" });
}

export async function createCorpsApplication(params: {
  guild: Guild;
  applicantDiscordUserId: string;
  target: ApplicationTarget;
  reason: string;
  experience: string | null;
  hold: string | null;
  range: string | null;
  assignmentDetail?: string | null;
  responses?: CorpsApplicationResponse[];
}): Promise<CorpsApplicationDetails> {
  const applicant = await requireRangerByDiscordId(params.applicantDiscordUserId);
  if (applicant.status !== "Active") {
    throw new UserFacingError("Only active Corps members can submit applications.");
  }
  const minimumRank = applicationMinimumRank(params.target);
  if (!rankAtLeast(applicant.current_rank, minimumRank)) {
    throw new UserFacingError(`${params.target} applications require ${minimumRank} or higher.`);
  }

  const target = await resolveTarget(params.target, params.hold, params.range, params.assignmentDetail ?? null);
  if (target.wardenScope === "hold_primary" && target.parentHold && target.duty) {
    await assertHoldWardenApplicationAvailable(target.duty.id, target.parentHold);
  }
  await assertNoPendingApplication(applicant.id, target.kind, target.duty?.id ?? null, target.targetRank);

  const { data: application, error } = await supabase
    .from("duty_applications")
    .insert({
      duty_id: target.duty?.id ?? null,
      applicant_ranger_id: applicant.id,
      application_kind: target.kind,
      target_rank: target.targetRank,
      status: "Pending",
      reason: params.reason.trim(),
      experience: params.experience?.trim() || null,
      application_responses: (params.responses ?? []) as unknown as Json,
      assignment_detail: target.assignmentDetail,
      warden_scope: target.wardenScope,
      parent_hold: target.parentHold,
      resulting_promotion_vote_id: null,
      reviewed_by_discord_user_id: null,
      reviewed_at: null,
      strongbox_channel_id: null,
      strongbox_message_id: null,
      strongbox_thread_id: null
    })
    .select("*")
    .single();
  assertNoDbError(error, "create Corps application");
  const details = { application, applicant, duty: target.duty };

  try {
    if (target.kind === "Duty") {
      const entry = await postStrongboxThread({
          guild: params.guild,
          threadName: `${applicationTitle(details)} - ${displayName(applicant)}`,
          embed: corpsApplicationEmbed(params.guild, details),
          components: [corpsApplicationActionRow(application.id)],
          reason: `${applicationTitle(details)} from ${displayName(applicant)}`
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
      assertNoDbError(attachError, "attach Corps application review thread");
      return { ...details, application: attached };
    }

    const vote = await createPromotionVote({
      candidate: applicant,
      targetRank: target.targetRank!,
      openedByDiscordUserId: applicant.discord_user_id
    });
    const { data: linked, error: linkError } = await supabase
      .from("duty_applications")
      .update({ resulting_promotion_vote_id: vote.id })
      .eq("id", application.id)
      .select("*")
      .single();
    assertNoDbError(linkError, "link leadership application promotion vote");
    const linkedDetails = { ...details, application: linked };
    const entry = await postLeadershipApplicationVote(params.guild, linkedDetails, vote);
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
    assertNoDbError(attachError, "attach Corps application review thread");
    return { ...linkedDetails, application: attached };
  } catch (error) {
    const { data: linkedApplication } = await supabase
      .from("duty_applications")
      .select("resulting_promotion_vote_id")
      .eq("id", application.id)
      .maybeSingle();
    if (linkedApplication?.resulting_promotion_vote_id) {
      await supabase.from("promotion_votes").delete().eq("id", linkedApplication.resulting_promotion_vote_id);
    }
    await supabase.from("duty_applications").delete().eq("id", application.id);
    throw error;
  }
}

export async function getCorpsApplicationDetails(applicationId: string): Promise<CorpsApplicationDetails | null> {
  const { data: application, error } = await supabase
    .from("duty_applications")
    .select("*")
    .eq("id", applicationId)
    .maybeSingle();
  assertNoDbError(error, "get Corps application");
  if (!application) {
    return null;
  }
  const { data: applicant, error: applicantError } = await supabase
    .from("rangers")
    .select("*")
    .eq("id", application.applicant_ranger_id)
    .single();
  assertNoDbError(applicantError, "get Corps applicant");
  const duty = application.duty_id ? await getDutyById(application.duty_id) : null;
  return { application, applicant, duty };
}

export async function listPendingCorpsApplications(applicantRangerId?: string): Promise<CorpsApplicationDetails[]> {
  let query = supabase
    .from("duty_applications")
    .select("id")
    .eq("status", "Pending")
    .order("created_at", { ascending: true });
  if (applicantRangerId) {
    query = query.eq("applicant_ranger_id", applicantRangerId);
  }
  const { data, error } = await query.limit(100);
  assertNoDbError(error, "list pending Corps applications");
  const details = await Promise.all((data ?? []).map((row) => getCorpsApplicationDetails(row.id)));
  return details.filter((entry): entry is CorpsApplicationDetails => entry !== null);
}

export async function withdrawCorpsApplication(params: {
  guild: Guild;
  applicationId: string;
  applicantDiscordUserId: string;
}): Promise<CorpsApplicationDetails> {
  const details = await requireApplication(params.applicationId);
  if (details.applicant.discord_user_id !== params.applicantDiscordUserId) {
    throw new UserFacingError("You can only withdraw your own application.");
  }
  if (details.application.status !== "Pending") {
    throw new UserFacingError("That application is no longer pending.");
  }
  const { data, error } = await supabase
    .from("duty_applications")
    .update({ status: "Withdrawn", reviewed_at: new Date().toISOString() })
    .eq("id", details.application.id)
    .eq("status", "Pending")
    .select("*")
    .single();
  assertNoDbError(error, "withdraw Corps application");
  if (details.application.resulting_promotion_vote_id) {
    await denyPromotionVote(details.application.resulting_promotion_vote_id, params.applicantDiscordUserId);
  }
  const updated = { ...details, application: data };
  await refreshApplicationPost(params.guild, updated, true);
  await finishApplicationThread(params.guild, updated, `${displayName(details.applicant)} withdrew this application.`);
  return updated;
}

export async function reviewCorpsApplication(params: {
  guild: Guild;
  applicationId: string;
  reviewer: GuildMember;
  approve: boolean;
}): Promise<ApplicationReviewResult> {
  const details = await requireApplication(params.applicationId);
  if (details.application.status !== "Pending") {
    throw new UserFacingError(`That application is already ${details.application.status.toLocaleLowerCase()}.`);
  }
  const minimumRank = applicationReviewMinimumRank(details);
  if (!memberRankAtLeast(params.reviewer, minimumRank)) {
    throw new UserFacingError(`${minimumRank} or higher is required to review this application.`);
  }

  let promotionVoteId: string | null = null;
  if (params.approve && details.application.application_kind === "Duty") {
    if (!details.duty) {
      throw new UserFacingError("The duty attached to this application no longer exists.");
    }
    await assignDuty({
      guild: params.guild,
      rangerDiscordUserId: details.applicant.discord_user_id,
      dutyName: details.duty.name,
      assignmentDetail: details.application.assignment_detail,
      assignedByDiscordUserId: params.reviewer.id,
      applicationId: details.application.id,
      wardenScope: details.application.warden_scope,
      parentHold: details.application.parent_hold
    });
  } else if (params.approve && details.application.target_rank) {
    const vote = await createPromotionVote({
      candidate: details.applicant,
      targetRank: details.application.target_rank,
      openedByDiscordUserId: params.reviewer.id,
      reason: `Approved ${details.application.application_kind} application: ${details.application.reason}`
    });
    const { error: linkError } = await supabase
      .from("duty_applications")
      .update({ resulting_promotion_vote_id: vote.id })
      .eq("id", details.application.id);
    assertNoDbError(linkError, "link legacy leadership application promotion vote");
    await postLeadershipApplicationVote(params.guild, details, vote);
    promotionVoteId = vote.id;
  }

  const { data, error } = await supabase
    .from("duty_applications")
    .update({
      status: params.approve ? "Approved" : "Denied",
      reviewed_by_discord_user_id: params.reviewer.id,
      reviewed_at: new Date().toISOString(),
      resulting_promotion_vote_id: promotionVoteId
    })
    .eq("id", details.application.id)
    .eq("status", "Pending")
    .select("*")
    .single();
  assertNoDbError(error, "review Corps application");
  const updated = { ...details, application: data, promotionVoteId };
  await refreshApplicationPost(params.guild, updated, true);
  await finishApplicationThread(
    params.guild,
    updated,
    params.approve
      ? promotionVoteId ? `Approved for a promotion vote by ${params.reviewer.displayName}.` : `Approved by ${params.reviewer.displayName}.`
      : `Denied by ${params.reviewer.displayName}.`
  );
  await notifyApplicant(params.guild, details.applicant, params.approve, promotionVoteId).catch(() => undefined);
  return updated;
}

export function corpsApplicationActionRow(applicationId: string, disabled = false): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`application:review:${applicationId}:approve`).setLabel("Approve").setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`application:review:${applicationId}:deny`).setLabel("Deny").setStyle(ButtonStyle.Danger).setDisabled(disabled)
  );
}

export function corpsApplicationEmbed(guild: Guild, details: CorpsApplicationDetails) {
  const title = applicationTitle(details);
  const emojiName = details.duty ? dutyEmojiName(details.duty.name) ?? "duty" : rankEmojiName(details.application.target_rank ?? "Ranger") ?? "promotion";
  const embed = emojiEmbed(guild, emojiName, `${title} Application`)
    .setDescription(details.application.reason)
    .addFields(
      { name: "Applicant", value: `<@${details.applicant.discord_user_id}> - ${displayName(details.applicant)}`, inline: true },
      { name: "Current rank", value: details.applicant.current_rank, inline: true },
      { name: "Status", value: details.application.status, inline: true }
    )
    .setColor(details.application.status === "Approved" ? 0x3ba55d : details.application.status === "Denied" ? 0xed4245 : 0x587c4a)
    .setTimestamp(new Date(details.application.created_at));
  if (details.application.experience) {
    embed.addFields({ name: "Relevant experience", value: details.application.experience.slice(0, 1024) });
  }
  for (const response of applicationResponses(details.application.application_responses)) {
    embed.addFields({ name: response.label.slice(0, 256), value: response.value.slice(0, 1024) });
  }
  if (details.application.warden_scope === "hold_primary") {
    embed.addFields({ name: "Appointment requested", value: `Ranger of ${details.application.parent_hold}` });
  } else if (details.application.warden_scope === "local_range") {
    embed.addFields({ name: "Appointment requested", value: `Warden of ${details.application.assignment_detail} (${details.application.parent_hold})` });
  } else if (details.application.assignment_detail) {
    embed.addFields({ name: "Details", value: details.application.assignment_detail.slice(0, 1024) });
  }
  if (details.application.resulting_promotion_vote_id) {
    embed.addFields({ name: "Leadership vote", value: "Opened in the private leadership channel." });
  }
  return embed;
}

export function applicationTitle(details: CorpsApplicationDetails): string {
  if (details.application.application_kind === "Marshal") {
    return "Ranger Marshal";
  }
  if (details.application.application_kind === "Captain") {
    return "Ranger Captain";
  }
  if (details.application.warden_scope === "hold_primary") {
    return `Ranger of ${details.application.parent_hold}`;
  }
  if (details.application.warden_scope === "local_range") {
    return `Warden of ${details.application.assignment_detail}`;
  }
  return details.duty?.name ?? "Corps Duty";
}

async function resolveTarget(target: ApplicationTarget, hold: string | null, range: string | null, assignmentDetail: string | null): Promise<{
  kind: CorpsApplicationKind;
  duty: CorpsDutyRow | null;
  targetRank: MainRank | null;
  wardenScope: WardenScope | null;
  parentHold: string | null;
  assignmentDetail: string | null;
}> {
  if (target === "Ranger Marshal" || target === "Ranger Captain") {
    return {
      kind: target === "Ranger Marshal" ? "Marshal" : "Captain",
      duty: null,
      targetRank: target,
      wardenScope: null,
      parentHold: null,
      assignmentDetail: null
    };
  }
  const duty = await getDutyByName(target === "Hold Warden" || target === "Local Warden" ? "Warden" : target);
  if (!duty) {
    throw new UserFacingError("That Corps duty is not configured.");
  }
  if (target === "Hold Warden" || target === "Local Warden") {
    if (!hold || !isHold(hold)) {
      throw new UserFacingError("Choose the parent Hold for this Warden application.");
    }
    if (target === "Local Warden" && !range?.trim()) {
      throw new UserFacingError("Local Warden applications require a named town, road, lake, or other Range.");
    }
    return {
      kind: "Duty",
      duty,
      targetRank: null,
      wardenScope: target === "Hold Warden" ? "hold_primary" : "local_range",
      parentHold: hold,
      assignmentDetail: target === "Hold Warden" ? hold : range!.trim()
    };
  }
  return {
    kind: "Duty",
    duty,
    targetRank: null,
    wardenScope: null,
    parentHold: null,
    assignmentDetail: target === "Craftsman" ? assignmentDetail?.trim() || null : null
  };
}

function applicationResponses(value: Json): CorpsApplicationResponse[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (!entry || Array.isArray(entry) || typeof entry !== "object") {
      return [];
    }
    const label = entry.label;
    const responseValue = entry.value;
    return typeof label === "string" && typeof responseValue === "string"
      ? [{ label, value: responseValue }]
      : [];
  });
}

async function postLeadershipApplicationVote(
  guild: Guild,
  details: CorpsApplicationDetails,
  vote: NonNullable<Awaited<ReturnType<typeof getPromotionVote>>>
) {
  if (details.application.application_kind === "Duty") {
    throw new UserFacingError("Duty applications do not use leadership vote channels.");
  }
  const stateKey = leadershipApplicationChannelStateKey(details.application.application_kind);
  const channel = await getStoredTextChannel(guild, stateKey);
  if (!channel) {
    throw new UserFacingError(`The ${details.application.application_kind} vote channel is not configured. A Commander should run \`/application setup\`.`);
  }
  const message = await channel.send(await refreshPromotionVoteMessage(guild, vote.id));
  const thread = await message.startThread({
    name: `${applicationTitle(details)} Vote - ${displayName(details.applicant)}`.slice(0, 100),
    autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    reason: `${applicationTitle(details)} application vote`
  });
  await attachPromotionVoteMessage(vote.id, channel.id, message.id, thread.id);
  for (const content of leadershipApplicationTranscript(details)) {
    await thread.send({ content, allowedMentions: { parse: [] } }).catch((error) => {
      console.warn(`Could not post the full application transcript for ${details.application.id}:`, error);
    });
  }
  return { channel, message, thread };
}

function leadershipApplicationTranscript(details: CorpsApplicationDetails): string[] {
  const sections = [
    `**Full ${applicationTitle(details)} application from ${displayName(details.applicant)}**`,
    `**Motivation**\n${details.application.reason}`,
    ...(details.application.experience ? [`**Relevant experience**\n${details.application.experience}`] : []),
    ...applicationResponses(details.application.application_responses).map((response) =>
      `**${response.label}**\n${response.value}`
    )
  ];
  const chunks: string[] = [];
  let current = "";
  for (const section of sections) {
    if (section.length > 1_900) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let offset = 0; offset < section.length; offset += 1_900) {
        chunks.push(section.slice(offset, offset + 1_900));
      }
      continue;
    }
    const candidate = current ? `${current}\n\n${section}` : section;
    if (candidate.length > 1_900) {
      chunks.push(current);
      current = section;
    } else {
      current = candidate;
    }
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

async function refreshApplicationPost(guild: Guild, details: CorpsApplicationDetails, disabled: boolean): Promise<void> {
  if (!details.application.strongbox_channel_id || !details.application.strongbox_message_id) {
    return;
  }
  const channel = await guild.channels.fetch(details.application.strongbox_channel_id).catch(() => null);
  if (channel?.type !== ChannelType.GuildText) {
    return;
  }
  const message = await channel.messages.fetch(details.application.strongbox_message_id).catch(() => null);
  if (details.application.resulting_promotion_vote_id) {
    await message?.edit(await refreshPromotionVoteMessage(guild, details.application.resulting_promotion_vote_id));
    return;
  }
  await message?.edit({ embeds: [corpsApplicationEmbed(guild, details)], components: [corpsApplicationActionRow(details.application.id, disabled)] });
}

async function finishApplicationThread(guild: Guild, details: CorpsApplicationDetails, message: string): Promise<void> {
  if (!details.application.strongbox_thread_id) {
    return;
  }
  const thread = await guild.channels.fetch(details.application.strongbox_thread_id).catch(() => null);
  if (!thread?.isThread()) {
    return;
  }
  await thread.send(message).catch(() => undefined);
  await thread.setLocked(true, "Application review completed").catch(() => undefined);
  await thread.setArchived(true, "Application review completed").catch(() => undefined);
}

async function requireApplication(id: string): Promise<CorpsApplicationDetails> {
  const details = await getCorpsApplicationDetails(id);
  if (!details) {
    throw new UserFacingError("That application no longer exists.");
  }
  return details;
}

async function assertNoPendingApplication(
  applicantRangerId: string,
  kind: CorpsApplicationKind,
  dutyId: string | null,
  targetRank: MainRank | null
): Promise<void> {
  let query = supabase
    .from("duty_applications")
    .select("id")
    .eq("applicant_ranger_id", applicantRangerId)
    .eq("status", "Pending")
    .eq("application_kind", kind);
  query = dutyId ? query.eq("duty_id", dutyId) : query.eq("target_rank", targetRank);
  const { data, error } = await query.limit(1);
  assertNoDbError(error, "check pending Corps application");
  if (data?.length) {
    throw new UserFacingError("You already have a pending application for that position.");
  }
}

async function assertHoldWardenApplicationAvailable(dutyId: string, hold: string): Promise<void> {
  const { data, error } = await supabase
    .from("ranger_duty_assignments")
    .select("id")
    .eq("duty_id", dutyId)
    .eq("status", "Active")
    .eq("warden_scope", "hold_primary")
    .eq("parent_hold", hold)
    .limit(1);
  assertNoDbError(error, "check Hold Warden application availability");
  assertHoldWardenApplicationVacant(hold, Boolean(data?.length));
}

async function getDutyById(id: string): Promise<CorpsDutyRow | null> {
  const { data, error } = await supabase.from("corps_duties").select("*").eq("id", id).maybeSingle();
  assertNoDbError(error, "get application duty");
  return data;
}

function displayName(ranger: RangerRow): string {
  return ranger.discord_display_name ?? ranger.in_game_name ?? ranger.discord_username ?? "Ranger";
}

async function notifyApplicant(guild: Guild, ranger: RangerRow, approved: boolean, promotionVoteId: string | null): Promise<void> {
  const member = await guild.members.fetch(ranger.discord_user_id).catch(() => null);
  if (!member) {
    return;
  }
  await member.send(
    approved
      ? promotionVoteId
        ? "Your Corps application was approved for consideration. A promotion vote has been opened."
        : "Your Corps duty application was approved and the appointment has been entered on the roster."
      : "Your Corps application was not approved."
  );
}
