import { ChannelType, type ButtonInteraction } from "discord.js";
import { env } from "../config/env.js";
import {
  APPRENTICESHIP_INFO_HINT,
  apprenticeshipConsentActionRow,
  apprenticeshipReviewActionRow,
  apprenticeshipReviewEmbed,
  respondToApprenticeshipProposal,
  reviewApprenticeSponsorship
} from "../services/apprenticeshipService.js";
import { canOpenPromotionVotes } from "../utils/permissions.js";
import { UserFacingError, errorMessage } from "../utils/errors.js";

export async function handleApprenticeshipButton(interaction: ButtonInteraction): Promise<void> {
  const [, action, apprenticeshipId, decision] = interaction.customId.split(":");
  if (!apprenticeshipId) {
    throw new UserFacingError("Invalid apprenticeship button.");
  }
  if (action === "consent" && (decision === "accept" || decision === "decline")) {
    await handleConsent(interaction, apprenticeshipId, decision === "accept");
    return;
  }
  if (action === "review" && (decision === "approve" || decision === "deny")) {
    await handleReview(interaction, apprenticeshipId, decision === "approve");
    return;
  }
  throw new UserFacingError("Invalid apprenticeship button.");
}

async function handleConsent(interaction: ButtonInteraction, apprenticeshipId: string, accept: boolean): Promise<void> {
  await interaction.deferUpdate();
  try {
    const guild = await interaction.client.guilds.fetch(env.DISCORD_GUILD_ID);
    await respondToApprenticeshipProposal({
      guild,
      apprenticeshipId,
      respondingDiscordUserId: interaction.user.id,
      accept
    });
    await interaction.message.edit({
      components: [apprenticeshipConsentActionRow(apprenticeshipId, true)]
    });
    await interaction.followUp({
      content: accept ? `Apprenticeship accepted. ${APPRENTICESHIP_INFO_HINT}` : "Apprenticeship declined."
    });
  } catch (error) {
    await interaction.followUp({
      content: error instanceof UserFacingError ? error.message : `Something went wrong: ${errorMessage(error)}`
    });
  }
}

async function handleReview(interaction: ButtonInteraction, apprenticeshipId: string, approve: boolean): Promise<void> {
  if (!interaction.inCachedGuild() || interaction.guildId !== env.DISCORD_GUILD_ID) {
    throw new UserFacingError("Apprentice sponsorships can only be reviewed in the Ranger Corps server.");
  }
  const actor = await interaction.guild.members.fetch(interaction.user.id);
  if (!canOpenPromotionVotes(actor)) {
    throw new UserFacingError("Ranger Marshal or higher is required to review apprentice sponsorships.");
  }

  await interaction.deferReply({ ephemeral: true });
  const details = await reviewApprenticeSponsorship({
    guild: interaction.guild,
    apprenticeshipId,
    reviewerDiscordUserId: interaction.user.id,
    approve
  });
  await interaction.message.edit({
    embeds: [apprenticeshipReviewEmbed(details)],
    components: [apprenticeshipReviewActionRow(apprenticeshipId, true)]
  });
  if (details.apprenticeship.strongbox_thread_id) {
    const thread = await interaction.guild.channels.fetch(details.apprenticeship.strongbox_thread_id).catch(() => null);
    if (thread?.type === ChannelType.PublicThread) {
      await thread.send(`${interaction.user} ${approve ? "approved" : "denied"} this sponsorship.`);
    }
  }
  await interaction.editReply({ content: approve ? "Sponsorship approved and Apprentice access granted." : "Sponsorship denied." });
}
