import type { StringSelectMenuInteraction } from "discord.js";
import { env } from "../config/env.js";
import { getTrailmark, grantTrailmarkAccess, leaveTrailmark, NO_TRAILMARK_SELECT_VALUE } from "../services/trailmarkService.js";
import { captureRecentTrailmarkMessagesForIntel, recordTrailmarkVisitAndDeliver } from "../services/intelService.js";
import { UserFacingError } from "../utils/errors.js";
import { canUseTrailmarks } from "../utils/permissions.js";

export async function handleTrailmarkSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) {
    throw new UserFacingError("This menu can only be used in the configured guild.");
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!canUseTrailmarks(member)) {
    throw new UserFacingError("Apprentice or higher is required to use Trailmarks.");
  }

  await interaction.deferReply({ ephemeral: true });

  if (interaction.values[0] === NO_TRAILMARK_SELECT_VALUE) {
    const revoked = await leaveTrailmark(interaction.guild, interaction.user.id);
    await interaction.editReply({
      content: revoked > 0 ? "Trailmark access revoked." : "You do not have an active Trailmark session."
    });
    return;
  }

  const trailmark = await getTrailmark(interaction.values[0] ?? "");
  if (!trailmark || !trailmark.active) {
    throw new UserFacingError("Trailmark not found or inactive.");
  }

  await grantTrailmarkAccess({
    guild: interaction.guild,
    member,
    trailmark,
    minutes: env.DEFAULT_TRAILMARK_ACCESS_MINUTES
  });
  await interaction.editReply({
    content: `Opened <#${trailmark.discord_channel_id}>. Access expires in ${env.DEFAULT_TRAILMARK_ACCESS_MINUTES} minutes.`
  });

  void processTrailmarkIntel(interaction, trailmark).catch(async (error: unknown) => {
    console.error(`Failed to process intel for Trailmark ${trailmark.id}:`, error);
    await interaction.followUp({
      content: "Trailmark access was granted, but intel delivery failed. Please notify a Marshal.",
      ephemeral: true
    }).catch(() => undefined);
  });
}

async function processTrailmarkIntel(
  interaction: StringSelectMenuInteraction<"cached">,
  trailmark: NonNullable<Awaited<ReturnType<typeof getTrailmark>>>
): Promise<void> {
  await captureRecentTrailmarkMessagesForIntel({
    guild: interaction.guild,
    trailmark
  });
  const deliveredReports = await recordTrailmarkVisitAndDeliver({
    guild: interaction.guild,
    discordUserId: interaction.user.id,
    trailmark
  });
  if (deliveredReports > 0) {
    await interaction.followUp({
      content: `Delivered ${deliveredReports} report${deliveredReports === 1 ? "" : "s"} to HQ.`,
      ephemeral: true
    }).catch(() => undefined);
  }
}
