import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  type Guild,
  type TextChannel,
  type User
} from "discord.js";
import { env } from "../config/env.js";
import { roleIdForRank } from "../config/roles.js";
import { rankAtLeast } from "../config/ranks.js";
import {
  assertNoDbError,
  supabase,
  type ApprenticeshipPreferenceRow,
  type ApprenticeshipRow,
  type ApprenticeshipSeekingType,
  type RangerRow
} from "../db/supabase.js";
import { UserFacingError } from "../utils/errors.js";
import { syncMemberToRoster, requireRangerByDiscordId } from "./rangerService.js";
import { postStrongboxThread } from "./strongboxService.js";

export interface ApprenticeshipDetails {
  apprenticeship: ApprenticeshipRow;
  mentor: RangerRow;
  apprentice: RangerRow | null;
}

export async function setApprenticeshipPreference(params: {
  guild: Guild;
  discordUserId: string;
  seeking: ApprenticeshipSeekingType;
  note: string | null;
}): Promise<ApprenticeshipPreferenceRow> {
  const ranger = await requireRangerByDiscordId(params.discordUserId);
  assertPreferenceAllowed(ranger, params.seeking);

  const { data: existing, error: existingError } = await supabase
    .from("apprenticeship_preferences")
    .select("*")
    .eq("discord_user_id", params.discordUserId)
    .maybeSingle();
  assertNoDbError(existingError, "get existing apprenticeship preference");

  const { data: preference, error } = await supabase
    .from("apprenticeship_preferences")
    .upsert({
      discord_user_id: params.discordUserId,
      seeking: params.seeking,
      note: params.note,
      notice_channel_id: existing?.notice_channel_id ?? null,
      notice_message_id: existing?.notice_message_id ?? null,
      strongbox_channel_id: existing?.strongbox_channel_id ?? null,
      strongbox_message_id: existing?.strongbox_message_id ?? null,
      strongbox_thread_id: existing?.strongbox_thread_id ?? null
    }, { onConflict: "discord_user_id" })
    .select("*")
    .single();
  assertNoDbError(error, "set apprenticeship preference");

  const notice = await publishApprenticeshipPreference(params.guild, preference, ranger);
  const { data: attached, error: attachError } = await supabase
    .from("apprenticeship_preferences")
    .update({
      notice_channel_id: notice.channel.id,
      notice_message_id: notice.messageId
    })
    .eq("discord_user_id", params.discordUserId)
    .select("*")
    .single();
  assertNoDbError(attachError, "attach apprenticeship notice-board message");

  if (!existing?.notice_message_id && existing?.strongbox_thread_id) {
    await updatePreferenceThread(
      params.guild,
      existing,
      `This matching request is now posted publicly in <#${notice.channel.id}>.`
    );
  }
  return attached;
}

export async function clearApprenticeshipPreference(discordUserId: string, guild?: Guild): Promise<boolean> {
  const { data: existing, error: existingError } = await supabase
    .from("apprenticeship_preferences")
    .select("*")
    .eq("discord_user_id", discordUserId)
    .maybeSingle();
  assertNoDbError(existingError, "get apprenticeship preference");
  if (!existing) {
    return false;
  }
  const { error } = await supabase
    .from("apprenticeship_preferences")
    .delete()
    .eq("discord_user_id", discordUserId);
  assertNoDbError(error, "clear apprenticeship preference");
  await deletePreferenceNotice(guild, existing);
  await updatePreferenceThread(guild, existing, `<@${discordUserId}> withdrew this matching request.`);
  return true;
}

export async function listApprenticeshipPreferences(): Promise<ApprenticeshipPreferenceRow[]> {
  const { data, error } = await supabase
    .from("apprenticeship_preferences")
    .select("*")
    .order("updated_at", { ascending: true });
  assertNoDbError(error, "list apprenticeship preferences");
  return data ?? [];
}

export async function syncApprenticeshipPreferenceNotices(guild: Guild): Promise<number> {
  const preferences = await listApprenticeshipPreferences();
  let synchronized = 0;
  for (const preference of preferences) {
    const ranger = await getRanger(preference.discord_user_id);
    if (!ranger) {
      continue;
    }
    const notice = await publishApprenticeshipPreference(guild, preference, ranger);
    if (preference.notice_channel_id !== notice.channel.id || preference.notice_message_id !== notice.messageId) {
      const { error } = await supabase
        .from("apprenticeship_preferences")
        .update({
          notice_channel_id: notice.channel.id,
          notice_message_id: notice.messageId
        })
        .eq("discord_user_id", preference.discord_user_id);
      assertNoDbError(error, "synchronize apprenticeship notice-board message");
    }
    synchronized += 1;
  }
  return synchronized;
}

export async function proposeApprenticeship(params: {
  guild: Guild;
  proposerDiscordUserId: string;
  otherDiscordUserId: string;
}): Promise<{ apprenticeship: ApprenticeshipRow; recipient: User }> {
  if (params.proposerDiscordUserId === params.otherDiscordUserId) {
    throw new UserFacingError("You cannot propose an apprenticeship to yourself.");
  }
  const [proposer, other] = await Promise.all([
    requireRangerByDiscordId(params.proposerDiscordUserId),
    requireRangerByDiscordId(params.otherDiscordUserId)
  ]);
  const { mentor, apprentice } = identifyPair(proposer, other);
  assertCanMentor(mentor);
  assertIsApprentice(apprentice);
  await assertNoCurrentApprenticeship(apprentice.discord_user_id);

  const { data: apprenticeship, error } = await supabase
    .from("apprenticeships")
    .insert({
      mentor_discord_user_id: mentor.discord_user_id,
      apprentice_discord_user_id: apprentice.discord_user_id,
      status: "Proposed",
      proposed_by_discord_user_id: params.proposerDiscordUserId,
      sponsor_reason: null,
      reviewed_by_discord_user_id: null,
      reviewed_at: null,
      accepted_at: null,
      started_at: null,
      ended_at: null,
      end_reason: null,
      strongbox_channel_id: null,
      strongbox_message_id: null,
      strongbox_thread_id: null
    })
    .select("*")
    .single();
  assertNoDbError(error, "propose apprenticeship");

  const recipientId = params.proposerDiscordUserId === mentor.discord_user_id
    ? apprentice.discord_user_id
    : mentor.discord_user_id;
  const recipient = await params.guild.client.users.fetch(recipientId);
  try {
    await recipient.send({
      embeds: [new EmbedBuilder()
        .setTitle("Apprenticeship Proposal")
        .setDescription(`<@${params.proposerDiscordUserId}> has proposed an apprenticeship pairing.`)
        .addFields(
          { name: "Mentor", value: `<@${mentor.discord_user_id}>`, inline: true },
          { name: "Apprentice", value: `<@${apprentice.discord_user_id}>`, inline: true }
        )
        .setColor(0x587c4a)
        .setTimestamp(new Date())],
      components: [apprenticeshipConsentActionRow(apprenticeship.id)]
    });
  } catch (error) {
    await supabase.from("apprenticeships").delete().eq("id", apprenticeship.id);
    throw new UserFacingError("I could not DM the other member. They may have DMs disabled.");
  }

  return { apprenticeship, recipient };
}

export async function respondToApprenticeshipProposal(params: {
  guild: Guild;
  apprenticeshipId: string;
  respondingDiscordUserId: string;
  accept: boolean;
}): Promise<ApprenticeshipDetails> {
  const details = await requireApprenticeshipDetails(params.apprenticeshipId);
  const row = details.apprenticeship;
  if (row.status !== "Proposed") {
    throw new UserFacingError("That apprenticeship proposal is no longer awaiting a response.");
  }
  const expectedRecipient = row.proposed_by_discord_user_id === row.mentor_discord_user_id
    ? row.apprentice_discord_user_id
    : row.mentor_discord_user_id;
  if (params.respondingDiscordUserId !== expectedRecipient) {
    throw new UserFacingError("Only the member who received this proposal can respond to it.");
  }

  const now = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from("apprenticeships")
    .update(params.accept ? {
      status: "Active",
      accepted_at: now,
      started_at: now
    } : {
      status: "Declined",
      ended_at: now
    })
    .eq("id", row.id)
    .eq("status", "Proposed")
    .select("*")
    .single();
  assertNoDbError(error, "respond to apprenticeship proposal");

  if (params.accept) {
    await clearPairPreferences(row, params.guild);
    const entry = await postApprenticeshipRecord(params.guild, updated, details.mentor, details.apprentice, "Apprenticeship Accepted");
    const { data: attached, error: attachError } = await supabase
      .from("apprenticeships")
      .update({
        strongbox_channel_id: entry.channel.id,
        strongbox_message_id: entry.message.id,
        strongbox_thread_id: entry.thread.id
      })
      .eq("id", row.id)
      .select("*")
      .single();
    assertNoDbError(attachError, "attach apprenticeship Strongbox thread");
    details.apprenticeship = attached;
  } else {
    details.apprenticeship = updated;
  }

  const proposer = await params.guild.client.users.fetch(row.proposed_by_discord_user_id).catch(() => null);
  await proposer?.send(
    params.accept
      ? "Your apprenticeship proposal was accepted."
      : "Your apprenticeship proposal was declined."
  ).catch(() => undefined);
  return { ...details, apprenticeship: details.apprenticeship };
}

export async function sponsorApprentice(params: {
  guild: Guild;
  mentorDiscordUserId: string;
  recruitDiscordUserId: string;
  reason: string;
}): Promise<ApprenticeshipDetails> {
  if (params.mentorDiscordUserId === params.recruitDiscordUserId) {
    throw new UserFacingError("You cannot sponsor yourself.");
  }
  const mentor = await requireRangerByDiscordId(params.mentorDiscordUserId);
  assertCanMentor(mentor);
  const recruitMember = await params.guild.members.fetch(params.recruitDiscordUserId).catch(() => null);
  if (!recruitMember) {
    throw new UserFacingError("The recruit must join the Discord before being sponsored.");
  }
  const existingRanger = await getRanger(params.recruitDiscordUserId);
  if (existingRanger) {
    throw new UserFacingError("That member already has a Ranger roster entry. Use `/apprenticeship propose` instead.");
  }
  await assertNoCurrentApprenticeship(params.recruitDiscordUserId);

  const { data: apprenticeship, error } = await supabase
    .from("apprenticeships")
    .insert({
      mentor_discord_user_id: mentor.discord_user_id,
      apprentice_discord_user_id: params.recruitDiscordUserId,
      status: "Pending Marshal",
      proposed_by_discord_user_id: mentor.discord_user_id,
      sponsor_reason: params.reason,
      reviewed_by_discord_user_id: null,
      reviewed_at: null,
      accepted_at: null,
      started_at: null,
      ended_at: null,
      end_reason: null,
      strongbox_channel_id: null,
      strongbox_message_id: null,
      strongbox_thread_id: null
    })
    .select("*")
    .single();
  assertNoDbError(error, "create apprentice sponsorship");

  const details = { apprenticeship, mentor, apprentice: null };
  try {
    const entry = await postStrongboxThread({
      guild: params.guild,
      threadName: `Apprentice Sponsor - ${recruitMember.displayName}`,
      embed: apprenticeshipReviewEmbed(details),
      components: [apprenticeshipReviewActionRow(apprenticeship.id)],
      reason: `Apprentice sponsorship from ${displayName(mentor)}`
    });
    const { data: attached, error: attachError } = await supabase
      .from("apprenticeships")
      .update({
        strongbox_channel_id: entry.channel.id,
        strongbox_message_id: entry.message.id,
        strongbox_thread_id: entry.thread.id
      })
      .eq("id", apprenticeship.id)
      .select("*")
      .single();
    assertNoDbError(attachError, "attach sponsorship Strongbox thread");
    return { ...details, apprenticeship: attached };
  } catch (error) {
    await supabase.from("apprenticeships").delete().eq("id", apprenticeship.id);
    throw error;
  }
}

export async function reviewApprenticeSponsorship(params: {
  guild: Guild;
  apprenticeshipId: string;
  reviewerDiscordUserId: string;
  approve: boolean;
}): Promise<ApprenticeshipDetails> {
  const details = await requireApprenticeshipDetails(params.apprenticeshipId);
  const row = details.apprenticeship;
  if (row.status !== "Pending Marshal") {
    throw new UserFacingError("That sponsorship is no longer awaiting Marshal review.");
  }

  let apprentice = details.apprentice;
  const now = new Date().toISOString();
  if (params.approve) {
    const member = await params.guild.members.fetch(row.apprentice_discord_user_id).catch(() => null);
    if (!member) {
      throw new UserFacingError("The sponsored recruit is no longer in the Discord server.");
    }
    await member.roles.add(roleIdForRank("Apprentice"), `Apprenticeship sponsorship approved by ${params.reviewerDiscordUserId}`);
    if (member.roles.cache.has(env.GUEST_ROLE_ID)) {
      await member.roles.remove(env.GUEST_ROLE_ID, "Apprenticeship sponsorship approved");
    }
    apprentice = await syncMemberToRoster(member, params.reviewerDiscordUserId);
    if (!apprentice) {
      throw new UserFacingError("The recruit could not be added to the Ranger roster.");
    }
  }

  const { data: updated, error } = await supabase
    .from("apprenticeships")
    .update(params.approve ? {
      status: "Active",
      reviewed_by_discord_user_id: params.reviewerDiscordUserId,
      reviewed_at: now,
      accepted_at: now,
      started_at: now
    } : {
      status: "Declined",
      reviewed_by_discord_user_id: params.reviewerDiscordUserId,
      reviewed_at: now,
      ended_at: now
    })
    .eq("id", row.id)
    .eq("status", "Pending Marshal")
    .select("*")
    .single();
  assertNoDbError(error, "review apprentice sponsorship");
  if (params.approve) {
    await clearPairPreferences(updated, params.guild);
  }
  return { apprenticeship: updated, mentor: details.mentor, apprentice };
}

export async function assignApprenticeship(params: {
  guild: Guild;
  mentorDiscordUserId: string;
  apprenticeDiscordUserId: string;
  assignedByDiscordUserId: string;
}): Promise<ApprenticeshipDetails> {
  const [mentor, apprentice] = await Promise.all([
    requireRangerByDiscordId(params.mentorDiscordUserId),
    requireRangerByDiscordId(params.apprenticeDiscordUserId)
  ]);
  assertCanMentor(mentor);
  assertIsApprentice(apprentice);
  await assertNoCurrentApprenticeship(apprentice.discord_user_id);
  const now = new Date().toISOString();
  const { data: apprenticeship, error } = await supabase
    .from("apprenticeships")
    .insert({
      mentor_discord_user_id: mentor.discord_user_id,
      apprentice_discord_user_id: apprentice.discord_user_id,
      status: "Active",
      proposed_by_discord_user_id: params.assignedByDiscordUserId,
      sponsor_reason: null,
      reviewed_by_discord_user_id: params.assignedByDiscordUserId,
      reviewed_at: now,
      accepted_at: now,
      started_at: now,
      ended_at: null,
      end_reason: null,
      strongbox_channel_id: null,
      strongbox_message_id: null,
      strongbox_thread_id: null
    })
    .select("*")
    .single();
  assertNoDbError(error, "assign apprenticeship");
  await clearPairPreferences(apprenticeship, params.guild);
  const entry = await postApprenticeshipRecord(params.guild, apprenticeship, mentor, apprentice, "Apprenticeship Assigned");
  const { data: attached, error: attachError } = await supabase
    .from("apprenticeships")
    .update({
      strongbox_channel_id: entry.channel.id,
      strongbox_message_id: entry.message.id,
      strongbox_thread_id: entry.thread.id
    })
    .eq("id", apprenticeship.id)
    .select("*")
    .single();
  assertNoDbError(attachError, "attach assigned apprenticeship Strongbox thread");
  return { apprenticeship: attached, mentor, apprentice };
}

export async function endApprenticeship(params: {
  guild: Guild;
  apprenticeDiscordUserId: string;
  endedByDiscordUserId: string;
  reason: string | null;
}): Promise<ApprenticeshipDetails | null> {
  const details = await getCurrentApprenticeship(params.apprenticeDiscordUserId);
  if (!details || details.apprenticeship.status !== "Active") {
    return null;
  }
  const now = new Date().toISOString();
  const { data: ended, error } = await supabase
    .from("apprenticeships")
    .update({
      status: "Ended",
      ended_at: now,
      end_reason: params.reason ?? `Ended by ${params.endedByDiscordUserId}`
    })
    .eq("id", details.apprenticeship.id)
    .eq("status", "Active")
    .select("*")
    .single();
  assertNoDbError(error, "end apprenticeship");

  if (ended.strongbox_thread_id) {
    const thread = await params.guild.channels.fetch(ended.strongbox_thread_id).catch(() => null);
    if (thread?.isThread()) {
      await thread.send(`<@${params.endedByDiscordUserId}> ended this apprenticeship${params.reason ? `: ${params.reason}` : "."}`);
    }
  } else {
    await postApprenticeshipRecord(params.guild, ended, details.mentor, details.apprentice, "Apprenticeship Ended");
  }
  return { ...details, apprenticeship: ended };
}

export async function getCurrentApprenticeship(discordUserId: string): Promise<ApprenticeshipDetails | null> {
  const { data, error } = await supabase
    .from("apprenticeships")
    .select("*")
    .or(`mentor_discord_user_id.eq.${discordUserId},apprentice_discord_user_id.eq.${discordUserId}`)
    .in("status", ["Proposed", "Pending Marshal", "Active"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  assertNoDbError(error, "get current apprenticeship");
  return data ? getApprenticeshipDetails(data) : null;
}

export async function listCurrentApprenticeships(): Promise<ApprenticeshipDetails[]> {
  const { data, error } = await supabase
    .from("apprenticeships")
    .select("*")
    .in("status", ["Proposed", "Pending Marshal", "Active"])
    .order("created_at", { ascending: true });
  assertNoDbError(error, "list current apprenticeships");
  return Promise.all((data ?? []).map(getApprenticeshipDetails));
}

export function apprenticeshipConsentActionRow(apprenticeshipId: string, disabled = false): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`apprenticeship:consent:${apprenticeshipId}:accept`)
      .setLabel("Accept")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`apprenticeship:consent:${apprenticeshipId}:decline`)
      .setLabel("Decline")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );
}

export function apprenticeshipReviewActionRow(apprenticeshipId: string, disabled = false): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`apprenticeship:review:${apprenticeshipId}:approve`)
      .setLabel("Approve")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`apprenticeship:review:${apprenticeshipId}:deny`)
      .setLabel("Deny")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );
}

export function apprenticeshipReviewEmbed(details: ApprenticeshipDetails): EmbedBuilder {
  const row = details.apprenticeship;
  return new EmbedBuilder()
    .setTitle("Apprentice Sponsorship")
    .setDescription(row.sponsor_reason ?? "No sponsorship reason provided.")
    .addFields(
      { name: "Sponsor and mentor", value: `<@${row.mentor_discord_user_id}>`, inline: true },
      { name: "Recruit", value: `<@${row.apprentice_discord_user_id}>`, inline: true },
      { name: "Status", value: row.status, inline: true },
      ...(row.reviewed_by_discord_user_id
        ? [{ name: "Reviewed by", value: `<@${row.reviewed_by_discord_user_id}>`, inline: true }]
        : [])
    )
    .setColor(row.status === "Active" ? 0x3ba55d : row.status === "Declined" ? 0xed4245 : 0x587c4a)
    .setTimestamp(new Date(row.created_at));
}

async function requireApprenticeshipDetails(id: string): Promise<ApprenticeshipDetails> {
  const { data, error } = await supabase.from("apprenticeships").select("*").eq("id", id).maybeSingle();
  assertNoDbError(error, "get apprenticeship");
  if (!data) {
    throw new UserFacingError("That apprenticeship record no longer exists.");
  }
  return getApprenticeshipDetails(data);
}

async function getApprenticeshipDetails(row: ApprenticeshipRow): Promise<ApprenticeshipDetails> {
  const [mentor, apprentice] = await Promise.all([
    getRanger(row.mentor_discord_user_id),
    getRanger(row.apprentice_discord_user_id)
  ]);
  if (!mentor) {
    throw new UserFacingError("The apprenticeship mentor is missing from the Ranger roster.");
  }
  return { apprenticeship: row, mentor, apprentice };
}

async function getRanger(discordUserId: string): Promise<RangerRow | null> {
  const { data, error } = await supabase
    .from("rangers")
    .select("*")
    .eq("discord_user_id", discordUserId)
    .maybeSingle();
  assertNoDbError(error, "get apprenticeship Ranger");
  return data;
}

function identifyPair(first: RangerRow, second: RangerRow): { mentor: RangerRow; apprentice: RangerRow } {
  if (first.current_rank === "Apprentice" && rankAtLeast(second.current_rank, "Ranger")) {
    return { mentor: second, apprentice: first };
  }
  if (second.current_rank === "Apprentice" && rankAtLeast(first.current_rank, "Ranger")) {
    return { mentor: first, apprentice: second };
  }
  throw new UserFacingError("An apprenticeship must pair one Apprentice with one Ranger or higher.");
}

function assertCanMentor(ranger: RangerRow): void {
  if (!rankAtLeast(ranger.current_rank, "Ranger") || ranger.status !== "Active") {
    throw new UserFacingError("Only an active Corps member of Ranger rank or higher can mentor an Apprentice.");
  }
}

function assertIsApprentice(ranger: RangerRow): void {
  if (ranger.current_rank !== "Apprentice" || ranger.status !== "Active") {
    throw new UserFacingError("The assigned Apprentice must have the Apprentice rank and Active status.");
  }
}

function assertPreferenceAllowed(ranger: RangerRow, seeking: ApprenticeshipSeekingType): void {
  if (seeking === "Mentor") {
    assertIsApprentice(ranger);
    return;
  }
  assertCanMentor(ranger);
}

async function assertNoCurrentApprenticeship(apprenticeDiscordUserId: string): Promise<void> {
  const { data, error } = await supabase
    .from("apprenticeships")
    .select("id")
    .eq("apprentice_discord_user_id", apprenticeDiscordUserId)
    .in("status", ["Proposed", "Pending Marshal", "Active"])
    .limit(1)
    .maybeSingle();
  assertNoDbError(error, "check current apprenticeship");
  if (data) {
    throw new UserFacingError("That Apprentice already has a current or pending apprenticeship.");
  }
}

async function clearPairPreferences(
  row: Pick<ApprenticeshipRow, "mentor_discord_user_id" | "apprentice_discord_user_id">,
  guild?: Guild
): Promise<void> {
  const ids = [row.mentor_discord_user_id, row.apprentice_discord_user_id];
  const { data: preferences, error: preferenceError } = await supabase
    .from("apprenticeship_preferences")
    .select("*")
    .in("discord_user_id", ids);
  assertNoDbError(preferenceError, "get paired apprenticeship preferences");
  const { error } = await supabase
    .from("apprenticeship_preferences")
    .delete()
    .in("discord_user_id", ids);
  assertNoDbError(error, "clear paired apprenticeship preferences");
  for (const preference of preferences ?? []) {
    await deletePreferenceNotice(guild, preference);
    await updatePreferenceThread(guild, preference, "This matching request was closed because the member entered an apprenticeship.");
  }
}

async function publishApprenticeshipPreference(
  guild: Guild,
  preference: ApprenticeshipPreferenceRow,
  ranger: RangerRow
): Promise<{ channel: TextChannel; messageId: string }> {
  const channel = await requireNoticeBoardChannel(guild);
  if (preference.notice_channel_id && preference.notice_channel_id !== channel.id) {
    await deletePreferenceNotice(guild, preference);
  }
  const payload = {
    embeds: [new EmbedBuilder()
      .setTitle(preference.seeking === "Mentor" ? "Looking for a Mentor" : "Looking for an Apprentice")
      .setDescription(preference.note ?? "No additional note provided.")
      .addFields(
        { name: "Member", value: `<@${ranger.discord_user_id}>`, inline: true },
        { name: "Current rank", value: ranger.current_rank, inline: true }
      )
      .setColor(0x587c4a)
      .setFooter({ text: "Contact this member if interested. The notice is removed when withdrawn or paired." })
      .setTimestamp(new Date(preference.updated_at))]
  };

  let message = preference.notice_channel_id === channel.id && preference.notice_message_id
    ? await channel.messages.fetch(preference.notice_message_id).catch(() => null)
    : null;
  message = message ? await message.edit(payload) : await channel.send(payload);
  return { channel, messageId: message.id };
}

async function deletePreferenceNotice(guild: Guild | undefined, preference: ApprenticeshipPreferenceRow): Promise<void> {
  if (!guild || !preference.notice_channel_id || !preference.notice_message_id) {
    return;
  }
  const channel = await guild.channels.fetch(preference.notice_channel_id).catch(() => null);
  if (channel?.type !== ChannelType.GuildText) {
    return;
  }
  const message = await channel.messages.fetch(preference.notice_message_id).catch(() => null);
  await message?.delete().catch(() => undefined);
}

async function requireNoticeBoardChannel(guild: Guild): Promise<TextChannel> {
  if (env.NOTICE_BOARD_CHANNEL_ID) {
    const configured = await guild.channels.fetch(env.NOTICE_BOARD_CHANNEL_ID).catch(() => null);
    if (configured?.type === ChannelType.GuildText) {
      return configured;
    }
    throw new UserFacingError("NOTICE_BOARD_CHANNEL_ID does not point to a text channel.");
  }

  await guild.channels.fetch();
  const channel = guild.channels.cache.find((candidate) =>
    candidate.type === ChannelType.GuildText && candidate.name.toLocaleLowerCase().endsWith("notice-board")
  );
  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new UserFacingError("No notice-board channel was found. Configure NOTICE_BOARD_CHANNEL_ID.");
  }
  return channel;
}

async function updatePreferenceThread(
  guild: Guild | undefined,
  preference: ApprenticeshipPreferenceRow,
  message: string
): Promise<void> {
  if (!guild || !preference.strongbox_thread_id) {
    return;
  }
  const thread = await guild.channels.fetch(preference.strongbox_thread_id).catch(() => null);
  if (thread?.isThread()) {
    await thread.send(message).catch(() => undefined);
  }
}

async function postApprenticeshipRecord(
  guild: Guild,
  apprenticeship: ApprenticeshipRow,
  mentor: RangerRow,
  apprentice: RangerRow | null,
  title: string
) {
  return postStrongboxThread({
    guild,
    threadName: `Apprenticeship - ${apprentice ? displayName(apprentice) : apprenticeship.apprentice_discord_user_id}`,
    embed: new EmbedBuilder()
      .setTitle(title)
      .addFields(
        { name: "Mentor", value: `<@${mentor.discord_user_id}>`, inline: true },
        { name: "Apprentice", value: `<@${apprenticeship.apprentice_discord_user_id}>`, inline: true },
        { name: "Status", value: apprenticeship.status, inline: true }
      )
      .setColor(apprenticeship.status === "Active" ? 0x3ba55d : 0x587c4a)
      .setTimestamp(new Date()),
    reason: title
  });
}

function displayName(ranger: RangerRow): string {
  return ranger.discord_display_name ?? ranger.in_game_name ?? ranger.discord_username ?? "Ranger";
}
