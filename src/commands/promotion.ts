import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { MAIN_RANKS, isMainRank } from "../config/ranks.js";
import { env } from "../config/env.js";
import {
  approvePromotionVote,
  attachPromotionVoteMessage,
  closePromotionVote,
  createPromotionVote,
  denyPromotionVote,
  findOpenPromotionVotes,
  listApprenticePromotionEligibility,
  promotionVoteActionRow,
  promotionVoteEmbed,
  type EligibleRanger
} from "../services/promotionService.js";
import { getRangerByDiscordId } from "../services/rangerService.js";
import { UserFacingError } from "../utils/errors.js";
import { canApprovePromotions, canOpenPromotionVotes } from "../utils/permissions.js";
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
    ),

  async autocomplete(interaction) {
    const votes = await findOpenPromotionVotes();
    await interaction.respond(votes.map((vote) => ({ name: `${vote.target_rank} vote ${vote.id.slice(0, 8)}`, value: vote.id })));
  },

  async execute(interaction) {
    if (!interaction.inCachedGuild()) {
      throw new UserFacingError("This command can only be used in the configured guild.");
    }

    const actor = await interaction.guild.members.fetch(interaction.user.id);
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "eligible") {
      if (!canOpenPromotionVotes(actor)) {
        throw new UserFacingError("Ranger Marshal or higher is required.");
      }

      const candidates = await listApprenticePromotionEligibility();
      const embed = promotionEligibilityEmbed(candidates);

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
        embeds: [await promotionVoteEmbed(vote)],
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

      const ranger = await approvePromotionVote({
        guild: interaction.guild,
        voteId: interaction.options.getString("vote", true),
        approverDiscordUserId: interaction.user.id
      });
      await interaction.reply({ content: `Approved promotion vote. <@${ranger.discord_user_id}> is now ${ranger.current_rank}.` });
      return;
    }

    if (subcommand === "deny") {
      if (!canApprovePromotions(actor)) {
        throw new UserFacingError("Ranger Captain or higher is required.");
      }

      await denyPromotionVote(interaction.options.getString("vote", true), interaction.user.id);
      await interaction.reply({ content: "Promotion vote denied." });
    }
  }
};

const mentionRoleOptionNames = ["mentions", "mentions_2", "mentions_3", "mentions_4", "mentions_5"] as const;

function promotionEligibilityEmbed(candidates: EligibleRanger[]): EmbedBuilder {
  const sortedCandidates = [...candidates].sort(compareEligibilityDisplayOrder);
  const visibleCandidates = sortedCandidates.slice(0, 20);
  const eligible = candidates.filter((candidate) => candidate.eligible).length;
  const blocked = candidates.length - eligible;

  const embed = new EmbedBuilder()
    .setTitle("Apprentice Promotion Eligibility")
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

function formatEligibilityLine(candidate: EligibleRanger): string {
  const r = candidate.ranger;
  const name = r.discord_display_name ?? r.discord_username ?? "Unknown";
  const reason = candidate.eligible ? "meets current checks" : candidate.reasons.join("; ");
  return `${candidate.eligible ? "Ready" : "Hold"} <@${r.discord_user_id}> · ${name} · ${candidate.daysInCorps}d · ${r.status} · ${reason}`;
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
