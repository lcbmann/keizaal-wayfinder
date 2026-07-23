import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Guild,
  type GuildMember,
  type ModalSubmitInteraction,
  type TextChannel
} from "discord.js";
import { env } from "../config/env.js";
import { roleIdForRank } from "../config/roles.js";
import type { MainRank } from "../config/ranks.js";
import { mainRankFromMember, memberRankAtLeast } from "../utils/permissions.js";
import { UserFacingError } from "../utils/errors.js";
import { emojiEmbed } from "../utils/guildEmojis.js";
import {
  assertNoDbError,
  supabase,
  type FieldNameContestRow,
  type FieldNameContestStatus,
  type FieldNameContestVoteRow,
  type FieldNameOptionRow,
  type FieldNameProposalRow,
  type RangerFieldNameRow,
  type RangerRow
} from "../db/supabase.js";
import { getBotMessageState, getStoredTextChannel, saveBotMessageState } from "./botMessageStateService.js";

const FIELD_NAMES_CHANNEL_STATE_KEY = "field-names-channel";
const FIELD_NAMES_BULLETIN_STATE_KEY = "field-names-bulletin";
const FIELD_NAMES_CHANNEL_NAME = "field-names";
const MAX_OPTIONS = 20;
const FIELD_NAME_ACCESS_RANKS: MainRank[] = ["Ranger", "Ranger Marshal", "Ranger Captain", "Ranger Commander"];

export async function getFieldNamesChannel(guild: Guild): Promise<TextChannel | null> {
  return getStoredTextChannel(guild, FIELD_NAMES_CHANNEL_STATE_KEY);
}

export async function setupFieldNamesChannel(guild: Guild): Promise<TextChannel> {
  const existing = await getFieldNamesChannel(guild);
  const channel = existing ?? await findOrCreateFieldNamesChannel(guild);
  await applyFieldNamePermissions(channel);
  if (!existing) {
    await saveBotMessageState(FIELD_NAMES_CHANNEL_STATE_KEY, channel.id, []);
  }
  await closeLegacyFieldNameProposals();
  await refreshFieldNamesBulletin(guild);
  await refreshOpenFieldNameContestMessages(guild);
  await cleanupResolvedFieldNameProposalMessages(guild);
  await cleanupResolvedFieldNameContestMessages(guild);
  await backfillFieldNameContestVetoNotices(guild);
  return channel;
}

export async function openFieldNameContest(params: {
  guild: Guild;
  nominee: GuildMember;
  opener: GuildMember;
  initialNames: string[];
  reason?: string;
}): Promise<FieldNameContestRow> {
  requireMarshal(params.opener);
  const nomineeRank = mainRankFromMember(params.nominee);
  if (!nomineeRank) {
    throw new UserFacingError("The nominee must be an Apprentice or higher in the Corps.");
  }
  if (params.nominee.id === params.opener.id) {
    throw new UserFacingError("You cannot open a field name contest for yourself.");
  }
  if (await getActiveFieldName(params.nominee.id)) {
    throw new UserFacingError(`${params.nominee.displayName} already has an active field name.`);
  }

  const existing = await getOpenFieldNameContestForTarget(params.nominee.id);
  if (existing) {
    throw new UserFacingError(`${params.nominee.displayName} already has an open field name contest.`);
  }

  const initialNames = uniqueNames(params.initialNames);
  if (initialNames.length > MAX_OPTIONS) {
    throw new UserFacingError(`A field name contest can have no more than ${MAX_OPTIONS} starting options.`);
  }
  const channel = await getFieldNamesChannel(params.guild);
  if (!channel) {
    throw new UserFacingError("The Field Names channel has not been set up. Ask a Marshal to run `/field-name setup` first.");
  }

  const openedAt = new Date();
  const { data: contest, error } = await supabase
    .from("field_name_contests")
    .insert({
      target_discord_user_id: params.nominee.id,
      opened_by_discord_user_id: params.opener.id,
      status: "Open",
      reason: optionalReason(params.reason),
      opened_at: openedAt.toISOString(),
      closes_at: null
    })
    .select("*")
    .single();
  assertNoDbError(error, "create field name contest");

  if (initialNames.length > 0) {
    const { error: optionError } = await supabase.from("field_name_options").insert(initialNames.map((name) => ({
      contest_id: contest.id,
      proposed_name: name,
      reason: "Starting option supplied by the Marshal.",
      nominated_by_discord_user_id: params.opener.id
    })));
    assertNoDbError(optionError, "create starting field name options");
  }

  const message = await channel.send(await fieldNameContestMessagePayload(params.guild, contest.id));
  const thread = await message.startThread({
    name: `Field Name - ${params.nominee.displayName}`.slice(0, 100),
    autoArchiveDuration: 1440,
    reason: "Discuss Ranger field name contest"
  }).catch(() => null);
  if (thread) {
    await thread.send("Discuss the proposed names here. The buttons on the parent post are where Rangers cast their votes.").catch(() => undefined);
  }
  const { data: attached, error: attachError } = await supabase
    .from("field_name_contests")
    .update({ discord_channel_id: channel.id, discord_message_id: message.id, discord_thread_id: thread?.id ?? null })
    .eq("id", contest.id)
    .select("*")
    .single();
  assertNoDbError(attachError, "attach field name contest message");

  await sendFieldNameContestVetoNotice(params.nominee, attached);
  await refreshFieldNamesBulletin(params.guild);
  return attached;
}

export async function suggestFieldNameOption(params: {
  guild: Guild;
  nominee: GuildMember;
  proposer: GuildMember;
  proposedName: string;
  reason: string;
}): Promise<FieldNameOptionRow> {
  requireRanger(params.proposer, "Only a full Ranger or higher may suggest a field name.");
  if (params.nominee.id === params.proposer.id) {
    throw new UserFacingError("You cannot suggest a field name for yourself.");
  }
  const contest = await getOpenFieldNameContestForTarget(params.nominee.id);
  if (!contest) {
    throw new UserFacingError(`There is no open field name contest for ${params.nominee.displayName}.`);
  }
  const optionName = validateFieldName(params.proposedName);
  const reason = params.reason.trim();
  if (!reason) {
    throw new UserFacingError("Give the Rangers a reason for the suggested field name.");
  }
  const options = await listFieldNameOptions(contest.id);
  if (options.length >= MAX_OPTIONS) {
    throw new UserFacingError(`This contest already has the maximum of ${MAX_OPTIONS} name options.`);
  }
  if (options.some((option) => option.proposed_name.toLowerCase() === optionName.toLowerCase())) {
    throw new UserFacingError(`${params.nominee.displayName} already has **${optionName}** as an option.`);
  }

  const { data: option, error } = await supabase
    .from("field_name_options")
    .insert({
      contest_id: contest.id,
      proposed_name: optionName,
      reason,
      nominated_by_discord_user_id: params.proposer.id
    })
    .select("*")
    .single();
  assertNoDbError(error, "suggest field name option");
  await refreshFieldNameContestMessage(params.guild, contest.id);
  await refreshFieldNamesBulletin(params.guild);
  return option;
}

export async function recordFieldNameContestVote(params: {
  guild: Guild;
  contestId: string;
  optionId: string;
  voter: GuildMember;
}): Promise<FieldNameContestVoteRow> {
  const contest = await getFieldNameContest(params.contestId);
  if (!contest || contest.status !== "Open") {
    throw new UserFacingError("That field name contest is no longer open.");
  }
  requireRanger(params.voter, "Only full Rangers may vote on field names. Apprentices cannot view or vote on these contests.");
  const options = await listFieldNameOptions(contest.id);
  if (!options.some((option) => option.id === params.optionId)) {
    throw new UserFacingError("That field name option is not part of this contest.");
  }

  const { data, error } = await supabase
    .from("field_name_contest_votes")
    .upsert({
      contest_id: contest.id,
      option_id: params.optionId,
      voter_discord_user_id: params.voter.id,
      updated_at: new Date().toISOString()
    }, { onConflict: "contest_id,voter_discord_user_id" })
    .select("*")
    .single();
  assertNoDbError(error, "record field name contest vote");
  await refreshFieldNameContestMessage(params.guild, contest.id);
  return data;
}

export async function handleFieldNameButton(interaction: ButtonInteraction): Promise<void> {
  const guild = interaction.guild ?? await interaction.client.guilds.fetch(env.DISCORD_GUILD_ID).catch(() => null);
  if (!guild) {
    throw new UserFacingError("Field name voting is only available in the Ranger Corps server.");
  }

  const parts = interaction.customId.split(":");
  if (parts[1] === "veto") {
    await handleFieldNameContestVeto(interaction, guild, parts[2]);
    return;
  }
  if (parts[1] === "suggest") {
    const contestId = parts[2];
    if (!contestId) {
      throw new UserFacingError("Invalid field name suggestion button.");
    }
    await interaction.showModal(fieldNameSuggestionModal(contestId));
    return;
  }
  if (parts[1] !== "choose") {
    throw new UserFacingError("That field name poll has been retired. Use the current contest post.");
  }
  const contestId = parts[2];
  const optionId = parts[3];
  if (!contestId || !optionId) {
    throw new UserFacingError("Invalid field name option button.");
  }
  const member = await guild.members.fetch(interaction.user.id);
  await interaction.deferUpdate();
  await recordFieldNameContestVote({ guild, contestId, optionId, voter: member });
  await interaction.editReply(await fieldNameContestMessagePayload(guild, contestId));
  await interaction.followUp({ content: "Your field name choice is recorded. You can change it before the contest closes.", ephemeral: true });
}

export async function handleFieldNameSuggestionModal(interaction: ModalSubmitInteraction): Promise<void> {
  const contestId = interaction.customId.split(":")[2];
  if (!contestId) {
    throw new UserFacingError("Invalid field name suggestion form.");
  }
  await interaction.deferReply({ ephemeral: true });
  const contest = await getFieldNameContest(contestId);
  if (!contest || contest.status !== "Open") {
    throw new UserFacingError("That field name contest is no longer open.");
  }
  if (!interaction.guild) {
    throw new UserFacingError("Field name suggestions must be submitted in the Ranger Corps server.");
  }
  const nominee = await interaction.guild.members.fetch(contest.target_discord_user_id).catch(() => null);
  if (!nominee) {
    throw new UserFacingError("The contest nominee is no longer available in this server.");
  }
  const option = await suggestFieldNameOption({
    guild: interaction.guild,
    nominee,
    proposer: await interaction.guild.members.fetch(interaction.user.id),
    proposedName: interaction.fields.getTextInputValue("field-name-option"),
    reason: interaction.fields.getTextInputValue("field-name-reason")
  });
  await interaction.editReply({ content: `**${option.proposed_name}** has been added to the contest.` });
}

export async function listFieldNames(): Promise<RangerFieldNameRow[]> {
  const { data, error } = await supabase
    .from("ranger_field_names")
    .select("*")
    .eq("active", true)
    .order("field_name", { ascending: true });
  assertNoDbError(error, "list field names");
  return data ?? [];
}

export async function removeFieldName(params: {
  discordUserId: string;
  removedReason: string;
}): Promise<boolean> {
  const { data, error } = await supabase
    .from("ranger_field_names")
    .update({ active: false, removed_at: new Date().toISOString(), removed_reason: params.removedReason.trim() || null })
    .eq("discord_user_id", params.discordUserId)
    .eq("active", true)
    .select("id")
    .maybeSingle();
  assertNoDbError(error, "remove field name");
  return Boolean(data);
}

export async function cancelFieldNameContest(params: {
  guild: Guild;
  contestId: string;
  reason: string;
}): Promise<void> {
  const contest = await getFieldNameContest(params.contestId);
  if (!contest || contest.status !== "Open") {
    throw new UserFacingError("That field name contest is not open.");
  }
  await updateContestStatus(contest.id, "Cancelled", params.reason.trim() || "Cancelled by a Marshal.");
  await removeFieldNameContestMessages(params.guild, contest);
  await refreshFieldNamesBulletin(params.guild);
}

export async function closeFieldNameContest(params: {
  guild: Guild;
  contestId: string;
}): Promise<void> {
  const contest = await getFieldNameContest(params.contestId);
  if (!contest || contest.status !== "Open") {
    throw new UserFacingError("That field name contest is not open.");
  }
  await resolveFieldNameContest(params.guild, contest);
}

export async function refreshFieldNamesBulletin(guild: Guild): Promise<void> {
  const channel = await getFieldNamesChannel(guild);
  if (!channel) {
    return;
  }
  const messageState = await getBotMessageState(FIELD_NAMES_BULLETIN_STATE_KEY);
  const prior = messageState?.discord_channel_id === channel.id && messageState.discord_message_ids[0]
    ? await channel.messages.fetch(messageState.discord_message_ids[0]).catch(() => null)
    : null;
  const message = !prior
    ? await channel.send({ embeds: [await fieldNamesBulletinEmbed(guild)] })
    : await prior.edit({ embeds: [await fieldNamesBulletinEmbed(guild)] });
  await saveBotMessageState(FIELD_NAMES_BULLETIN_STATE_KEY, channel.id, [message.id]);
}

export async function refreshOpenFieldNameContestMessages(guild: Guild): Promise<number> {
  const contests = await listOpenFieldNameContests();
  let refreshed = 0;
  for (const contest of contests) {
    await ensureFieldNameContestThread(guild, contest);
    await refreshFieldNameContestMessage(guild, contest.id);
    refreshed += 1;
  }
  return refreshed;
}

export async function cleanupResolvedFieldNameContestMessages(guild: Guild): Promise<number> {
  const { data, error } = await supabase
    .from("field_name_contests")
    .select("*")
    .in("status", ["Approved", "Denied", "Cancelled"])
    .not("discord_message_id", "is", null);
  assertNoDbError(error, "list resolved field name contests for cleanup");
  for (const contest of data ?? []) {
    await removeFieldNameContestMessages(guild, contest);
  }
  return data?.length ?? 0;
}

export async function backfillFieldNameContestVetoNotices(guild: Guild): Promise<number> {
  const { data, error } = await supabase
    .from("field_name_contests")
    .select("*")
    .eq("status", "Open")
    .is("nominee_veto_notified_at", null)
    .order("created_at", { ascending: true });
  assertNoDbError(error, "list field name contest veto notices to backfill");
  let notified = 0;
  for (const contest of data ?? []) {
    const nominee = await guild.members.fetch(contest.target_discord_user_id).catch(() => null);
    if (nominee && await sendFieldNameContestVetoNotice(nominee, contest)) {
      notified += 1;
    }
  }
  return notified;
}

export async function closeLegacyFieldNameProposals(): Promise<number> {
  const { data, error } = await supabase
    .from("field_name_proposals")
    .update({
      status: "Cancelled",
      decided_at: new Date().toISOString(),
      decision_reason: "Closed during the Field Names system migration."
    })
    .eq("status", "Open")
    .select("id");
  assertNoDbError(error, "close legacy field name proposals");
  return data?.length ?? 0;
}

export async function cleanupResolvedFieldNameProposalMessages(guild: Guild): Promise<number> {
  await closeLegacyFieldNameProposals();
  const { data, error } = await supabase
    .from("field_name_proposals")
    .select("*")
    .in("status", ["Approved", "Denied", "Cancelled"])
    .not("discord_message_id", "is", null);
  assertNoDbError(error, "list resolved field name proposals for cleanup");
  for (const proposal of data ?? []) {
    await removeLegacyProposalMessages(guild, proposal);
  }
  return data?.length ?? 0;
}

export async function getActiveFieldName(discordUserId: string): Promise<RangerFieldNameRow | null> {
  const { data, error } = await supabase
    .from("ranger_field_names")
    .select("*")
    .eq("discord_user_id", discordUserId)
    .eq("active", true)
    .maybeSingle();
  assertNoDbError(error, "get field name");
  return data;
}

export async function getActiveFieldNameMap(discordUserIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(discordUserIds)].filter(Boolean);
  if (ids.length === 0) {
    return new Map();
  }
  const { data, error } = await supabase
    .from("ranger_field_names")
    .select("discord_user_id, field_name")
    .in("discord_user_id", ids)
    .eq("active", true);
  assertNoDbError(error, "get field names");
  return new Map((data ?? []).map((entry) => [entry.discord_user_id, entry.field_name]));
}

async function resolveFieldNameContest(guild: Guild, contest: FieldNameContestRow): Promise<void> {
  const options = await listFieldNameOptions(contest.id);
  const votes = await listFieldNameContestVotes(contest.id);
  const counts = options.map((option) => ({ option, votes: votes.filter((vote) => vote.option_id === option.id).length }));
  const highest = counts.length > 0 ? Math.max(...counts.map((entry) => entry.votes)) : 0;
  const leaders = counts.filter((entry) => entry.votes === highest);
  const winner = highest > 0 && leaders.length === 1 ? leaders[0] : null;
  const now = new Date().toISOString();

  if (winner) {
    const { error: deactivateError } = await supabase
      .from("ranger_field_names")
      .update({ active: false, removed_at: now, removed_reason: "Replaced by a newer field name." })
      .eq("discord_user_id", contest.target_discord_user_id)
      .eq("active", true);
    assertNoDbError(deactivateError, "replace previous field name");
    const { error: assignError } = await supabase.from("ranger_field_names").insert({
      discord_user_id: contest.target_discord_user_id,
      field_name: winner.option.proposed_name,
      assigned_by_proposal_id: null,
      assigned_by_contest_id: contest.id,
      active: true,
      removed_at: null,
      removed_reason: null
    });
    assertNoDbError(assignError, "assign field name");
  }

  const decision: FieldNameContestStatus = winner ? "Approved" : "Denied";
  const decisionReason = winner
    ? `${winner.votes} vote${winner.votes === 1 ? "" : "s"}; highest total among the submitted options.`
    : options.length === 0
      ? "No field name options were submitted."
      : highest === 0
        ? "No Rangers voted before the contest closed."
        : "The leading options tied; no field name was assigned.";
  await updateContestStatus(contest.id, decision, decisionReason, now);
  await removeFieldNameContestMessages(guild, contest);
  await refreshFieldNamesBulletin(guild);
}

async function handleFieldNameContestVeto(interaction: ButtonInteraction, guild: Guild, contestId: string | undefined): Promise<void> {
  if (!contestId) {
    throw new UserFacingError("Invalid field name veto button.");
  }
  const contest = await getFieldNameContest(contestId);
  if (!contest || contest.status !== "Open" || contest.target_discord_user_id !== interaction.user.id) {
    throw new UserFacingError("That field name veto is no longer available.");
  }
  await interaction.deferUpdate();
  await updateContestStatus(contest.id, "Denied", "Vetoed by the nominee.");
  await removeFieldNameContestMessages(guild, contest);
  await refreshFieldNamesBulletin(guild);
  await interaction.editReply({ content: "Your veto was recorded. The field name contest has been closed.", components: [] });
}

async function refreshFieldNameContestMessage(guild: Guild, contestId: string): Promise<void> {
  const contest = await getFieldNameContest(contestId);
  if (!contest?.discord_channel_id || !contest.discord_message_id || contest.status !== "Open") {
    return;
  }
  const channel = await guild.channels.fetch(contest.discord_channel_id).catch(() => null);
  if (channel?.type !== ChannelType.GuildText) {
    return;
  }
  const message = await channel.messages.fetch(contest.discord_message_id).catch(() => null);
  await message?.edit(await fieldNameContestMessagePayload(guild, contest.id)).catch(() => undefined);
}

async function ensureFieldNameContestThread(guild: Guild, contest: FieldNameContestRow): Promise<void> {
  if (contest.discord_thread_id || !contest.discord_channel_id || !contest.discord_message_id) {
    return;
  }
  const channel = await guild.channels.fetch(contest.discord_channel_id).catch(() => null);
  if (channel?.type !== ChannelType.GuildText) {
    return;
  }
  const message = await channel.messages.fetch(contest.discord_message_id).catch(() => null);
  if (!message) {
    return;
  }
  const nominee = await guild.members.fetch(contest.target_discord_user_id).catch(() => null);
  const thread = await message.startThread({
    name: `Field Name - ${nominee?.displayName ?? "Contest"}`.slice(0, 100),
    autoArchiveDuration: 1440,
    reason: "Add discussion thread to Field Name contest"
  }).catch(() => null);
  if (!thread) {
    return;
  }
  await thread.send("Discuss the proposed names here. The buttons on the parent post are where Rangers cast their votes.").catch(() => undefined);
  const { error } = await supabase
    .from("field_name_contests")
    .update({ discord_thread_id: thread.id })
    .eq("id", contest.id)
    .eq("status", "Open");
  assertNoDbError(error, "attach field name contest discussion thread");
}

async function fieldNameContestMessagePayload(guild: Guild, contestId: string): Promise<{
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
}> {
  const contest = await getFieldNameContest(contestId);
  if (!contest) {
    throw new UserFacingError("Field name contest not found.");
  }
  const options = await listFieldNameOptions(contest.id);
  const votes = await listFieldNameContestVotes(contest.id);
  const nominee = await guild.members.fetch(contest.target_discord_user_id).catch(() => undefined);
  return {
    embeds: [fieldNameContestEmbed(guild, contest, options, votes, nominee)],
    components: contest.status === "Open" ? optionButtonRows(contest.id, options) : []
  };
}

function fieldNameContestEmbed(
  guild: Guild,
  contest: FieldNameContestRow,
  options: FieldNameOptionRow[],
  votes: FieldNameContestVoteRow[],
  nominee?: GuildMember
): EmbedBuilder {
  const optionText = options.length
    ? options.map((option, index) => {
        const count = votes.filter((vote) => vote.option_id === option.id).length;
        return `**${index + 1}. ${option.proposed_name}** - ${count} vote${count === 1 ? "" : "s"}\n${option.reason}\nNominated by <@${option.nominated_by_discord_user_id}>`;
      }).join("\n\n")
    : "No names have been suggested yet. A Ranger may add the first option with `/field-name suggest`.";
  return emojiEmbed(guild, "teamwork", `Field Name Vote: ${nominee?.displayName ?? `<@${contest.target_discord_user_id}>`}`)
    .setDescription(contest.reason ?? "Choose the field name that best suits this Ranger.")
    .addFields(
      { name: "Nominee", value: nominee ? `${nominee} - ${nominee.displayName}` : `<@${contest.target_discord_user_id}>`, inline: true },
      { name: "Opened by", value: `<@${contest.opened_by_discord_user_id}>`, inline: true },
      { name: "Vote status", value: "Open-ended; a Marshal+ closes it when a clear leader emerges.", inline: true },
      { name: "Name options", value: truncate(optionText), inline: false }
    )
    .setColor(0x587c4a)
    .setFooter({ text: "Ranger+ only: choose one name, including nominees. You may change your choice before the vote closes." })
    .setTimestamp(new Date(contest.opened_at));
}

function optionButtonRows(contestId: string, options: FieldNameOptionRow[]): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let index = 0; index < options.length; index += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const option of options.slice(index, index + 5)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`fieldname:choose:${contestId}:${option.id}`)
          .setLabel(option.proposed_name.slice(0, 80))
          .setStyle(ButtonStyle.Secondary)
      );
    }
    rows.push(row);
  }
  rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`fieldname:suggest:${contestId}`)
      .setLabel("Nominate a name")
      .setStyle(ButtonStyle.Primary)
  ));
  return rows;
}

function fieldNameSuggestionModal(contestId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`fieldname:suggest-submit:${contestId}`)
    .setTitle("Nominate a Field Name")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("field-name-option")
          .setLabel("Suggested field name")
          .setStyle(TextInputStyle.Short)
          .setMinLength(2)
          .setMaxLength(40)
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("field-name-reason")
          .setLabel("Why does it suit them?")
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(1000)
          .setRequired(true)
      )
    );
}

function fieldNameVetoRow(contestId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`fieldname:veto:${contestId}`).setLabel("Veto this contest").setStyle(ButtonStyle.Danger)
  );
}

async function sendFieldNameContestVetoNotice(nominee: GuildMember, contest: FieldNameContestRow): Promise<boolean> {
  const delivered = await nominee.send({
    content: "The Rangers have opened a field name contest for you. If you reject the contest entirely, use the private veto button before it closes.",
    components: [fieldNameVetoRow(contest.id)]
  }).then(() => true).catch(() => false);
  if (!delivered) {
    return false;
  }
  const { error } = await supabase
    .from("field_name_contests")
    .update({ nominee_veto_notified_at: new Date().toISOString() })
    .eq("id", contest.id)
    .eq("status", "Open");
  assertNoDbError(error, "mark field name contest veto notice delivered");
  return true;
}

async function findOrCreateFieldNamesChannel(guild: Guild): Promise<TextChannel> {
  await guild.channels.fetch();
  const named = guild.channels.cache.find((channel) => channel.type === ChannelType.GuildText && channel.name === FIELD_NAMES_CHANNEL_NAME);
  if (named?.type === ChannelType.GuildText) {
    return named;
  }
  return guild.channels.create({
    name: FIELD_NAMES_CHANNEL_NAME,
    type: ChannelType.GuildText,
    parent: env.TRAILMARK_CATEGORY_ID,
    reason: "Create Ranger Field Names channel",
    permissionOverwrites: fieldNamePermissionOverwrites(guild)
  });
}

async function applyFieldNamePermissions(channel: TextChannel): Promise<void> {
  await channel.permissionOverwrites.edit(channel.guild.roles.everyone.id, {
    ViewChannel: false,
    SendMessages: false,
    ReadMessageHistory: false
  });
  for (const rank of FIELD_NAME_ACCESS_RANKS) {
    await channel.permissionOverwrites.edit(roleIdForRank(rank), {
      ViewChannel: true,
      SendMessages: false,
      ReadMessageHistory: true,
      EmbedLinks: true,
      CreatePublicThreads: true,
      SendMessagesInThreads: true
    });
  }
  if (channel.guild.client.user) {
    await channel.permissionOverwrites.edit(channel.guild.client.user.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      ManageMessages: true,
      ManageThreads: true,
      EmbedLinks: true
    });
  }
}

function fieldNamePermissionOverwrites(guild: Guild) {
  const botId = guild.client.user?.id;
  return [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
    },
    ...FIELD_NAME_ACCESS_RANKS.map((rank) => ({
      id: roleIdForRank(rank),
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.CreatePublicThreads,
        PermissionFlagsBits.SendMessagesInThreads
      ]
    })),
    ...(botId ? [{
      id: botId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ManageThreads,
        PermissionFlagsBits.CreatePublicThreads,
        PermissionFlagsBits.EmbedLinks
      ]
    }] : [])
  ];
}

async function fieldNamesBulletinEmbed(guild: Guild): Promise<EmbedBuilder> {
  const [names, contests, fullRangers] = await Promise.all([listFieldNames(), listOpenFieldNameContests(), listFullRangers()]);
  const assignedIds = new Set(names.map((name) => name.discord_user_id));
  const needed = fullRangers.filter((ranger) => !assignedIds.has(ranger.discord_user_id));
  const assignedText = names.length
    ? names.map((name) => `<@${name.discord_user_id}> - **${name.field_name}**`).join("\n")
    : "No field names have been assigned yet.";
  const neededText = needed.length
    ? needed.map((ranger) => `<@${ranger.discord_user_id}> - ${ranger.discord_display_name ?? "Ranger"}`).join("\n")
    : "Every full Ranger currently has a field name.";
  const contestText = contests.length
    ? contests.map((contest) => `<@${contest.target_discord_user_id}> - open-ended; close with /field-name close`).join("\n")
    : "No open contests.";
  return emojiEmbed(guild, "teamwork", "Ranger Field Names")
    .setDescription([
      "Field names are Ranger-assigned names used in the field so members can identify one another without relying on personal names.",
      "A Marshal+ opens one open-ended contest for a Ranger. Rangers may suggest additional options, then each full Ranger chooses one option. A Marshal+ closes the contest when a clear leader emerges; ties or contests with no votes assign nothing.",
      "Field names are optional for Apprentices, but every full Ranger should eventually have an approved name. Nominees may veto a contest privately."
    ].join("\n"))
    .addFields(
      { name: "Assigned", value: truncate(assignedText), inline: false },
      { name: "Full Rangers awaiting a name", value: truncate(neededText), inline: false },
      { name: "Open contests", value: truncate(contestText), inline: false }
    )
    .setColor(0x587c4a)
    .setFooter({ text: "Use /field-name open, /field-name suggest, or /field-name list." })
    .setTimestamp(new Date());
}

async function getFieldNameContest(id: string): Promise<FieldNameContestRow | null> {
  const { data, error } = await supabase.from("field_name_contests").select("*").eq("id", id).maybeSingle();
  assertNoDbError(error, "get field name contest");
  return data;
}

async function getOpenFieldNameContestForTarget(targetId: string): Promise<FieldNameContestRow | null> {
  const { data, error } = await supabase
    .from("field_name_contests")
    .select("*")
    .eq("target_discord_user_id", targetId)
    .eq("status", "Open")
    .maybeSingle();
  assertNoDbError(error, "get open field name contest");
  return data;
}

async function listOpenFieldNameContests(): Promise<FieldNameContestRow[]> {
  const { data, error } = await supabase.from("field_name_contests").select("*").eq("status", "Open").order("closes_at", { ascending: true });
  assertNoDbError(error, "list open field name contests");
  return data ?? [];
}

async function listFieldNameOptions(contestId: string): Promise<FieldNameOptionRow[]> {
  const { data, error } = await supabase.from("field_name_options").select("*").eq("contest_id", contestId).order("created_at", { ascending: true });
  assertNoDbError(error, "list field name options");
  return data ?? [];
}

async function listFieldNameContestVotes(contestId: string): Promise<FieldNameContestVoteRow[]> {
  const { data, error } = await supabase.from("field_name_contest_votes").select("*").eq("contest_id", contestId);
  assertNoDbError(error, "list field name contest votes");
  return data ?? [];
}

async function updateContestStatus(id: string, status: FieldNameContestStatus, reason: string, decidedAt = new Date().toISOString()): Promise<void> {
  const { error } = await supabase
    .from("field_name_contests")
    .update({ status, decided_at: decidedAt, decision_reason: reason })
    .eq("id", id)
    .eq("status", "Open");
  assertNoDbError(error, "update field name contest status");
}

async function removeFieldNameContestMessages(guild: Guild, contest: FieldNameContestRow): Promise<void> {
  if (contest.discord_thread_id) {
    const thread = await guild.channels.fetch(contest.discord_thread_id).catch(() => null);
    if (thread?.isThread()) {
      await thread.delete("Remove resolved Field Name contest discussion thread").catch(() => undefined);
    }
  }
  if (!contest.discord_channel_id || !contest.discord_message_id) {
    return;
  }
  const channel = await guild.channels.fetch(contest.discord_channel_id).catch(() => null);
  if (channel?.type !== ChannelType.GuildText) {
    return;
  }
  const message = await channel.messages.fetch(contest.discord_message_id).catch(() => null);
  await message?.delete().catch(() => undefined);
}

async function removeLegacyProposalMessages(guild: Guild, proposal: FieldNameProposalRow): Promise<void> {
  if (proposal.discord_thread_id) {
    const thread = await guild.channels.fetch(proposal.discord_thread_id).catch(() => null);
    if (thread?.isThread()) {
      await thread.delete("Remove resolved legacy Field Name discussion thread").catch(() => undefined);
    }
  }
  if (!proposal.discord_channel_id || !proposal.discord_message_id) {
    return;
  }
  const channel = await guild.channels.fetch(proposal.discord_channel_id).catch(() => null);
  if (channel?.type !== ChannelType.GuildText) {
    return;
  }
  const message = await channel.messages.fetch(proposal.discord_message_id).catch(() => null);
  await message?.delete().catch(() => undefined);
}

async function listFullRangers(): Promise<RangerRow[]> {
  const { data, error } = await supabase
    .from("rangers")
    .select("*")
    .in("current_rank", ["Ranger Commander", "Ranger Captain", "Ranger Marshal", "Ranger"])
    .neq("status", "Retired")
    .order("discord_display_name", { ascending: true });
  assertNoDbError(error, "list Rangers awaiting field names");
  return data ?? [];
}

function requireRanger(member: GuildMember, message = "Only a full Ranger or higher may use Field Names."): void {
  if (!memberRankAtLeast(member, "Ranger")) {
    throw new UserFacingError(message);
  }
}

function requireMarshal(member: GuildMember): void {
  if (!memberRankAtLeast(member, "Ranger Marshal")) {
    throw new UserFacingError("Ranger Marshal or higher is required for this Field Names command.");
  }
}

function uniqueNames(names: string[]): string[] {
  const result: string[] = [];
  for (const value of names) {
    const name = validateFieldName(value);
    if (!result.some((existing) => existing.toLowerCase() === name.toLowerCase())) {
      result.push(name);
    }
  }
  return result;
}

function validateFieldName(value: string): string {
  const name = value.replace(/\s+/gu, " ").trim();
  if (name.length < 2 || name.length > 40) {
    throw new UserFacingError("A field name must be between 2 and 40 characters.");
  }
  if (/[<>@`\n\r]/u.test(name)) {
    throw new UserFacingError("Field names cannot contain mentions, markup, or line breaks.");
  }
  return name;
}

function optionalReason(value: string | undefined): string | null {
  const reason = value?.trim();
  return reason ? reason : null;
}

function truncate(value: string): string {
  return value.length <= 1024 ? value : `${value.slice(0, 1020).trimEnd()}...`;
}
