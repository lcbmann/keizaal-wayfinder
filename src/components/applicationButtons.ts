import type { ButtonInteraction } from "discord.js";
import { corpsApplicationEmbed, reviewCorpsApplication } from "../services/applicationService.js";
import { refreshStoredAssignmentsBoard } from "../services/assignmentBoardService.js";
import { UserFacingError } from "../utils/errors.js";

export async function handleApplicationButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) {
    throw new UserFacingError("Corps applications can only be reviewed in the Ranger Corps server.");
  }
  const [, action, applicationId, decision] = interaction.customId.split(":");
  if (action !== "review" || !applicationId || (decision !== "approve" && decision !== "deny")) {
    throw new UserFacingError("Invalid Corps application button.");
  }
  const reviewer = await interaction.guild.members.fetch(interaction.user.id);
  await interaction.deferReply({ ephemeral: true });
  const result = await reviewCorpsApplication({
    guild: interaction.guild,
    applicationId,
    reviewer,
    approve: decision === "approve"
  });
  await interaction.message.edit({ embeds: [corpsApplicationEmbed(interaction.guild, result)], components: [] });
  if (decision === "approve" && result.application.application_kind === "Duty") {
    await refreshStoredAssignmentsBoard(interaction.guild).catch((error) => {
      console.error("Failed to refresh assignments board after application approval:", error);
    });
  }
  await interaction.editReply({
    content: result.promotionVoteId
      ? "Application approved; the promotion vote is now open."
      : `Application ${decision === "approve" ? "approved" : "denied"}.`
  });
}
