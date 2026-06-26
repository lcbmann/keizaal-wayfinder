import { SlashCommandBuilder } from "discord.js";
import { exportRosterCsv } from "../services/rosterExportService.js";
import { UserFacingError } from "../utils/errors.js";
import { canOpenPromotionVotes } from "../utils/permissions.js";
import { csvAttachment } from "./ranger.js";
import type { BotCommand } from "./types.js";

export const rosterCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("roster")
    .setDescription("Roster exports.")
    .addSubcommand((subcommand) => subcommand.setName("export").setDescription("Export the Ranger roster as CSV.")),

  async execute(interaction) {
    if (!interaction.inCachedGuild()) {
      throw new UserFacingError("This command can only be used in the configured guild.");
    }

    const actor = await interaction.guild.members.fetch(interaction.user.id);
    if (!canOpenPromotionVotes(actor)) {
      throw new UserFacingError("Ranger Marshal or higher is required to export the roster.");
    }

    const csv = await exportRosterCsv();
    await interaction.reply({
      content: "Roster export generated.",
      files: [csvAttachment(csv)],
      ephemeral: true
    });
  }
};
