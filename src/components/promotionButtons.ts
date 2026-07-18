import type { ButtonInteraction } from "discord.js";
import type { BallotVote } from "../db/supabase.js";
import { recordPromotionBallot, refreshPromotionVoteMessage } from "../services/promotionService.js";
import { UserFacingError } from "../utils/errors.js";

export async function handlePromotionButton(interaction: ButtonInteraction): Promise<void> {
  const [, , voteId, vote] = interaction.customId.split(":");
  if (!voteId || !isBallotVote(vote)) {
    throw new UserFacingError("Invalid promotion vote button.");
  }

  await recordPromotionBallot(voteId, interaction.user.id, vote);
  await interaction.update(await refreshPromotionVoteMessage(voteId));
  await interaction.followUp({ content: `You cast your **${voteLabel(vote)}** vote.`, ephemeral: true });
}

function isBallotVote(value: string | undefined): value is BallotVote {
  return value === "promote" || value === "hold" || value === "abstain";
}

function voteLabel(vote: BallotVote): string {
  if (vote === "promote") {
    return "Yes";
  }

  if (vote === "hold") {
    return "No";
  }

  return "Abstain";
}
