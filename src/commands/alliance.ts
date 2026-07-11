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
      subcommand.setName("setup").setDescription("Create report mirrors and backfill delivered Corps intel.")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("sync").setDescription("Repair channels and publish any missing reports.")
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
          { name: "Topic mirrors", value: String(status.topicChannels), inline: true },
          { name: "Corps reports mirrored", value: String(status.mirroredCorpsReports), inline: true },
          { name: "Alliance reports", value: String(status.allianceReports), inline: true },
          {
            name: "Corps Ally Reports",
            value: status.allyReportsChannelId ? `<#${status.allyReportsChannelId}>` : "Not created",
            inline: false
          }
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
        subcommand === "setup" ? "Ranger Alliance intel bridge set up." : "Ranger Alliance intel bridge synchronized.",
        `Topic mirrors: ${result.topicChannels}`,
        `New Corps reports mirrored: ${result.corpsReportsBackfilled}`,
        `Alliance reports synchronized: ${result.allianceReportsSynced}`,
        `Corps Ally Reports: <#${result.allyReportsChannelId}>`
      ].join("\n")
    });
  }
};
