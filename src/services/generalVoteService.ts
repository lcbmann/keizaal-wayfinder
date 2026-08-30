import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type Guild,
  type MessageEditOptions
} from "discord.js";
import {
  assertNoDbError,
  supabase,
  type GeneralBallotVote,
  type GeneralVoteBallotRow,
  type GeneralVoteOptionRow,
  type GeneralVoteRow,
  type GeneralVoteType
} from "../db/supabase.js";
import { UserFacingError } from "../utils/errors.js";

export interface GeneralVoteTally {
  yes: number;
  no: number;
  abstain: number;
}

export interface GeneralVoteChoiceInput {
  label: string;
  description: string | null;
}

export interface GeneralChoiceTally {
  options: Array<GeneralVoteOptionRow & { count: number }>;
  abstain: number;
}

export async function createGeneralVote(params: {
  guildId: string;
  channelId: string;
  question: string;
  context: string | null;
  openedByDiscordUserId: string;
  voteType?: GeneralVoteType;
  choices?: GeneralVoteChoiceInput[];
}): Promise<GeneralVoteRow> {
  const voteType = params.voteType ?? "binary";
  const choices = params.choices ?? [];
  if (voteType === "choice" && (choices.length < 2 || choices.length > 10)) {
    throw new UserFacingError("Multiple-choice votes require between 2 and 10 options.");
  }

  const { data, error } = await supabase
    .from("general_votes")
    .insert({
      guild_id: params.guildId,
      channel_id: params.channelId,
      message_id: null,
      thread_id: null,
      question: params.question,
      context: params.context,
      vote_type: voteType,
      status: "Open",
      opened_by_discord_user_id: params.openedByDiscordUserId,
      closed_by_discord_user_id: null
    })
    .select("*")
    .single();

  assertNoDbError(error, "create channel vote");
  if (voteType === "choice") {
    const { error: optionError } = await supabase
      .from("general_vote_options")
      .insert(choices.map((choice, position) => ({
        general_vote_id: data.id,
        label: choice.label,
        description: choice.description,
        position
      })));
    if (optionError) {
      await supabase.from("general_votes").delete().eq("id", data.id);
      assertNoDbError(optionError, "create channel vote options");
    }
  }
  return data;
}

export async function attachGeneralVoteMessage(
  voteId: string,
  messageId: string,
  threadId: string | null
): Promise<void> {
  const { error } = await supabase
    .from("general_votes")
    .update({ message_id: messageId, thread_id: threadId })
    .eq("id", voteId);
  assertNoDbError(error, "attach channel vote message");
}

export async function getGeneralVote(voteId: string): Promise<GeneralVoteRow | null> {
  const { data, error } = await supabase
    .from("general_votes")
    .select("*")
    .eq("id", voteId)
    .maybeSingle();
  assertNoDbError(error, "get channel vote");
  return data;
}

export async function findRecentGeneralVotes(guildId: string, channelId: string): Promise<GeneralVoteRow[]> {
  const { data, error } = await supabase
    .from("general_votes")
    .select("*")
    .eq("guild_id", guildId)
    .eq("channel_id", channelId)
    .order("created_at", { ascending: false })
    .limit(25);
  assertNoDbError(error, "find channel votes");
  return data ?? [];
}

export async function listGeneralVoteOptions(voteId: string): Promise<GeneralVoteOptionRow[]> {
  const { data, error } = await supabase
    .from("general_vote_options")
    .select("*")
    .eq("general_vote_id", voteId)
    .order("position", { ascending: true });
  assertNoDbError(error, "list channel vote options");
  return data ?? [];
}

export async function recordGeneralVoteBallot(params: {
  guild: Guild;
  voteId: string;
  voterDiscordUserId: string;
  interactionChannelId: string;
  ballot: GeneralBallotVote;
}): Promise<void> {
  const vote = await requireOpenVoteForVoter(params);
  if (vote.vote_type !== "binary") {
    throw new UserFacingError("Use the option menu to vote in this poll.");
  }
  await upsertGeneralBallot(vote.id, params.voterDiscordUserId, params.ballot, null);
}

export async function recordGeneralChoiceBallot(params: {
  guild: Guild;
  voteId: string;
  voterDiscordUserId: string;
  interactionChannelId: string;
  optionId: string | null;
}): Promise<string> {
  const vote = await requireOpenVoteForVoter(params);
  if (vote.vote_type !== "choice") {
    throw new UserFacingError("Use the vote buttons for this poll.");
  }
  if (!params.optionId) {
    await upsertGeneralBallot(vote.id, params.voterDiscordUserId, "abstain", null);
    return "Abstain";
  }

  const option = (await listGeneralVoteOptions(vote.id)).find((candidate) => candidate.id === params.optionId);
  if (!option) {
    throw new UserFacingError("That option does not belong to this vote.");
  }
  await upsertGeneralBallot(vote.id, params.voterDiscordUserId, null, option.id);
  return option.label;
}

export async function closeGeneralVote(voteId: string, closedByDiscordUserId: string): Promise<GeneralVoteRow> {
  const vote = await getGeneralVote(voteId);
  if (!vote) {
    throw new UserFacingError("Vote not found.");
  }
  if (vote.status !== "Open") {
    throw new UserFacingError("That vote is already closed.");
  }

  const { data, error } = await supabase
    .from("general_votes")
    .update({
      status: "Closed",
      closed_at: new Date().toISOString(),
      closed_by_discord_user_id: closedByDiscordUserId
    })
    .eq("id", vote.id)
    .eq("status", "Open")
    .select("*")
    .single();
  assertNoDbError(error, "close channel vote");
  return data;
}

export async function listGeneralVoteBallots(voteId: string): Promise<GeneralVoteBallotRow[]> {
  const { data, error } = await supabase
    .from("general_vote_ballots")
    .select("*")
    .eq("general_vote_id", voteId)
    .order("updated_at", { ascending: true });
  assertNoDbError(error, "list channel ballots");
  return data ?? [];
}

export function tallyGeneralVoteBallots(ballots: Pick<GeneralVoteBallotRow, "vote">[]): GeneralVoteTally {
  return ballots.reduce<GeneralVoteTally>((tally, ballot) => {
    if (ballot.vote === "yes" || ballot.vote === "no" || ballot.vote === "abstain") {
      tally[ballot.vote] += 1;
    }
    return tally;
  }, { yes: 0, no: 0, abstain: 0 });
}

export function tallyGeneralChoiceBallots(
  options: GeneralVoteOptionRow[],
  ballots: Pick<GeneralVoteBallotRow, "vote" | "option_id">[]
): GeneralChoiceTally {
  const counts = new Map(options.map((option) => [option.id, 0]));
  let abstain = 0;
  for (const ballot of ballots) {
    if (ballot.vote === "abstain") {
      abstain += 1;
    } else if (ballot.option_id && counts.has(ballot.option_id)) {
      counts.set(ballot.option_id, (counts.get(ballot.option_id) ?? 0) + 1);
    }
  }
  return {
    options: options.map((option) => ({ ...option, count: counts.get(option.id) ?? 0 })),
    abstain
  };
}

export function formatGeneralVoteTally(
  voteType: GeneralVoteType,
  ballots: Pick<GeneralVoteBallotRow, "vote" | "option_id">[],
  options: GeneralVoteOptionRow[]
): string {
  if (voteType === "binary") {
    const tally = tallyGeneralVoteBallots(ballots);
    return `**Yes:** ${tally.yes}\n**No:** ${tally.no}\n**Abstain:** ${tally.abstain}`;
  }
  const tally = tallyGeneralChoiceBallots(options, ballots);
  return [
    ...tally.options.map((option, index) => `**${index + 1}. ${option.label}:** ${option.count}`),
    `**Abstain:** ${tally.abstain}`
  ].join("\n");
}

export function generalVoteSelectionLabel(
  ballot: Pick<GeneralVoteBallotRow, "vote" | "option_id">,
  options: GeneralVoteOptionRow[]
): string {
  if (ballot.vote === "yes") return "Yes";
  if (ballot.vote === "no") return "No";
  if (ballot.vote === "abstain") return "Abstain";
  return options.find((option) => option.id === ballot.option_id)?.label ?? "Unknown option";
}

export function parseGeneralVoteChoices(input: string): GeneralVoteChoiceInput[] {
  const choices = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf("|");
      const label = (separator === -1 ? line : line.slice(0, separator)).trim();
      const description = separator === -1 ? null : line.slice(separator + 1).trim() || null;
      if (!label) {
        throw new UserFacingError("Every vote option needs a name before the `|` separator.");
      }
      if (label.length > 80) {
        throw new UserFacingError(`Vote option names cannot exceed 80 characters: ${label.slice(0, 40)}...`);
      }
      if (description && description.length > 300) {
        throw new UserFacingError(`The description for **${label}** cannot exceed 300 characters.`);
      }
      if (label.toLowerCase() === "abstain") {
        throw new UserFacingError("Abstain is added automatically and cannot be used as an option name.");
      }
      return { label, description };
    });

  if (choices.length < 2 || choices.length > 10) {
    throw new UserFacingError("Enter between 2 and 10 options, one per line.");
  }
  const uniqueLabels = new Set(choices.map((choice) => choice.label.toLocaleLowerCase()));
  if (uniqueLabels.size !== choices.length) {
    throw new UserFacingError("Each multiple-choice option must have a unique name.");
  }
  return choices;
}

export async function generalVoteMessage(voteId: string): Promise<MessageEditOptions> {
  const vote = await getGeneralVote(voteId);
  if (!vote) {
    throw new UserFacingError("Vote not found.");
  }
  const [ballots, options] = await Promise.all([
    listGeneralVoteBallots(vote.id),
    vote.vote_type === "choice" ? listGeneralVoteOptions(vote.id) : Promise.resolve([])
  ]);
  const embed = new EmbedBuilder()
    .setTitle(vote.vote_type === "choice" ? "Multiple-Choice Vote" : "Channel Vote")
    .setDescription(vote.question)
    .addFields(
      { name: "Status", value: vote.status, inline: true },
      { name: "Opened by", value: `<@${vote.opened_by_discord_user_id}>`, inline: true }
    )
    .setColor(vote.status === "Open" ? 0x587c4a : 0x6b6b6b)
    .setFooter({ text: `Vote ${vote.id.slice(0, 8)}` })
    .setTimestamp(new Date(vote.created_at));
  if (vote.context) {
    embed.addFields({ name: "Context", value: vote.context.slice(0, 1024) });
  }
  if (vote.vote_type === "choice") {
    for (const option of options) {
      if (option.description) {
        embed.addFields({ name: `${option.position + 1}. ${option.label}`, value: option.description });
      }
    }
  }
  embed.addFields({
    name: vote.status === "Open" ? "Current Tally" : "Final Tally",
    value: formatGeneralVoteTally(vote.vote_type, ballots, options)
  });
  if (vote.closed_at) {
    embed.addFields({
      name: "Closed",
      value: [
        `<t:${Math.floor(new Date(vote.closed_at).getTime() / 1000)}:f>`,
        vote.closed_by_discord_user_id ? `by <@${vote.closed_by_discord_user_id}>` : null
      ].filter(Boolean).join(" ")
    });
  }
  return {
    embeds: [embed],
    components: vote.status === "Open"
      ? [vote.vote_type === "choice" ? generalVoteChoiceRow(vote.id, options) : generalVoteActionRow(vote.id)]
      : [],
    allowedMentions: { parse: [] }
  };
}

export async function refreshGeneralVoteMessage(guild: Guild, voteId: string): Promise<void> {
  const vote = await getGeneralVote(voteId);
  if (!vote?.message_id) {
    return;
  }
  const channel = await guild.channels.fetch(vote.channel_id).catch(() => null);
  if (!channel?.isTextBased()) {
    return;
  }
  const message = await channel.messages.fetch(vote.message_id).catch(() => null);
  await message?.edit(await generalVoteMessage(vote.id));
}

export async function finalizeGeneralVoteThread(guild: Guild, vote: GeneralVoteRow): Promise<void> {
  if (!vote.thread_id) {
    return;
  }
  const thread = await guild.channels.fetch(vote.thread_id).catch(() => null);
  if (!thread?.isThread()) {
    return;
  }
  await thread.setLocked(true, "Channel vote closed").catch(() => undefined);
  await thread.setArchived(true, "Channel vote closed").catch(() => undefined);
}

function generalVoteActionRow(voteId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`general-vote:ballot:${voteId}:yes`).setLabel("Yes").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`general-vote:ballot:${voteId}:no`).setLabel("No").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`general-vote:ballot:${voteId}:abstain`).setLabel("Abstain").setStyle(ButtonStyle.Secondary)
  );
}

function generalVoteChoiceRow(
  voteId: string,
  options: GeneralVoteOptionRow[]
): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`general-vote:choice:${voteId}`)
    .setPlaceholder("Choose one option")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options.map((option) => {
      const item = new StringSelectMenuOptionBuilder().setLabel(option.label).setValue(option.id);
      if (option.description) {
        item.setDescription(option.description.slice(0, 100));
      }
      return item;
    }))
    .addOptions(new StringSelectMenuOptionBuilder()
      .setLabel("Abstain")
      .setValue("abstain")
      .setDescription("Record no preference among the listed options."));
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

async function requireOpenVoteForVoter(params: {
  guild: Guild;
  voteId: string;
  voterDiscordUserId: string;
  interactionChannelId: string;
}): Promise<GeneralVoteRow> {
  const vote = await getGeneralVote(params.voteId);
  if (!vote || vote.status !== "Open") {
    throw new UserFacingError("That vote is not open.");
  }
  if (vote.guild_id !== params.guild.id || vote.channel_id !== params.interactionChannelId) {
    throw new UserFacingError("That vote does not belong to this channel.");
  }

  const member = await params.guild.members.fetch(params.voterDiscordUserId).catch(() => null);
  const channel = await params.guild.channels.fetch(vote.channel_id).catch(() => null);
  if (!member || member.user.bot || !channel || !member.permissionsIn(channel).has(PermissionFlagsBits.ViewChannel)) {
    throw new UserFacingError("You do not have permission to vote here.");
  }
  return vote;
}

async function upsertGeneralBallot(
  voteId: string,
  voterDiscordUserId: string,
  vote: GeneralBallotVote | null,
  optionId: string | null
): Promise<void> {
  const existing = await getExistingGeneralBallot(voteId, voterDiscordUserId);
  if (existing) {
    const { error } = await supabase
      .from("general_vote_ballots")
      .update({ vote, option_id: optionId, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    assertNoDbError(error, "update channel ballot");
    return;
  }
  const { error } = await supabase
    .from("general_vote_ballots")
    .insert({
      general_vote_id: voteId,
      voter_discord_user_id: voterDiscordUserId,
      vote,
      option_id: optionId
    });
  assertNoDbError(error, "insert channel ballot");
}

async function getExistingGeneralBallot(
  voteId: string,
  voterDiscordUserId: string
): Promise<GeneralVoteBallotRow | null> {
  const { data, error } = await supabase
    .from("general_vote_ballots")
    .select("*")
    .eq("general_vote_id", voteId)
    .eq("voter_discord_user_id", voterDiscordUserId)
    .maybeSingle();
  assertNoDbError(error, "get existing channel ballot");
  return data;
}
