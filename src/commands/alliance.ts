import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { env } from "../config/env.js";
import {
  allianceBridgeConfigured,
  addAllianceGroup,
  getAllianceStatus,
  isAllianceGuildId,
  isAllianceLeader,
  removeAllianceGroup,
  setAllianceGroupTopics,
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
      subcommand.setName("sync").setDescription("Repair configured HQ channels without backfilling reports.")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("status").setDescription("Show Ranger Alliance bridge status.")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("group-add")
        .setDescription("Create an Alliance group, HQ Trailmark, and selected report channels.")
        .addStringOption((option) => option.setName("key").setDescription("Short unique key, such as dawnguard.").setRequired(true).setMaxLength(40))
        .addStringOption((option) => option.setName("order").setDescription("Group name shown on reports.").setRequired(true).setMaxLength(80))
        .addRoleOption((option) => option.setName("role").setDescription("Alliance role allowed to see this group's reports.").setRequired(true))
        .addStringOption((option) => option.setName("headquarters").setDescription("Name of the group's HQ location.").setRequired(true).setMaxLength(80))
        .addStringOption((option) => option.setName("hold").setDescription("Hold where the HQ Trailmark is located.").setRequired(true).setMaxLength(80))
        .addStringOption((option) => option.setName("description").setDescription("In-world description of the HQ cache.").setRequired(true).setMaxLength(1000))
        .addStringOption((option) => option.setName("topics").setDescription("Comma-separated topic names, slugs, or all.").setRequired(true).setMaxLength(500))
        .addStringOption((option) => option.setName("submit_emoji").setDescription("Emoji or custom emoji name for the report intake channel.").setMaxLength(100))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("group-topics")
        .setDescription("Change which intel topics an Alliance group can see.")
        .addStringOption((option) => option.setName("key").setDescription("Alliance group key.").setRequired(true).setMaxLength(40))
        .addStringOption((option) => option.setName("topics").setDescription("Comma-separated topic names, slugs, or all.").setRequired(true).setMaxLength(500))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("group-remove")
        .setDescription("Deactivate an Alliance group, HQ Trailmark, and report section.")
        .addStringOption((option) => option.setName("key").setDescription("Alliance group key.").setRequired(true).setMaxLength(40))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("headquarters-remove")
        .setDescription("Deactivate an Alliance group's headquarters and report section.")
        .addStringOption((option) => option.setName("key").setDescription("Alliance group key.").setRequired(true).setMaxLength(40))
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
    if (subcommand === "group-add") {
      const role = interaction.options.getRole("role", true);
      const result = await addAllianceGroup({
        client: interaction.client,
        key: interaction.options.getString("key", true),
        sourceOrder: interaction.options.getString("order", true),
        viewerRoleId: role.id,
        headquartersName: interaction.options.getString("headquarters", true),
        hold: interaction.options.getString("hold", true),
        description: interaction.options.getString("description", true),
        submissionEmoji: interaction.options.getString("submit_emoji") ?? undefined,
        topicNames: interaction.options.getString("topics", true)
      });
      await interaction.editReply([
        `Alliance group **${result.headquarters.source_order}** created.`,
        `HQ Trailmark: **${result.headquarters.name}**`,
        `Topic channels created: **${result.topicChannels}**`,
        `Reports backfilled from the last 7 days: **${result.backfilledReports}**`,
        "Future deliveries will continue to appear there automatically."
      ].join("\n"));
      return;
    }
    if (subcommand === "group-topics") {
      const topicChannels = await setAllianceGroupTopics({
        client: interaction.client,
        key: interaction.options.getString("key", true),
        topicNames: interaction.options.getString("topics", true)
      });
      await interaction.editReply([
        "Alliance group topics updated.",
        `Active topic channels: **${topicChannels}**`,
        "Newly enabled channels start empty; this does not backfill historical reports."
      ].join("\n"));
      return;
    }
    if (subcommand === "group-remove" || subcommand === "headquarters-remove") {
      await removeAllianceGroup({
        client: interaction.client,
        key: interaction.options.getString("key", true)
      });
      await interaction.editReply("Alliance group and its headquarters have been deactivated. Its channels were archived and no new reports will be published there.");
      return;
    }
    const result = await setupAllianceBridge(interaction.client);
    await interaction.editReply({
      content: [
        subcommand === "setup" ? "Ranger Alliance headquarters network set up." : "Ranger Alliance headquarters network synchronized.",
        `Headquarters configured: ${result.headquarters}`,
        `HQ topic channels: ${result.topicChannels}`,
        "Historical reports were not backfilled."
      ].join("\n")
    });
  }
};
