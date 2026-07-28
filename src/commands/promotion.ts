import { EmbedBuilder, SlashCommandBuilder, type Guild } from "discord.js";
import { MAIN_RANKS, isMainRank } from "../config/ranks.js";
import { env } from "../config/env.js";
import {
  approvePromotionVote,
  attachPromotionVoteMessage,
  closePromotionVote,
  createPromotionVote,
  denyPromotionVote,
  findRecentPromotionVotes,
  getPromotionVote,
  listPromotionBallotsWithVoters,
  listApprenticePromotionEligibility,
  promotionVoteActionRow,
  promotionVoteEmbed,
  refreshPromotionVoteMessage,
  setPromotionProgress,
  type EligibleRanger,
  type PromotionBallotWithVoter
} from "../services/promotionService.js";
import { getRangerByDiscordId, getRangerById } from "../services/rangerService.js";
import { refreshStoredAssignmentsBoard } from "../services/assignmentBoardService.js";
import { UserFacingError } from "../utils/errors.js";
import { canApprovePromotions, canOpenPromotionVotes } from "../utils/permissions.js";
import { emojiEmbed } from "../utils/guildEmojis.js";
import type { BotCommand } from "./types.js";

export const promotionCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("promotion")
    .setDescription("Promotion eligibility and voting.")
    .addSubcommand((subcommand) => subcommand.setName("eligible").setDescription("Show promotion readiness, field-trial, and hold statuses."))
    .addSubcommand((subcommand) =>
      subcommand
        .setName("status")
        .setDescription("Set an Apprentice's promotion progress.")
        .addUserOption((option) => option.setName("candidate").setDescription("Apprentice.").setRequired(true))
        .addStringOption((option) => option
          .setName("progress")
          .setDescription("Current promotion progress.")
          .setRequired(true)
          .addChoices(
            { name: "In Field Trial", value: "field_trial" },
            { name: "On Hold", value: "on_hold" },
            { name: "Clear status", value: "clear" }
          ))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("open")
        .setDescription("Open a promotion vote.")
        .addUserOption((option) => option.setName("candidate").setDescription("Candidate.").setRequired(true))
        .addStringOption((option) =>
          option
            .setName("target_rank")
            .setDescription("Target rank.")
            .addChoices(...MAIN_RANKS.map((rank) => ({ name: rank, value: rank })))
        )
        .addStringOption((option) => option.setName("reason").setDescription("Optional reason or context."))
        .addRoleOption((option) => option.setName("mentions").setDescription("Optional role to mention on the vote post."))
        .addRoleOption((option) => option.setName("mentions_2").setDescription("Optional additional role to mention."))
        .addRoleOption((option) => option.setName("mentions_3").setDescription("Optional additional role to mention."))
        .addRoleOption((option) => option.setName("mentions_4").setDescription("Optional additional role to mention."))
        .addRoleOption((option) => option.setName("mentions_5").setDescription("Optional additional role to mention."))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("close")
        .setDescription("Close a promotion vote and show results.")
        .addStringOption((option) =>
          option.setName("vote").setDescription("Open vote ID.").setRequired(true).setAutocomplete(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("approve")
        .setDescription("Approve a vote and promote the candidate.")
        .addStringOption((option) =>
          option.setName("vote").setDescription("Open or closed vote ID.").setRequired(true).setAutocomplete(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("deny")
        .setDescription("Deny a promotion vote.")
        .addStringOption((option) =>
          option.setName("vote").setDescription("Open or closed vote ID.").setRequired(true).setAutocomplete(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("ballots")
        .setDescription("Show who voted Yes, No, or Abstain on a promotion vote.")
        .addStringOption((option) =>
          option.setName("vote").setDescription("Vote ID.").setRequired(true).setAutocomplete(true)
        )
    ),

  async autocomplete(interaction) {
    const votes = await findRecentPromotionVotes();
    const choices = await Promise.all(
      votes.map(async (vote) => {
        const candidate = await getPromotionVoteCandidateName(vote.candidate_ranger_id);
        return {
          name: `${candidate} - ${vote.target_rank} - ${vote.status} - ${vote.id.slice(0, 8)}`.slice(0, 100),
          value: vote.id
        };
      })
    );
    await interaction.respond(choices);
  },

  async execute(interaction) {
    if (!interaction.inCachedGuild()) {
      throw new UserFacingError("This command can only be used in the configured guild.");
    }

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "approve" || subcommand === "eligible" || subcommand === "status") {
      await interaction.deferReply({ ephemeral: subcommand === "eligible" || subcommand === "status" });
    }
    const actor = await interaction.guild.members.fetch(interaction.user.id);

    if (subcommand === "status") {
      if (!canOpenPromotionVotes(actor)) {
        throw new UserFacingError("Ranger Marshal or higher is required.");
      }

      const candidate = interaction.options.getUser("candidate", true);
      const progressValue = interaction.options.getString("progress", true);
      const progress = progressValue === "field_trial"
        ? "In Field Trial"
        : progressValue === "on_hold"
          ? "On Hold"
          : null;
      await setPromotionProgress({ discordUserId: candidate.id, progress });
      await interaction.editReply({
        content: progress
          ? `Set ${candidate}'s promotion status to **${progress}**.`
          : `Cleared ${candidate}'s promotion progress status.`
      });
      return;
    }

    if (subcommand === "eligible") {
      if (!canOpenPromotionVotes(actor)) {
        throw new UserFacingError("Ranger Marshal or higher is required.");
      }

      const candidates = await listApprenticePromotionEligibility();
      const embeds = promotionEligibilityEmbeds(interaction.guild, candidates);

      const [firstEmbed, ...remainingEmbeds] = embeds;
      if (firstEmbed) {
        await interaction.editReply({ embeds: [firstEmbed] });
      }
      for (const embed of remainingEmbeds) {
        await interaction.followUp({ embeds: [embed], ephemeral: true });
      }
      return;
    }

    if (subcommand === "open") {
      if (!canOpenPromotionVotes(actor)) {
        throw new UserFacingError("Ranger Marshal or higher is required.");
      }

      const user = interaction.options.getUser("candidate", true);
      const candidate = await getRangerByDiscordId(user.id);
      if (!candidate) {
        throw new UserFacingError("Candidate is not in the roster.");
      }

      const rankValue = interaction.options.getString("target_rank") ?? "Ranger";
      if (!isMainRank(rankValue)) {
        throw new UserFacingError("Invalid target rank.");
      }

      const vote = await createPromotionVote({
        candidate,
        targetRank: rankValue,
        openedByDiscordUserId: interaction.user.id,
        reason: interaction.options.getString("reason")
      });
      const mentionRoleIds = mentionRoleOptionNames
        .map((optionName) => interaction.options.getRole(optionName)?.id)
        .filter((roleId): roleId is string => Boolean(roleId));
      const uniqueMentionRoleIds = [...new Set(mentionRoleIds)];
      const message = await interaction.reply({
        ...(uniqueMentionRoleIds.length > 0
          ? {
              content: uniqueMentionRoleIds.map((roleId) => `<@&${roleId}>`).join(" "),
              allowedMentions: { roles: uniqueMentionRoleIds }
            }
          : {}),
        embeds: [await promotionVoteEmbed(interaction.guild, vote)],
        components: [promotionVoteActionRow(vote.id)],
        fetchReply: true
      });
      await attachPromotionVoteMessage(vote.id, message.channelId, message.id);
      return;
    }

    if (subcommand === "close") {
      if (!canOpenPromotionVotes(actor)) {
        throw new UserFacingError("Ranger Marshal or higher is required.");
      }

      const result = await closePromotionVote(interaction.options.getString("vote", true));
      await interaction.reply({ content: `Promotion vote closed.\n${result.summary}` });
      return;
    }

    if (subcommand === "approve") {
      if (!canApprovePromotions(actor)) {
        throw new UserFacingError("Ranger Captain or higher is required.");
      }

      const result = await approvePromotionVote({
        guild: interaction.guild,
        voteId: interaction.options.getString("vote", true),
        approverDiscordUserId: interaction.user.id
      });
      const ballots = await listPromotionBallotsWithVoters(result.vote.id);
      await interaction.editReply({
        content: `<@${result.promoted.discord_user_id}>`,
        embeds: [promotionApprovalEmbed(interaction.guild, result.promoted, result.previousRank, result.vote, ballots)],
        allowedMentions: { users: [result.promoted.discord_user_id] }
      });
      void Promise.allSettled([
        refreshStoredAssignmentsBoard(interaction.guild),
        editPromotionVoteMessage(interaction.guild, result.vote.id)
      ]).then((results) => {
        for (const result of results) {
          if (result.status === "rejected") {
            console.warn(`Could not run post-approval promotion refresh for ${interaction.id}:`, result.reason);
          }
        }
      });
      return;
    }

    if (subcommand === "deny") {
      if (!canApprovePromotions(actor)) {
        throw new UserFacingError("Ranger Captain or higher is required.");
      }

      await denyPromotionVote(interaction.options.getString("vote", true), interaction.user.id);
      await interaction.reply({ content: "The promotion was not approved. The vote is now closed." });
      return;
    }

    if (subcommand === "ballots") {
      if (!canApprovePromotions(actor)) {
        throw new UserFacingError("Ranger Captain or higher is required to view promotion ballots.");
      }

      const voteId = interaction.options.getString("vote", true);
      const vote = await getPromotionVote(voteId);
      if (!vote) {
        throw new UserFacingError("Promotion vote not found.");
      }

      const ballots = await listPromotionBallotsWithVoters(voteId);
      await interaction.reply({ embeds: [promotionBallotsEmbed(interaction.guild, vote, ballots)], ephemeral: true });
    }
  }
};

const mentionRoleOptionNames = ["mentions", "mentions_2", "mentions_3", "mentions_4", "mentions_5"] as const;

function promotionEligibilityEmbeds(guild: Guild, candidates: EligibleRanger[]): EmbedBuilder[] {
  const sortedCandidates = [...candidates].sort(compareEligibilityDisplayOrder);
  const promotionVoteOpen = candidates.filter((candidate) => eligibilityBucket(candidate) === "promotion-vote").length;
  const ready = candidates.filter((candidate) => eligibilityBucket(candidate) === "ready").length;
  const fieldTrial = candidates.filter((candidate) => eligibilityBucket(candidate) === "field-trial").length;
  const onHold = candidates.filter((candidate) => eligibilityBucket(candidate) === "on-hold").length;
  const notReady = candidates.filter((candidate) => eligibilityBucket(candidate) === "not-ready").length;

  const sections = [
    ["promotion-vote", "Promotion Vote Open"],
    ["ready", "Ready for Review"],
    ["field-trial", "In Field Trial"],
    ["on-hold", "On Hold"],
    ["not-ready", "Not Yet Ready"]
  ] as const;
  const fields: Array<{ name: string; value: string }> = [];
  for (const [bucket, label] of sections) {
    const lines = sortedCandidates
      .filter((candidate) => eligibilityBucket(candidate) === bucket)
      .map(formatEligibilityLine);
    const chunks = splitEligibilityLines(lines);
    chunks.forEach((chunk, index) => {
      fields.push({
        name: index === 0 ? `${label} (${lines.length})` : `${label} (continued)`,
        value: chunk
      });
    });
  }

  const description = candidates.length
    ? `${promotionVoteOpen} promotion vote open / ${ready} ready / ${fieldTrial} in field trial / ${onHold} on hold / ${notReady} not ready. Minimum time in Corps: ${env.PROMOTION_MIN_DAYS_APPRENTICE_TO_RANGER} days.`
    : "No Apprentices found.";
  const embeds: EmbedBuilder[] = [];
  let current = createEligibilityEmbed(guild, false, description);
  let currentCharacters = description.length + "Apprentice Promotion Eligibility".length;
  let currentFields = 0;

  for (const field of fields) {
    const fieldCharacters = field.name.length + field.value.length;
    if (currentFields > 0 && (currentFields >= 25 || currentCharacters + fieldCharacters > 5500)) {
      embeds.push(current);
      current = createEligibilityEmbed(guild, true, description);
      currentCharacters = description.length + "Apprentice Promotion Eligibility (continued)".length;
      currentFields = 0;
    }
    current.addFields(field);
    currentCharacters += fieldCharacters;
    currentFields += 1;
  }

  if (currentFields > 0 || embeds.length === 0) {
    embeds.push(current);
  }
  const lastEmbed = embeds.at(-1);
  lastEmbed?.setFooter({ text: `Showing all ${candidates.length} Apprentices.` });
  return embeds;
}

function createEligibilityEmbed(guild: Guild, continued: boolean, description: string): EmbedBuilder {
  return emojiEmbed(
    guild,
    "promotion",
    continued ? "Apprentice Promotion Eligibility (continued)" : "Apprentice Promotion Eligibility"
  )
    .setDescription(description)
    .setColor(0x587c4a);
}

function splitEligibilityLines(lines: string[]): string[] {
  if (lines.length === 0) {
    return [];
  }

  const chunks: string[] = [];
  let current: string[] = [];
  let currentLength = 0;
  for (const line of lines) {
    if (current.length > 0 && currentLength + line.length + 1 > 1000) {
      chunks.push(current.join("\n"));
      current = [];
      currentLength = 0;
    }
    current.push(line);
    currentLength += line.length + 1;
  }
  if (current.length > 0) {
    chunks.push(current.join("\n"));
  }
  return chunks;
}

async function editPromotionVoteMessage(guild: Guild, voteId: string): Promise<void> {
  const vote = await getPromotionVote(voteId);
  if (!vote?.channel_id || !vote.message_id) {
    return;
  }

  const channel = await guild.channels.fetch(vote.channel_id);
  if (!channel?.isTextBased()) {
    return;
  }

  const message = await channel.messages.fetch(vote.message_id);
  await message.edit(await refreshPromotionVoteMessage(guild, voteId));
}

function formatEligibilityLine(candidate: EligibleRanger): string {
  const r = candidate.ranger;
  const bucket = eligibilityBucket(candidate);
  const summary = `<@${r.discord_user_id}> - ${candidate.daysInCorps}d - ${r.status}`;
  if (bucket === "not-ready" && candidate.reasons.length > 0) {
    return `${summary} - ${candidate.reasons.join("; ")}`;
  }
  return summary;
}

type EligibilityBucket = "promotion-vote" | "ready" | "field-trial" | "on-hold" | "not-ready";

function eligibilityBucket(candidate: EligibleRanger): EligibilityBucket {
  if (candidate.hasOpenVote) {
    return "promotion-vote";
  }
  if (candidate.ranger.promotion_progress === "In Field Trial") {
    return "field-trial";
  }
  if (candidate.ranger.promotion_progress === "On Hold") {
    return "on-hold";
  }
  return candidate.eligible ? "ready" : "not-ready";
}

function compareEligibilityDisplayOrder(a: EligibleRanger, b: EligibleRanger): number {
  const bucketOrder: Record<EligibilityBucket, number> = {
    "promotion-vote": 0,
    ready: 1,
    "field-trial": 2,
    "on-hold": 3,
    "not-ready": 4
  };
  const bucketDiff = bucketOrder[eligibilityBucket(a)] - bucketOrder[eligibilityBucket(b)];
  if (bucketDiff !== 0) {
    return bucketDiff;
  }

  const aActive = a.ranger.status === "Active";
  const bActive = b.ranger.status === "Active";
  if (aActive !== bActive) {
    return aActive ? -1 : 1;
  }

  if (a.daysInCorps !== b.daysInCorps) {
    return b.daysInCorps - a.daysInCorps;
  }

  return displayName(a).localeCompare(displayName(b));
}

function displayName(candidate: EligibleRanger): string {
  return candidate.ranger.discord_display_name ?? candidate.ranger.discord_username ?? "";
}

function truncateField(value: string): string {
  if (value.length <= 1024) {
    return value;
  }

  return `${value.slice(0, 1020).trimEnd()}...`;
}

function promotionBallotsEmbed(
  guild: Guild,
  vote: NonNullable<Awaited<ReturnType<typeof getPromotionVote>>>,
  ballots: PromotionBallotWithVoter[]
): EmbedBuilder {
  const grouped = {
    promote: ballots.filter((entry) => entry.ballot.vote === "promote"),
    hold: ballots.filter((entry) => entry.ballot.vote === "hold"),
    abstain: ballots.filter((entry) => entry.ballot.vote === "abstain")
  };

  return emojiEmbed(guild, "promotion", `Promotion Ballots: ${vote.target_rank}`)
    .setDescription(`Vote ID: ${vote.id}`)
    .addFields(
      { name: `Yes (${grouped.promote.length})`, value: formatBallotGroup(grouped.promote), inline: false },
      { name: `No (${grouped.hold.length})`, value: formatBallotGroup(grouped.hold), inline: false },
      { name: `Abstain (${grouped.abstain.length})`, value: formatBallotGroup(grouped.abstain), inline: false }
    )
    .setColor(0x587c4a)
    .setTimestamp(new Date(vote.created_at));
}

function formatBallotGroup(ballots: PromotionBallotWithVoter[]): string {
  if (ballots.length === 0) {
    return "None.";
  }

  return truncateField(
    ballots
      .map((entry) => {
        const name = entry.voter?.discord_display_name ?? entry.voter?.discord_username ?? "Unknown Ranger";
        return `<@${entry.ballot.voter_discord_user_id}> - ${name}`;
      })
      .join("\n")
  );
}

function promotionApprovalEmbed(
  guild: Guild,
  ranger: NonNullable<Awaited<ReturnType<typeof approvePromotionVote>>>["promoted"],
  previousRank: NonNullable<Awaited<ReturnType<typeof approvePromotionVote>>>["previousRank"],
  vote: NonNullable<Awaited<ReturnType<typeof getPromotionVote>>>,
  ballots: PromotionBallotWithVoter[]
): EmbedBuilder {
  const yes = ballots.filter((entry) => entry.ballot.vote === "promote").length;
  const no = ballots.filter((entry) => entry.ballot.vote === "hold").length;
  const abstain = ballots.filter((entry) => entry.ballot.vote === "abstain").length;
  const embed = emojiEmbed(guild, "cape", "Promotion Approved", "symmetric")
    .setDescription(`<@${ranger.discord_user_id}> has been promoted from **${previousRank}** to **${ranger.current_rank}**. Their new rank has been entered on the Corps roster.`)
    .addFields(
      { name: "Previous Rank", value: previousRank, inline: true },
      { name: "New Rank", value: ranger.current_rank, inline: true },
      { name: "Final Tally", value: `Yes: ${yes} | No: ${no} | Abstain: ${abstain}`, inline: false }
    )
    .setColor(0x587c4a)
    .setTimestamp(new Date());

  if (vote.final_decision && !vote.final_decision.startsWith("Approved by")) {
    embed.addFields({ name: "Reason", value: vote.final_decision.slice(0, 1024) });
  }

  return embed;
}

async function getPromotionVoteCandidateName(candidateRangerId: string): Promise<string> {
  const candidate = await getRangerById(candidateRangerId);
  return candidate?.discord_display_name ?? candidate?.discord_username ?? "Unknown Ranger";
}
