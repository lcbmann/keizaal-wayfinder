import { ChannelType, type ButtonInteraction } from "discord.js";
import {
  dutyApplicationActionRow,
  dutyApplicationEmbed,
  reviewDutyApplication
} from "../services/dutyService.js";
import { canOpenPromotionVotes } from "../utils/permissions.js";
import { UserFacingError } from "../utils/errors.js";

export async function handleDutyButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) {
    throw new UserFacingError("Duty applications can only be reviewed in the Ranger Corps server.");
  }
  const [, action, applicationId, decision] = interaction.customId.split(":");
  if (action !== "review" || !applicationId || (decision !== "approve" && decision !== "deny")) {
    throw new UserFacingError("Invalid duty application button.");
  }

  const actor = await interaction.guild.members.fetch(interaction.user.id);
  if (!canOpenPromotionVotes(actor)) {
    throw new UserFacingError("Ranger Marshal or higher is required to review duty applications.");
  }

  await interaction.deferReply({ ephemeral: true });
  const details = await reviewDutyApplication({
    guild: interaction.guild,
    applicationId,
    reviewerDiscordUserId: interaction.user.id,
    approve: decision === "approve"
  });
  await interaction.message.edit({
    embeds: [dutyApplicationEmbed(details)],
    components: [dutyApplicationActionRow(applicationId, true)]
  });

  if (details.application.strongbox_thread_id) {
    const thread = await interaction.guild.channels.fetch(details.application.strongbox_thread_id).catch(() => null);
    if (thread?.type === ChannelType.PublicThread) {
      await thread.send(`${interaction.user} ${decision === "approve" ? "approved" : "denied"} this application.`);
    }
  }
  await interaction.editReply({ content: `${details.duty.name} application ${decision === "approve" ? "approved" : "denied"}.` });
}
