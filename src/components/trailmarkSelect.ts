import type { StringSelectMenuInteraction } from "discord.js";
import { env } from "../config/env.js";
import { getTrailmark, grantTrailmarkAccess, leaveTrailmark, NO_TRAILMARK_SELECT_VALUE } from "../services/trailmarkService.js";
import { captureRecentTrailmarkMessagesForIntel, recordTrailmarkVisitAndDeliver } from "../services/intelService.js";
import { UserFacingError } from "../utils/errors.js";
import { emojiText } from "../utils/guildEmojis.js";
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
      content: emojiText(
        interaction.guild,
        "trailmark",
        revoked > 0 ? "You close the cache and leave it as you found it." : "You do not have an open Trailmark cache."
      )
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
    content: emojiText(
      interaction.guild,
      "trailmark",
      `You open the cache at <#${trailmark.discord_channel_id}>. You may read or leave notes there for the next ${env.DEFAULT_TRAILMARK_ACCESS_MINUTES} minutes.`
    )
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
  const delivery = await recordTrailmarkVisitAndDeliver({
    guild: interaction.guild,
    discordUserId: interaction.user.id,
    trailmark
  });
  if (delivery.corpsHeadquarters > 0 || delivery.allianceHeadquarters > 0) {
    const deliveryLines: string[] = [];
    if (delivery.corpsHeadquarters > 0) {
      deliveryLines.push(
        `You deliver ${delivery.corpsHeadquarters} report${delivery.corpsHeadquarters === 1 ? "" : "s"} to Ranger Corps Headquarters.`
      );
    }
    if (delivery.allianceHeadquarters > 0 && delivery.allianceHeadquartersName) {
      deliveryLines.push(
        `You deliver ${delivery.allianceHeadquarters} report${delivery.allianceHeadquarters === 1 ? "" : "s"} to ${delivery.allianceHeadquartersName}.`
      );
    }
    await interaction.followUp({
      content: emojiText(
        interaction.guild,
        "intel",
        `${deliveryLines.join("\n")} They have been added to the relevant report channels.`
      ),
      ephemeral: true
    }).catch(() => undefined);
  }
}
