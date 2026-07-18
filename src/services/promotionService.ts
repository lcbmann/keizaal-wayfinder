import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Guild } from "discord.js";
import { env } from "../config/env.js";
import { MAIN_RANKS, rankAtLeast, type MainRank } from "../config/ranks.js";
import {
  assertNoDbError,
  supabase,
  type BallotVote,
  type PromotionBallotRow,
  type PromotionVoteRow,
  type RangerRow
} from "../db/supabase.js";
import { daysBetween, formatMaybeDateTime } from "../utils/dates.js";
import { UserFacingError } from "../utils/errors.js";
import { getRangerByDiscordId, getRangerById, promoteRanger } from "./rangerService.js";

export interface EligibleRanger {
  ranger: RangerRow;
  daysInCorps: number;
  hasOpenVote: boolean;
  eligible: boolean;
  reasons: string[];
}

export interface PromotionBallotWithVoter {
  ballot: PromotionBallotRow;
  voter: RangerRow | null;
}

export async function listApprenticePromotionEligibility(): Promise<EligibleRanger[]> {
  const { data, error } = await supabase
    .from("rangers")
    .select("*")
    .eq("current_rank", "Apprentice")
    .order("join_date", { ascending: true });

  assertNoDbError(error, "list apprentice candidates");

  const results: EligibleRanger[] = [];
  for (const ranger of data ?? []) {
    const openVote = await hasOpenPromotionVote(ranger.id);
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

export async function attachPromotionVoteMessage(voteId: string, channelId: string, messageId: string): Promise<void> {
  const { error } = await supabase
    .from("promotion_votes")
    .update({ channel_id: channelId, message_id: messageId })
    .eq("id", voteId);

  assertNoDbError(error, "attach promotion vote message");
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

export async function promotionVoteEmbed(vote: PromotionVoteRow): Promise<EmbedBuilder> {
  const candidate = await getRangerById(vote.candidate_ranger_id);
  const tally = await getPromotionVoteTally(vote.id);
  const embed = new EmbedBuilder()
    .setTitle(`Promotion Vote: ${candidate?.discord_display_name ?? "Unknown Ranger"}`)
    .setDescription([
      candidate
        ? `The Corps is considering <@${candidate.discord_user_id}> for promotion to **${vote.target_rank}**. Cast **Yes**, **No**, or **Abstain** below.`
        : `The Corps is considering this Ranger for promotion to **${vote.target_rank}**. Cast **Yes**, **No**, or **Abstain** below.`,
      `Vote ID: \`${vote.id}\``,
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

export async function refreshPromotionVoteMessage(voteId: string): Promise<{
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
}> {
  const vote = await getPromotionVote(voteId);
  if (!vote) {
    throw new UserFacingError("Promotion vote not found.");
  }

  return {
    embeds: [await promotionVoteEmbed(vote)],
    components: vote.status === "Open" ? [promotionVoteActionRow(vote.id)] : []
  };
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
