import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  ThreadAutoArchiveDuration,
  type Guild,
  type Message,
  type TextChannel
} from "discord.js";
import { env } from "../config/env.js";
import { MAIN_RANKS, rankAtLeast, type MainRank } from "../config/ranks.js";
import {
  assertNoDbError,
  supabase,
  type BallotVote,
  type PromotionBallotRow,
  type PromotionProgress,
  type PromotionVoteRow,
  type RangerRow
} from "../db/supabase.js";
import { daysBetween, formatMaybeDateTime } from "../utils/dates.js";
import { UserFacingError } from "../utils/errors.js";
import { emojiEmbed, rankEmojiName } from "../utils/guildEmojis.js";
import { getRangerByDiscordId, getRangerById, promoteRanger } from "./rangerService.js";
import { refreshFieldNamesBulletin } from "./fieldNameService.js";
import { getStoredTextChannel, saveBotMessageState } from "./botMessageStateService.js";
import { roleIdForRank } from "../config/roles.js";

const PROMOTION_CHANNEL_STATE_KEY = "promotion-votes-channel";

export interface PromotionVoteRepairResult {
  refreshed: number;
  closedStale: number;
}

export interface EligibleRanger {
  ranger: RangerRow;
  daysInCorps: number;
  hasOpenVote: boolean;
  openVoteCreatedAt: string | null;
  eligible: boolean;
  reasons: string[];
}

export interface PromotionBallotWithVoter {
  ballot: PromotionBallotRow;
  voter: RangerRow | null;
}

export async function setPromotionProgress(params: {
  discordUserId: string;
  progress: PromotionProgress;
}): Promise<RangerRow> {
  const ranger = await getRangerByDiscordId(params.discordUserId);
  if (!ranger) {
    throw new UserFacingError("That Apprentice is not in the roster.");
  }
  if (ranger.current_rank !== "Apprentice") {
    throw new UserFacingError("Promotion progress can only be set for Apprentices.");
  }

  const { data, error } = await supabase
    .from("rangers")
    .update({
      promotion_progress: params.progress,
      promotion_progress_started_at: params.progress === null
        ? null
        : ranger.promotion_progress === params.progress
          ? ranger.promotion_progress_started_at
          : new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq("id", ranger.id)
    .select("*")
    .single();
  assertNoDbError(error, "set promotion progress");
  return data;
}

export async function listApprenticePromotionEligibility(): Promise<EligibleRanger[]> {
  const { data, error } = await supabase
    .from("rangers")
    .select("*")
    .eq("current_rank", "Apprentice")
    .order("join_date", { ascending: true });

  assertNoDbError(error, "list apprentice candidates");

  const apprentices = data ?? [];
  if (apprentices.length === 0) {
    return [];
  }

  const { data: openVotes, error: openVotesError } = await supabase
    .from("promotion_votes")
    .select("candidate_ranger_id, created_at")
    .in("candidate_ranger_id", apprentices.map((ranger) => ranger.id))
    .eq("status", "Open")
    .order("created_at", { ascending: true });
  assertNoDbError(openVotesError, "list open apprentice promotion votes");
  const openVoteCreatedAt = new Map<string, string>();
  for (const vote of openVotes ?? []) {
    if (!openVoteCreatedAt.has(vote.candidate_ranger_id)) {
      openVoteCreatedAt.set(vote.candidate_ranger_id, vote.created_at);
    }
  }

  const results: EligibleRanger[] = [];
  for (const ranger of apprentices) {
    const openVoteAt = openVoteCreatedAt.get(ranger.id) ?? null;
    const openVote = openVoteAt !== null;
    const days = daysBetween(ranger.join_date);
    const reasons: string[] = [];

    if (ranger.status !== "Active") {
      reasons.push(`status is ${ranger.status}`);
    }
    if (days < env.PROMOTION_MIN_DAYS_APPRENTICE_TO_RANGER) {
      reasons.push(`only ${days} days in Corps`);
    }
    if (openVote) {
      reasons.push("open vote already exists");
    }

    results.push({
      ranger,
      daysInCorps: days,
      hasOpenVote: openVote,
      openVoteCreatedAt: openVoteAt,
      eligible: reasons.length === 0,
      reasons
    });
  }

  return results;
}

export async function hasOpenPromotionVote(candidateRangerId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("promotion_votes")
    .select("id")
    .eq("candidate_ranger_id", candidateRangerId)
    .eq("status", "Open")
    .limit(1);

  assertNoDbError(error, "check open promotion vote");
  return (data?.length ?? 0) > 0;
}

export function promotionVoteActionRow(voteId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`promotion:vote:${voteId}:promote`).setLabel("Yes").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`promotion:vote:${voteId}:hold`).setLabel("No").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`promotion:vote:${voteId}:abstain`).setLabel("Abstain").setStyle(ButtonStyle.Primary)
  );
}

export async function createPromotionVote(params: {
  candidate: RangerRow;
  targetRank: MainRank;
  openedByDiscordUserId: string;
  reason?: string | null;
}): Promise<PromotionVoteRow> {
  if (candidateAlreadyHoldsPromotionTarget(params.candidate.current_rank, params.targetRank)) {
    throw new UserFacingError(`${params.candidate.discord_display_name ?? "That Ranger"} already holds ${params.targetRank} or a higher rank.`);
  }

  const { data: openVotes, error: openVoteError } = await supabase
    .from("promotion_votes")
    .select("id")
    .eq("candidate_ranger_id", params.candidate.id)
    .eq("status", "Open")
    .limit(1);
  assertNoDbError(openVoteError, "check existing promotion vote");
  if ((openVotes?.length ?? 0) > 0) {
    throw new UserFacingError(`${params.candidate.discord_display_name ?? "That Ranger"} already has an open promotion vote.`);
  }

  const { data, error } = await supabase
    .from("promotion_votes")
    .insert({
      candidate_ranger_id: params.candidate.id,
      target_rank: params.targetRank,
      status: "Open",
      opened_by_discord_user_id: params.openedByDiscordUserId,
      message_id: null,
      channel_id: null,
      final_decision: params.reason ?? null
    })
    .select("*")
    .single();

  assertNoDbError(error, "create promotion vote");
  return data;
}

export async function attachPromotionVoteMessage(
  voteId: string,
  channelId: string,
  messageId: string,
  threadId: string | null = null
): Promise<void> {
  const { error } = await supabase
    .from("promotion_votes")
    .update({ channel_id: channelId, message_id: messageId, thread_id: threadId })
    .eq("id", voteId);

  assertNoDbError(error, "attach promotion vote message");
}

export async function getPromotionChannel(guild: Guild): Promise<TextChannel | null> {
  return getStoredTextChannel(guild, PROMOTION_CHANNEL_STATE_KEY);
}

export async function configurePromotionChannel(guild: Guild, channel: TextChannel): Promise<PromotionVoteRepairResult> {
  await channel.permissionOverwrites.edit(guild.roles.everyone, {
    ViewChannel: false,
    ReadMessageHistory: false
  }, { reason: "Restrict Ranger promotion votes" });
  await channel.permissionOverwrites.edit(roleIdForRank("Ranger"), {
    ViewChannel: true,
    ReadMessageHistory: true,
    SendMessages: true,
    SendMessagesInThreads: true
  }, { reason: "Allow full Rangers to review promotion votes" });
  await channel.permissionOverwrites.edit(roleIdForRank("Apprentice"), {
    ViewChannel: false,
    ReadMessageHistory: false
  }, { reason: "Keep promotion votes Ranger-only" });
  await channel.permissionOverwrites.edit(guild.client.user.id, {
    ViewChannel: true,
    ReadMessageHistory: true,
    SendMessages: true,
    EmbedLinks: true,
    CreatePublicThreads: true,
    SendMessagesInThreads: true,
    ManageThreads: true
  }, { reason: "Allow Wayfinder to maintain promotion votes" });
  await saveBotMessageState(PROMOTION_CHANNEL_STATE_KEY, channel.id, []);
  return repairOpenPromotionVoteMessages(guild);
}

export async function postPromotionVote(params: {
  guild: Guild;
  vote: PromotionVoteRow;
  mentionRoleIds?: string[];
}): Promise<Message> {
  const channel = await getPromotionChannel(params.guild);
  if (!channel) {
    throw new UserFacingError("The promotion channel is not configured. A Marshal should run `/promotion setup` first.");
  }
  const mentionRoleIds = [...new Set(params.mentionRoleIds ?? [])];
  const message = await channel.send({
    ...(mentionRoleIds.length > 0
      ? {
          content: mentionRoleIds.map((roleId) => `<@&${roleId}>`).join(" "),
          allowedMentions: { roles: mentionRoleIds }
        }
      : {}),
    embeds: [await promotionVoteEmbed(params.guild, params.vote)],
    components: [promotionVoteActionRow(params.vote.id)]
  });
  const candidate = await getRangerById(params.vote.candidate_ranger_id);
  const thread = await message.startThread({
    name: `Promotion - ${candidate?.discord_display_name ?? candidate?.discord_username ?? params.vote.id.slice(0, 8)}`.slice(0, 100),
    autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    reason: "Create promotion vote discussion"
  });
  await attachPromotionVoteMessage(params.vote.id, channel.id, message.id, thread.id);
  return message;
}

export async function finalizePromotionVoteThread(guild: Guild, vote: PromotionVoteRow): Promise<void> {
  if (!vote.thread_id) {
    return;
  }
  const thread = await guild.channels.fetch(vote.thread_id).catch(() => null);
  if (!thread?.isThread()) {
    return;
  }
  await thread.setLocked(true, `Promotion vote ${vote.status}`).catch(() => undefined);
  await thread.setArchived(true, `Promotion vote ${vote.status}`).catch(() => undefined);
}

export async function getPromotionVote(id: string): Promise<PromotionVoteRow | null> {
  const { data, error } = await supabase.from("promotion_votes").select("*").eq("id", id).maybeSingle();
  assertNoDbError(error, "get promotion vote");
  return data;
}

export async function findOpenPromotionVotes(): Promise<PromotionVoteRow[]> {
  const { data, error } = await supabase
    .from("promotion_votes")
    .select("*")
    .eq("status", "Open")
    .order("created_at", { ascending: false })
    .limit(25);

  assertNoDbError(error, "find open promotion votes");
  return data ?? [];
}

export async function findRecentPromotionVotes(): Promise<PromotionVoteRow[]> {
  const { data, error } = await supabase
    .from("promotion_votes")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(25);

  assertNoDbError(error, "find promotion votes");
  return data ?? [];
}

export async function recordPromotionBallot(voteId: string, voterDiscordUserId: string, vote: BallotVote): Promise<void> {
  const promotionVote = await getPromotionVote(voteId);
  if (!promotionVote || promotionVote.status !== "Open") {
    throw new UserFacingError("That promotion vote is not open.");
  }

  const voter = await getRangerByDiscordId(voterDiscordUserId);
  if (!voter || !canVoteOnTarget(voter.current_rank, promotionVote.target_rank)) {
    throw new UserFacingError("You do not have permission to vote on this promotion.");
  }

  const existing = await getExistingBallot(voteId, voterDiscordUserId);
  if (existing) {
    const { error } = await supabase
      .from("promotion_vote_ballots")
      .update({ vote, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    assertNoDbError(error, "update promotion ballot");
    return;
  }

  const { error } = await supabase.from("promotion_vote_ballots").insert({
    promotion_vote_id: voteId,
    voter_discord_user_id: voterDiscordUserId,
    vote
  });

  assertNoDbError(error, "insert promotion ballot");
}

export async function listPromotionBallotsWithVoters(voteId: string): Promise<PromotionBallotWithVoter[]> {
  const vote = await getPromotionVote(voteId);
  if (!vote) {
    throw new UserFacingError("Promotion vote not found.");
  }

  const ballots = await getBallots(voteId);
  return Promise.all(ballots.map(async (ballot) => ({
    ballot,
    voter: await getRangerByDiscordId(ballot.voter_discord_user_id)
  })));
}

export async function closePromotionVote(voteId: string): Promise<{
  vote: PromotionVoteRow;
  ballots: PromotionBallotRow[];
  summary: string;
}> {
  const vote = await getPromotionVote(voteId);
  if (!vote) {
    throw new UserFacingError("Promotion vote not found.");
  }
  const { data: updated, error } = await supabase
    .from("promotion_votes")
    .update({ status: "Closed", closed_at: new Date().toISOString() })
    .eq("id", voteId)
    .select("*")
    .single();

  assertNoDbError(error, "close promotion vote");
  const ballots = await getBallots(voteId);
  const summary = await formatPromotionResults(ballots);
  return { vote: updated, ballots, summary };
}

export async function approvePromotionVote(params: {
  guild: Guild;
  voteId: string;
  approverDiscordUserId: string;
}): Promise<{ promoted: RangerRow; previousRank: MainRank; vote: PromotionVoteRow }> {
  const vote = await getPromotionVote(params.voteId);
  if (!vote) {
    throw new UserFacingError("Promotion vote not found.");
  }
  if (vote.status === "Approved") {
    throw new UserFacingError("That promotion vote has already been approved.");
  }
  if (vote.status === "Denied") {
    throw new UserFacingError("A denied promotion vote cannot be approved.");
  }

  const candidate = await getRangerById(vote.candidate_ranger_id);
  if (!candidate) {
    throw new UserFacingError("Candidate roster entry not found.");
  }
  const previousRank = candidate.current_rank;

  const member = await params.guild.members.fetch(candidate.discord_user_id);
  const promoted = await promoteRanger({
    member,
    targetRank: vote.target_rank,
    changedByDiscordUserId: params.approverDiscordUserId,
    reason: `Approved promotion vote ${vote.id}`
  });
  await refreshFieldNamesBulletin(params.guild).catch((error) => {
    console.warn("Could not refresh Field Names after promotion vote:", error);
  });

  const { data: approvedVote, error } = await supabase
    .from("promotion_votes")
    .update({
      status: "Approved",
      final_decision: `Approved by ${params.approverDiscordUserId}`,
      closed_at: new Date().toISOString()
    })
    .eq("id", vote.id)
    .select("*")
    .single();

  assertNoDbError(error, "approve promotion vote");
  return { promoted, previousRank, vote: approvedVote };
}

export async function denyPromotionVote(voteId: string, deniedByDiscordUserId: string): Promise<void> {
  const { error } = await supabase
    .from("promotion_votes")
    .update({
      status: "Denied",
      final_decision: `Denied by ${deniedByDiscordUserId}`,
      closed_at: new Date().toISOString()
    })
    .eq("id", voteId);

  assertNoDbError(error, "deny promotion vote");
}

export async function promotionVoteEmbed(guild: Guild, vote: PromotionVoteRow): Promise<EmbedBuilder> {
  const candidate = await getRangerById(vote.candidate_ranger_id);
  const tally = await getPromotionVoteTally(vote.id);
  const member = candidate
    ? await guild.members.fetch(candidate.discord_user_id).catch(() => null)
    : null;
  const displayName = member?.displayName ?? candidate?.discord_display_name ?? "Unknown Ranger";
  const username = member?.user.username ?? candidate?.discord_username ?? "unknown-user";
  const mention = candidate ? `<@${candidate.discord_user_id}>` : "Unknown Ranger";
  const embed = emojiEmbed(guild, rankEmojiName(vote.target_rank) ?? "promotion", "Promotion Vote")
    .setDescription([
      candidate
        ? `Candidate: ${mention} - ${displayName} (@${username})\nTarget rank: **${vote.target_rank}**. Cast **Yes**, **No**, or **Abstain** below.`
        : `The Corps is considering this Ranger for promotion to **${vote.target_rank}**. Cast **Yes**, **No**, or **Abstain** below.`,
      `Opened by <@${vote.opened_by_discord_user_id}>`
    ].join("\n"))
    .addFields(
      { name: "Current rank", value: candidate?.current_rank ?? "Unknown", inline: true },
      { name: "Status", value: candidate?.status ?? "Unknown", inline: true },
      { name: "Last activity", value: formatMaybeDateTime(candidate?.last_discord_activity_at), inline: true }
    )
    .setColor(0x587c4a)
    .setTimestamp(new Date(vote.created_at));

  embed.addFields({ name: "Current Tally", value: formatTally(tally), inline: false });

  if (vote.final_decision && !vote.final_decision.startsWith("Approved by") && !vote.final_decision.startsWith("Denied by")) {
    embed.addFields({ name: "Reason", value: vote.final_decision.slice(0, 1024) });
  }

  return embed;
}

export async function refreshPromotionVoteMessage(guild: Guild, voteId: string): Promise<{
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
}> {
  const vote = await getPromotionVote(voteId);
  if (!vote) {
    throw new UserFacingError("Promotion vote not found.");
  }

  return {
    embeds: [await promotionVoteEmbed(guild, vote)],
    components: vote.status === "Open" ? [promotionVoteActionRow(vote.id)] : []
  };
}

export async function refreshOpenPromotionVoteMessages(guild: Guild): Promise<PromotionVoteRepairResult> {
  return repairOpenPromotionVoteMessages(guild);
}

async function repairOpenPromotionVoteMessages(guild: Guild): Promise<PromotionVoteRepairResult> {
  const votes = await findOpenPromotionVotes();
  let refreshed = 0;
  let closedStale = 0;
  const configuredChannel = await getPromotionChannel(guild);

  for (const vote of votes) {
    const candidate = await getRangerById(vote.candidate_ranger_id);
    if (candidate && candidateAlreadyHoldsPromotionTarget(candidate.current_rank, vote.target_rank)) {
      await resolveSupersededPromotionVote(guild, vote, candidate.current_rank);
      closedStale += 1;
      continue;
    }

    if (configuredChannel && vote.channel_id !== configuredChannel.id) {
      await postPromotionVote({ guild, vote });
      refreshed += 1;
      continue;
    }

    if (!vote.channel_id || !vote.message_id) {
      if (configuredChannel) {
        await postPromotionVote({ guild, vote });
        refreshed += 1;
      }
      continue;
    }

    const channel = await guild.channels.fetch(vote.channel_id).catch(() => null);
    if (!channel?.isTextBased()) {
      if (configuredChannel) {
        await postPromotionVote({ guild, vote });
        refreshed += 1;
      }
      continue;
    }

    const message = await channel.messages.fetch(vote.message_id).catch(() => null);
    if (!message) {
      if (configuredChannel) {
        await postPromotionVote({ guild, vote });
        refreshed += 1;
      }
      continue;
    }

    await message.edit(await refreshPromotionVoteMessage(guild, vote.id));
    if (!vote.thread_id) {
      const candidate = await getRangerById(vote.candidate_ranger_id);
      const thread = await message.startThread({
        name: `Promotion - ${candidate?.discord_display_name ?? candidate?.discord_username ?? vote.id.slice(0, 8)}`.slice(0, 100),
        autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
        reason: "Repair promotion vote discussion"
      }).catch(() => null);
      if (thread) {
        await attachPromotionVoteMessage(vote.id, message.channelId, message.id, thread.id);
      }
    }
    refreshed += 1;
  }

  return { refreshed, closedStale };
}

export function candidateAlreadyHoldsPromotionTarget(currentRank: MainRank, targetRank: MainRank): boolean {
  return rankAtLeast(currentRank, targetRank);
}

export async function closeSupersededPromotionVotes(params: {
  guild: Guild;
  candidateRangerId: string;
  currentRank: MainRank;
}): Promise<number> {
  const { data, error } = await supabase
    .from("promotion_votes")
    .select("*")
    .eq("candidate_ranger_id", params.candidateRangerId)
    .eq("status", "Open");
  assertNoDbError(error, "list superseded promotion votes");

  const staleVotes = (data ?? []).filter((vote) =>
    candidateAlreadyHoldsPromotionTarget(params.currentRank, vote.target_rank)
  );
  for (const vote of staleVotes) {
    await resolveSupersededPromotionVote(params.guild, vote, params.currentRank);
  }
  return staleVotes.length;
}

async function resolveSupersededPromotionVote(guild: Guild, vote: PromotionVoteRow, currentRank: MainRank): Promise<void> {
  const { error } = await supabase
    .from("promotion_votes")
    .update({
      status: "Approved",
      final_decision: `Automatically closed because the candidate now holds ${currentRank}`,
      closed_at: new Date().toISOString()
    })
    .eq("id", vote.id)
    .eq("status", "Open");
  assertNoDbError(error, "close superseded promotion vote");

  if (vote.thread_id) {
    const thread = await guild.channels.fetch(vote.thread_id).catch(() => null);
    if (thread?.isThread()) {
      await thread.delete("Remove superseded promotion vote discussion").catch((cleanupError) => {
        console.warn(`Could not delete stale promotion thread ${vote.thread_id}:`, cleanupError);
      });
    }
  }

  if (vote.channel_id && vote.message_id) {
    const channel = await guild.channels.fetch(vote.channel_id).catch(() => null);
    if (channel?.isTextBased()) {
      const message = await channel.messages.fetch(vote.message_id).catch(() => null);
      await message?.delete().catch(async (cleanupError) => {
        console.warn(`Could not delete stale promotion message ${vote.message_id}:`, cleanupError);
        await message.edit(await refreshPromotionVoteMessage(guild, vote.id)).catch(() => undefined);
      });
    }
  }
}

function canVoteOnTarget(voterRank: MainRank, targetRank: MainRank): boolean {
  if (targetRank === "Ranger") {
    return rankAtLeast(voterRank, "Ranger");
  }

  return rankAtLeast(voterRank, "Ranger Marshal");
}

async function getExistingBallot(voteId: string, voterDiscordUserId: string): Promise<PromotionBallotRow | null> {
  const { data, error } = await supabase
    .from("promotion_vote_ballots")
    .select("*")
    .eq("promotion_vote_id", voteId)
    .eq("voter_discord_user_id", voterDiscordUserId)
    .maybeSingle();

  assertNoDbError(error, "get existing ballot");
  return data;
}

async function getBallots(voteId: string): Promise<PromotionBallotRow[]> {
  const { data, error } = await supabase
    .from("promotion_vote_ballots")
    .select("*")
    .eq("promotion_vote_id", voteId);

  assertNoDbError(error, "get promotion ballots");
  return data ?? [];
}

async function getPromotionVoteTally(voteId: string): Promise<Record<BallotVote, number>> {
  const ballots = await getBallots(voteId);
  return ballots.reduce(
    (tally, ballot) => {
      tally[ballot.vote] += 1;
      return tally;
    },
    { promote: 0, hold: 0, abstain: 0 }
  );
}

function formatTally(tally: Record<BallotVote, number>): string {
  return `Yes: ${tally.promote} | No: ${tally.hold} | Abstain: ${tally.abstain}`;
}

async function formatPromotionResults(ballots: PromotionBallotRow[]): Promise<string> {
  const totals = { promote: 0, hold: 0, abstain: 0 };
  const byRank = new Map<MainRank, { promote: number; hold: number; abstain: number }>();
  for (const rank of MAIN_RANKS) {
    byRank.set(rank, { promote: 0, hold: 0, abstain: 0 });
  }

  for (const ballot of ballots) {
    totals[ballot.vote] += 1;
    const voter = await getRangerByDiscordId(ballot.voter_discord_user_id);
    if (voter) {
      byRank.get(voter.current_rank)![ballot.vote] += 1;
    }
  }

  const rankLines = MAIN_RANKS.map((rank) => {
    const row = byRank.get(rank)!;
    return `${rank}: ${row.promote} promote / ${row.hold} hold / ${row.abstain} abstain`;
  }).join("\n");

  return [
    `Total: ${totals.promote} promote / ${totals.hold} hold / ${totals.abstain} abstain`,
    rankLines
  ].join("\n");
}
