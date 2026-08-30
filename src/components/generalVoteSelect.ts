import type { StringSelectMenuInteraction } from "discord.js";
import { generalVoteMessage, recordGeneralChoiceBallot } from "../services/generalVoteService.js";
import { UserFacingError } from "../utils/errors.js";

export async function handleGeneralVoteSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) {
    throw new UserFacingError("Votes can only be used inside a configured server.");
  }
  const [, , voteId] = interaction.customId.split(":");
  const selection = interaction.values[0];
  if (!voteId || !selection) {
    throw new UserFacingError("Invalid vote selection.");
  }

  await interaction.deferReply({ ephemeral: true });
  const label = await recordGeneralChoiceBallot({
    guild: interaction.guild,
    voteId,
    voterDiscordUserId: interaction.user.id,
    interactionChannelId: interaction.channelId,
    optionId: selection === "abstain" ? null : selection
  });
  await interaction.message.edit(await generalVoteMessage(voteId));
  await interaction.editReply({ content: `You voted for **${label}**.` });
}
