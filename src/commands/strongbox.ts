import { SlashCommandBuilder } from "discord.js";
import { dropStrongboxMessage, setupStrongboxChannels } from "../services/strongboxService.js";
import { UserFacingError } from "../utils/errors.js";
import { canCreateTrailmarks } from "../utils/permissions.js";
import type { BotCommand } from "./types.js";

export const strongboxCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("strongbox")
    .setDescription("Leave private reports for Ranger Marshal or higher.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("drop")
        .setDescription("Leave a private message in the HQ Strongbox.")
        .addStringOption((option) =>
          option
            .setName("message")
            .setDescription("Message for Ranger Marshal or higher.")
            .setRequired(true)
            .setMaxLength(4000)
        )
        .addAttachmentOption((option) => option.setName("attachment").setDescription("Optional supporting image or file."))
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("setup").setDescription("Create or repair the Marshal+ HQ Strongbox channel.")
    ),

  async execute(interaction) {
    if (!interaction.inCachedGuild()) {
      throw new UserFacingError("This command can only be used in the configured guild.");
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "setup") {
      const actor = await interaction.guild.members.fetch(interaction.user.id);
      if (!canCreateTrailmarks(actor)) {
        throw new UserFacingError("Ranger Marshal or higher is required to set up the HQ Strongbox.");
      }

      await interaction.deferReply({ ephemeral: true });
      const { privateChannel, dropChannel } = await setupStrongboxChannels(interaction.guild);
      await interaction.editReply({
        content: `HQ Strongbox is ready in ${privateChannel}. Members can leave messages in ${dropChannel}.`
      });
      return;
    }

    if (subcommand === "drop") {
      await interaction.deferReply({ ephemeral: true });
      const message = interaction.options.getString("message", true);
      const attachment = interaction.options.getAttachment("attachment");
      await dropStrongboxMessage({
        guild: interaction.guild,
        member: interaction.member,
        message,
        attachments: attachment ? [attachment] : []
      });
      await interaction.editReply({ content: "You place a sealed message in the HQ Strongbox for the Marshals." });
    }
  }
};
