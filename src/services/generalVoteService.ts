import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  type Guild,
  type MessageEditOptions
} from "discord.js";
import {
  assertNoDbError,
  supabase,
  type GeneralBallotVote,
  type GeneralVoteBallotRow,
  type GeneralVoteRow
} from "../db/supabase.js";
import { UserFacingError } from "../utils/errors.js";

export interface GeneralVoteTally {
  yes: number;
  no: number;
  abstain: number;
}

export async function createGeneralVote(params: {
  guildId: string;
  channelId: string;
  question: string;
  context: string | null;
  openedByDiscordUserId: string;
}): Promise<GeneralVoteRow> {
  const { data, error } = await supabase
    .from("general_votes")
    .insert({
      guild_id: params.guildId,
      channel_id: params.channelId,
      message_id: null,
      thread_id: null,
      question: params.question,
      context: params.context,
      status: "Open",
      opened_by_discord_user_id: params.openedByDiscordUserId,
      closed_by_discord_user_id: null
    })
    .select("*")
    .single();

  assertNoDbError(error, "create channel vote");
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

export async function recordGeneralVoteBallot(params: {
  guild: Guild;
  voteId: string;
  voterDiscordUserId: string;
  interactionChannelId: string;
  ballot: GeneralBallotVote;
}): Promise<void> {
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

  const existing = await getExistingGeneralBallot(vote.id, member.id);
  if (existing) {
    const { error } = await supabase
      .from("general_vote_ballots")
      .update({ vote: params.ballot, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    assertNoDbError(error, "update channel ballot");
    return;
  }

  const { error } = await supabase
    .from("general_vote_ballots")
    .insert({
      general_vote_id: vote.id,
      voter_discord_user_id: member.id,
      vote: params.ballot
    });
  assertNoDbError(error, "insert channel ballot");
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
    tally[ballot.vote] += 1;
    return tally;
  }, { yes: 0, no: 0, abstain: 0 });
}

export async function generalVoteMessage(voteId: string): Promise<MessageEditOptions> {
  const vote = await getGeneralVote(voteId);
  if (!vote) {
    throw new UserFacingError("Vote not found.");
  }
  const tally = tallyGeneralVoteBallots(await listGeneralVoteBallots(vote.id));
  const embed = new EmbedBuilder()
    .setTitle("Channel Vote")
    .setDescription(vote.question)
    .addFields(
      { name: "Status", value: vote.status, inline: true },
      { name: "Opened by", value: `<@${vote.opened_by_discord_user_id}>`, inline: true },
      {
        name: "Current Tally",
        value: `**Yes:** ${tally.yes}\n**No:** ${tally.no}\n**Abstain:** ${tally.abstain}`
      }
    )
    .setColor(vote.status === "Open" ? 0x587c4a : 0x6b6b6b)
    .setFooter({ text: `Vote ${vote.id.slice(0, 8)}` })
    .setTimestamp(new Date(vote.created_at));
  if (vote.context) {
    embed.addFields({ name: "Context", value: vote.context.slice(0, 1024) });
  }
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
    components: vote.status === "Open" ? [generalVoteActionRow(vote.id)] : [],
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
    new ButtonBuilder()
      .setCustomId(`general-vote:ballot:${voteId}:yes`)
      .setLabel("Yes")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`general-vote:ballot:${voteId}:no`)
      .setLabel("No")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`general-vote:ballot:${voteId}:abstain`)
      .setLabel("Abstain")
      .setStyle(ButtonStyle.Secondary)
  );
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
