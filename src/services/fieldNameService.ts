import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type ButtonInteraction,
  type Guild,
  type GuildMember,
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
  type FieldNameBallotVote,
  type FieldNameBallotRow,
  type FieldNameProposalRow,
  type RangerFieldNameRow,
  type RangerRow
} from "../db/supabase.js";
import { getBotMessageState, getStoredTextChannel, saveBotMessageState } from "./botMessageStateService.js";

const FIELD_NAMES_CHANNEL_STATE_KEY = "field-names-channel";
const FIELD_NAMES_BULLETIN_STATE_KEY = "field-names-bulletin";
const FIELD_NAMES_CHANNEL_NAME = "field-names";
const VOTE_DURATION_MS = 24 * 60 * 60 * 1000;
const FIELD_NAME_ACCESS_RANKS: MainRank[] = ["Ranger", "Ranger Marshal", "Ranger Captain", "Ranger Commander"];

export async function getFieldNamesChannel(guild: Guild): Promise<TextChannel | null> {
  return getStoredTextChannel(guild, FIELD_NAMES_CHANNEL_STATE_KEY);
}

export async function setupFieldNamesChannel(guild: Guild): Promise<TextChannel> {
  const existing = await getFieldNamesChannel(guild);
  if (existing) {
    await applyFieldNamePermissions(existing);
    await refreshFieldNamesBulletin(guild);
    return existing;
  }

  await guild.channels.fetch();
  const named = guild.channels.cache.find((channel) =>
    channel.type === ChannelType.GuildText && channel.name === FIELD_NAMES_CHANNEL_NAME
  );
  const channel = named?.type === ChannelType.GuildText
    ? named
    : await guild.channels.create({
        name: FIELD_NAMES_CHANNEL_NAME,
        type: ChannelType.GuildText,
        parent: env.TRAILMARK_CATEGORY_ID,
        reason: "Create Ranger Field Names channel",
        permissionOverwrites: fieldNamePermissionOverwrites(guild)
      });

  await applyFieldNamePermissions(channel);
  await saveBotMessageState(FIELD_NAMES_CHANNEL_STATE_KEY, channel.id, []);
  await refreshFieldNamesBulletin(guild);
  return channel;
}

export async function nominateFieldName(params: {
  guild: Guild;
  nominee: GuildMember;
  nominator: GuildMember;
  proposedName: string;
  reason: string;
}): Promise<FieldNameProposalRow> {
  requireRanger(params.nominator, "Only a full Ranger or higher may nominate a field name.");
  const nomineeRank = mainRankFromMember(params.nominee);
  if (!nomineeRank) {
    throw new UserFacingError("The nominee must be an Apprentice or higher in the Corps.");
  }
  if (params.nominee.id === params.nominator.id) {
    throw new UserFacingError("You cannot nominate yourself for a field name.");
  }

  const proposedName = validateFieldName(params.proposedName);
  const reason = params.reason.trim();
  if (!reason) {
    throw new UserFacingError("Give the Rangers a reason for the proposed field name.");
  }

  const existingName = await getActiveFieldName(params.nominee.id);
  if (existingName) {
    throw new UserFacingError(`${params.nominee.displayName} already has the field name **${existingName.field_name}**.`);
  }

  const { data: openProposal, error: openError } = await supabase
    .from("field_name_proposals")
    .select("*")
    .eq("target_discord_user_id", params.nominee.id)
    .eq("status", "Open")
    .maybeSingle();
  assertNoDbError(openError, "check open field name proposal");
  if (openProposal) {
    throw new UserFacingError(`${params.nominee.displayName} already has an open field name nomination.`);
  }

  const channel = await getFieldNamesChannel(params.guild);
  if (!channel) {
    throw new UserFacingError("The Field Names channel has not been set up. Ask a Marshal to run `/field-name setup` first.");
  }

  const openedAt = new Date();
  const closesAt = new Date(openedAt.getTime() + VOTE_DURATION_MS);
  const { data: proposal, error } = await supabase
    .from("field_name_proposals")
    .insert({
      target_discord_user_id: params.nominee.id,
      proposed_name: proposedName,
      reason,
      nominated_by_discord_user_id: params.nominator.id,
      status: "Open",
      opened_at: openedAt.toISOString(),
      closes_at: closesAt.toISOString()
    })
    .select("*")
    .single();
  assertNoDbError(error, "create field name proposal");

  const message = await channel.send({
    embeds: [await fieldNameProposalEmbed(params.guild, proposal, params.nominee)],
    components: [fieldNameVoteRow(proposal.id)]
  });
  const thread = await message.startThread({
    name: `Field Name - ${proposedName}`.slice(0, 100),
    autoArchiveDuration: 1440,
    reason: "Discuss Ranger field name nomination"
  });

  const { data: attached, error: attachError } = await supabase
    .from("field_name_proposals")
    .update({
      discord_channel_id: channel.id,
      discord_message_id: message.id,
      discord_thread_id: thread.id
    })
    .eq("id", proposal.id)
    .select("*")
    .single();
  assertNoDbError(attachError, "attach field name proposal message");
  await refreshFieldNamesBulletin(params.guild);
  return attached;
}

export async function recordFieldNameBallot(params: {
  guild: Guild;
  proposalId: string;
  voter: GuildMember;
  vote: FieldNameBallotVote;
}): Promise<FieldNameBallotRow> {
  requireRanger(params.voter, "Only full Rangers may vote on field names. Apprentices cannot view or vote on these nominations.");
  const proposal = await getFieldNameProposal(params.proposalId);
  if (!proposal || proposal.status !== "Open") {
    throw new UserFacingError("That field name vote is no longer open.");
  }
  if (new Date(proposal.closes_at).getTime() <= Date.now()) {
    await resolveFieldNameProposal(params.guild, proposal);
    throw new UserFacingError("That field name vote has reached its closing time.");
  }
  if (proposal.target_discord_user_id === params.voter.id) {
    throw new UserFacingError("You cannot vote on your own field name.");
  }

  const { data, error } = await supabase
    .from("field_name_ballots")
    .upsert({
      proposal_id: proposal.id,
      voter_discord_user_id: params.voter.id,
      vote: params.vote,
      updated_at: new Date().toISOString()
    }, { onConflict: "proposal_id,voter_discord_user_id" })
    .select("*")
    .single();
  assertNoDbError(error, "record field name ballot");
  await refreshFieldNameProposalMessage(params.guild, proposal.id);
  return data;
}

export async function handleFieldNameVoteButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) {
    throw new UserFacingError("Field name voting is only available in the Ranger Corps server.");
  }
  const [, , proposalId, vote] = interaction.customId.split(":");
  if (!proposalId || !isFieldNameBallotVote(vote)) {
    throw new UserFacingError("Invalid field name vote button.");
  }
  const member = await interaction.guild.members.fetch(interaction.user.id);
  await interaction.deferUpdate();
  await recordFieldNameBallot({ guild: interaction.guild, proposalId, voter: member, vote });
  await interaction.editReply(await fieldNameProposalMessagePayload(interaction.guild, proposalId));
  await interaction.followUp({ content: `Your **${voteLabel(vote)}** vote is recorded.`, ephemeral: true });
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

export async function refreshFieldNamesBulletin(guild: Guild): Promise<void> {
  const channel = await getFieldNamesChannel(guild);
  if (!channel) {
    return;
  }
  const messageState = await getBotMessageState(FIELD_NAMES_BULLETIN_STATE_KEY);
  const prior = messageState?.discord_channel_id === channel.id && messageState.discord_message_ids[0]
    ? await channel.messages.fetch(messageState.discord_message_ids[0]).catch(() => null)
    : null;
  const message = prior
    ? await prior.edit({ embeds: [await fieldNamesBulletinEmbed(guild)] })
    : await channel.send({ embeds: [await fieldNamesBulletinEmbed(guild)] });
  if (!message.pinned) {
    await message.pin("Keep current Ranger field names visible").catch(() => undefined);
  }
  await saveBotMessageState(FIELD_NAMES_BULLETIN_STATE_KEY, channel.id, [message.id]);
}

export async function resolveDueFieldNameProposals(guild: Guild): Promise<number> {
  const { data, error } = await supabase
    .from("field_name_proposals")
    .select("*")
    .eq("status", "Open")
    .lte("closes_at", new Date().toISOString())
    .order("closes_at", { ascending: true })
    .limit(25);
  assertNoDbError(error, "list due field name proposals");
  for (const proposal of data ?? []) {
    await resolveFieldNameProposal(guild, proposal);
  }
  return data?.length ?? 0;
}

export async function cancelFieldNameProposal(params: {
  guild: Guild;
  proposalId: string;
  reason: string;
}): Promise<void> {
  const proposal = await getFieldNameProposal(params.proposalId);
  if (!proposal || proposal.status !== "Open") {
    throw new UserFacingError("That field name nomination is not open.");
  }
  const { error } = await supabase
    .from("field_name_proposals")
    .update({
      status: "Cancelled",
      decided_at: new Date().toISOString(),
      decision_reason: params.reason.trim() || "Cancelled by a Marshal."
    })
    .eq("id", proposal.id);
  assertNoDbError(error, "cancel field name proposal");
  await refreshFieldNameProposalMessage(params.guild, proposal.id);
  await refreshFieldNamesBulletin(params.guild);
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

async function resolveFieldNameProposal(guild: Guild, proposal: FieldNameProposalRow): Promise<void> {
  const current = await getFieldNameProposal(proposal.id);
  if (!current || current.status !== "Open") {
    return;
  }
  const ballots = await getFieldNameBallots(current.id);
  const yes = ballots.filter((ballot) => ballot.vote === "yes").length;
  const no = ballots.filter((ballot) => ballot.vote === "no").length;
  const approved = yes > no && yes > 0;
  const decision = approved ? "Approved" : "Denied";

  if (approved) {
    const { error: deactivateError } = await supabase
      .from("ranger_field_names")
      .update({ active: false, removed_at: new Date().toISOString(), removed_reason: "Replaced by a newer field name." })
      .eq("discord_user_id", current.target_discord_user_id)
      .eq("active", true);
    assertNoDbError(deactivateError, "replace previous field name");

    const { error: assignError } = await supabase.from("ranger_field_names").insert({
      discord_user_id: current.target_discord_user_id,
      field_name: current.proposed_name,
      assigned_by_proposal_id: current.id,
      active: true,
      removed_at: null,
      removed_reason: null
    });
    assertNoDbError(assignError, "assign field name");
  }

  const { error } = await supabase
    .from("field_name_proposals")
    .update({
      status: decision,
      decided_at: new Date().toISOString(),
      decision_reason: `${yes} Yes, ${no} No, ${ballots.filter((ballot) => ballot.vote === "abstain").length} Abstain.`
    })
    .eq("id", current.id);
  assertNoDbError(error, "resolve field name proposal");
  await refreshFieldNameProposalMessage(guild, current.id);
  await refreshFieldNamesBulletin(guild);
}

async function fieldNamesBulletinEmbed(guild: Guild): Promise<EmbedBuilder> {
  const [names, openProposals, fullRangers] = await Promise.all([
    listFieldNames(),
    listOpenFieldNameProposals(),
    listFullRangers()
  ]);
  const assignedIds = new Set(names.map((name) => name.discord_user_id));
  const needsName = fullRangers.filter((ranger) => !assignedIds.has(ranger.discord_user_id));
  const assignedText = names.length
    ? names.map((name) => `<@${name.discord_user_id}> - **${name.field_name}**`).join("\n")
    : "No field names have been assigned yet.";
  const neededText = needsName.length
    ? needsName.map((ranger) => `<@${ranger.discord_user_id}> - ${ranger.discord_display_name ?? "Ranger"}`).join("\n")
    : "Every full Ranger currently has a field name.";
  const pendingText = openProposals.length
    ? openProposals.map((proposal) => `**${proposal.proposed_name}** for <@${proposal.target_discord_user_id}> - closes <t:${Math.floor(new Date(proposal.closes_at).getTime() / 1000)}:R>`).join("\n")
    : "No open nominations.";

  return emojiEmbed(guild, "teamwork", "Ranger Field Names")
    .setDescription([
      "Field names are Ranger-assigned names used in the field so members can identify one another without relying on personal names.",
      "Rangers may nominate Apprentices or fellow Rangers, but nobody may nominate themselves. Full Rangers vote on each proposal; Apprentices cannot see or vote on nominations.",
      "Field names are optional for Apprentices, but every full Ranger should eventually have an approved name.",
      "Use `/field-name nominate` to put forward a name. Vote buttons appear in the nomination thread and close after 24 hours."
    ].join("\n"))
    .addFields(
      { name: "Assigned", value: truncate(assignedText), inline: false },
      { name: "Full Rangers awaiting a name", value: truncate(neededText), inline: false },
      { name: "Open nominations", value: truncate(pendingText), inline: false }
    )
    .setColor(0x587c4a)
    .setFooter({ text: "Nominate with /field-name nominate. Votes close after 24 hours." })
    .setTimestamp(new Date());
}

async function fieldNameProposalEmbed(guild: Guild, proposal: FieldNameProposalRow, nominee?: GuildMember): Promise<EmbedBuilder> {
  const ballots = await getFieldNameBallots(proposal.id);
  const tally = tallyText(ballots);
  return emojiEmbed(guild, "teamwork", `Field Name Nomination: ${proposal.proposed_name}`)
    .setDescription(proposal.reason)
    .addFields(
      { name: "Nominee", value: nominee ? `${nominee} - ${nominee.displayName}` : `<@${proposal.target_discord_user_id}>`, inline: true },
      { name: "Nominated by", value: `<@${proposal.nominated_by_discord_user_id}>`, inline: true },
      { name: "Vote closes", value: `<t:${Math.floor(new Date(proposal.closes_at).getTime() / 1000)}:R>`, inline: true },
      { name: "Proposal ID", value: `\`${proposal.id}\``, inline: false },
      { name: "Current tally", value: tally, inline: false }
    )
    .setColor(proposal.status === "Approved" ? 0x3ba55d : proposal.status === "Denied" || proposal.status === "Cancelled" ? 0xed4245 : 0x587c4a)
    .setFooter({ text: proposal.status === "Open" ? "Ranger+ only: vote Yes, No, or Abstain." : `Vote ${proposal.status.toLowerCase()}.` })
    .setTimestamp(new Date(proposal.opened_at));
}

function fieldNameVoteRow(proposalId: string, disabled = false): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`fieldname:vote:${proposalId}:yes`).setLabel("Yes").setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`fieldname:vote:${proposalId}:no`).setLabel("No").setStyle(ButtonStyle.Danger).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`fieldname:vote:${proposalId}:abstain`).setLabel("Abstain").setStyle(ButtonStyle.Secondary).setDisabled(disabled)
  );
}

async function fieldNameProposalMessagePayload(guild: Guild, proposalId: string): Promise<{
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
}> {
  const proposal = await getFieldNameProposal(proposalId);
  if (!proposal) {
    throw new UserFacingError("Field name nomination not found.");
  }
  const nominee = await guild.members.fetch(proposal.target_discord_user_id).catch(() => undefined);
  return {
    embeds: [await fieldNameProposalEmbed(guild, proposal, nominee)],
    components: [fieldNameVoteRow(proposal.id, proposal.status !== "Open")]
  };
}

async function refreshFieldNameProposalMessage(guild: Guild, proposalId: string): Promise<void> {
  const proposal = await getFieldNameProposal(proposalId);
  if (!proposal?.discord_channel_id || !proposal.discord_message_id) {
    return;
  }
  const channel = await guild.channels.fetch(proposal.discord_channel_id).catch(() => null);
  if (channel?.type !== ChannelType.GuildText) {
    return;
  }
  const message = await channel.messages.fetch(proposal.discord_message_id).catch(() => null);
  await message?.edit(await fieldNameProposalMessagePayload(guild, proposalId)).catch(() => undefined);
}

async function getFieldNameProposal(id: string): Promise<FieldNameProposalRow | null> {
  const { data, error } = await supabase.from("field_name_proposals").select("*").eq("id", id).maybeSingle();
  assertNoDbError(error, "get field name proposal");
  return data;
}

async function listOpenFieldNameProposals(): Promise<FieldNameProposalRow[]> {
  const { data, error } = await supabase.from("field_name_proposals").select("*").eq("status", "Open").order("closes_at", { ascending: true });
  assertNoDbError(error, "list open field name proposals");
  return data ?? [];
}

async function getFieldNameBallots(proposalId: string): Promise<FieldNameBallotRow[]> {
  const { data, error } = await supabase.from("field_name_ballots").select("*").eq("proposal_id", proposalId);
  assertNoDbError(error, "get field name ballots");
  return data ?? [];
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

function tallyText(ballots: FieldNameBallotRow[]): string {
  return [
    `Yes: **${ballots.filter((ballot) => ballot.vote === "yes").length}**`,
    `No: **${ballots.filter((ballot) => ballot.vote === "no").length}**`,
    `Abstain: **${ballots.filter((ballot) => ballot.vote === "abstain").length}**`
  ].join(" | ");
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

function requireRanger(member: GuildMember, message: string): void {
  if (!memberRankAtLeast(member, "Ranger")) {
    throw new UserFacingError(message);
  }
}

function isFieldNameBallotVote(value: string | undefined): value is FieldNameBallotVote {
  return value === "yes" || value === "no" || value === "abstain";
}

function voteLabel(vote: FieldNameBallotVote): string {
  return vote === "yes" ? "Yes" : vote === "no" ? "No" : "Abstain";
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
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.CreatePublicThreads,
        PermissionFlagsBits.SendMessagesInThreads
      ]
    })),
    ...(botId
      ? [{
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
        }]
      : [])
  ];
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
      SendMessages: true,
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

function truncate(value: string): string {
  return value.length <= 1024 ? value : `${value.slice(0, 1020).trimEnd()}...`;
}
