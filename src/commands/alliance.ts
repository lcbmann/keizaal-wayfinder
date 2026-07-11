import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { env } from "../config/env.js";
import {
  allianceBridgeConfigured,
  getAllianceStatus,
  isAllianceGuildId,
  isAllianceLeader,
  setupAllianceBridge
} from "../services/allianceIntelService.js";
import { UserFacingError } from "../utils/errors.js";
import type { BotCommand } from "./types.js";

export const allianceCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("alliance")
    .setDescription("Manage the Ranger Alliance intel bridge.")
    .addSubcommand((subcommand) =>
      subcommand.setName("setup").setDescription("Create allied HQ Trailmarks and private intel sections.")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("sync").setDescription("Repair HQ channels and migrate stored allied reports.")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("status").setDescription("Show Ranger Alliance bridge status.")
    ),

  async execute(interaction) {
    if (!interaction.inCachedGuild() || !isAllianceGuildId(interaction.guildId)) {
      throw new UserFacingError("Use this command in the Ranger Alliance server.");
    }
    if (!allianceBridgeConfigured()) {
      throw new UserFacingError("Ranger Alliance environment configuration is incomplete.");
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (!isAllianceLeader(member)) {
      throw new UserFacingError("The Ranger Alliance Leaders role is required.");
    }
    if (interaction.channelId !== env.RANGER_ALLIANCE_ADMIN_CHANNEL_ID) {
      throw new UserFacingError(`Use this command in <#${env.RANGER_ALLIANCE_ADMIN_CHANNEL_ID}>.`);
    }

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "status") {
      const status = await getAllianceStatus();
      const embed = new EmbedBuilder()
        .setTitle("Ranger Alliance Intel Bridge")
        .setDescription(status.configured ? "Configured and active." : "Not configured in Supabase.")
        .addFields(
          { name: "Headquarters", value: String(status.headquarters), inline: true },
          { name: "HQ topic channels", value: String(status.topicChannels), inline: true },
          { name: "HQ deliveries", value: String(status.deliveredReports), inline: true },
          { name: "Alliance reports", value: String(status.allianceReports), inline: true },
        )
        .setColor(0x4f6f91)
        .setTimestamp(new Date());
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const result = await setupAllianceBridge(interaction.client);
    await interaction.editReply({
      content: [
        subcommand === "setup" ? "Ranger Alliance headquarters network set up." : "Ranger Alliance headquarters network synchronized.",
        `Headquarters configured: ${result.headquarters}`,
        `HQ topic channels: ${result.topicChannels}`,
        `Alliance reports migrated: ${result.allianceReportsMigrated}`
      ].join("\n")
    });
  }
};
