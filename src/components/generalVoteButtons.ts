import type { ButtonInteraction } from "discord.js";
import type { GeneralBallotVote } from "../db/supabase.js";
import { generalVoteMessage, recordGeneralVoteBallot } from "../services/generalVoteService.js";
import { UserFacingError } from "../utils/errors.js";

export async function handleGeneralVoteButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) {
    throw new UserFacingError("Votes can only be used inside a configured server.");
  }
  const [, , voteId, ballot] = interaction.customId.split(":");
  if (!voteId || !isGeneralBallotVote(ballot)) {
    throw new UserFacingError("Invalid vote button.");
  }

  await interaction.deferReply({ ephemeral: true });
  await recordGeneralVoteBallot({
    guild: interaction.guild,
    voteId,
    voterDiscordUserId: interaction.user.id,
    interactionChannelId: interaction.channelId,
    ballot
  });
  await interaction.message.edit(await generalVoteMessage(voteId));
  await interaction.editReply({ content: `You cast your **${voteLabel(ballot)}** vote.` });
}

function isGeneralBallotVote(value: string | undefined): value is GeneralBallotVote {
  return value === "yes" || value === "no" || value === "abstain";
}

function voteLabel(vote: GeneralBallotVote): string {
  return vote === "yes" ? "Yes" : vote === "no" ? "No" : "Abstain";
}
