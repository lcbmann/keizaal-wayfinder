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
    .addSubcommand((subcommand) => subcommand.setName("eligible").setDescription("Show eligible Apprentices."))
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
    if (subcommand === "approve") {
      await interaction.deferReply();
    }
    const actor = await interaction.guild.members.fetch(interaction.user.id);

    if (subcommand === "eligible") {
      if (!canOpenPromotionVotes(actor)) {
        throw new UserFacingError("Ranger Marshal or higher is required.");
      }

      const candidates = await listApprenticePromotionEligibility();
      const embed = promotionEligibilityEmbed(interaction.guild, candidates);

      await interaction.reply({ embeds: [embed], ephemeral: true });
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

function promotionEligibilityEmbed(guild: Guild, candidates: EligibleRanger[]): EmbedBuilder {
  const sortedCandidates = [...candidates].sort(compareEligibilityDisplayOrder);
  const visibleCandidates = sortedCandidates.slice(0, 20);
  const eligible = candidates.filter((candidate) => candidate.eligible).length;
  const blocked = candidates.length - eligible;

  const embed = emojiEmbed(guild, "promotion", "Apprentice Promotion Eligibility")
    .setDescription(
      candidates.length
        ? `${eligible} eligible / ${blocked} not eligible. Minimum time in Corps: ${env.PROMOTION_MIN_DAYS_APPRENTICE_TO_RANGER} days.`
        : "No Apprentices found."
    )
    .setColor(0x587c4a);

  if (visibleCandidates.length === 0) {
    return embed;
  }

  const eligibleLines = visibleCandidates.filter((candidate) => candidate.eligible).map(formatEligibilityLine);
  const blockedLines = visibleCandidates.filter((candidate) => !candidate.eligible).map(formatEligibilityLine);

  if (eligibleLines.length > 0) {
    embed.addFields({
      name: `Ready for Review (${eligibleLines.length})`,
      value: truncateField(eligibleLines.join("\n"))
    });
  }

  if (blockedLines.length > 0) {
    embed.addFields({
      name: `Not Yet Ready (${blockedLines.length})`,
      value: truncateField(blockedLines.join("\n"))
    });
  }

  if (candidates.length > visibleCandidates.length) {
    embed.setFooter({ text: `Showing first ${visibleCandidates.length} of ${candidates.length} Apprentices.` });
  }

  return embed;
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
  const name = r.discord_display_name ?? r.discord_username ?? "Unknown";
  const reason = candidate.eligible ? "meets current checks" : candidate.reasons.join("; ");
  return `${candidate.eligible ? "Ready" : "Hold"} <@${r.discord_user_id}> - ${name} - ${candidate.daysInCorps}d - ${r.status} - ${reason}`;
}

function compareEligibilityDisplayOrder(a: EligibleRanger, b: EligibleRanger): number {
  if (a.eligible !== b.eligible) {
    return a.eligible ? -1 : 1;
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
