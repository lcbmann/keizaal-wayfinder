import { PermissionsBitField, SlashCommandBuilder } from "discord.js";
import { HOLDS } from "../config/holds.js";
import { env } from "../config/env.js";
import { buildPatrolSuggestion } from "../services/patrolSuggestionService.js";
import { UserFacingError } from "../utils/errors.js";
import { mainRankFromMember } from "../utils/permissions.js";
import type { BotCommand } from "./types.js";

export const patrolCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("patrol")
    .setDescription("Ask Wayfinder for a patrol route.")
    .addSubcommand((subcommand) => subcommand
      .setName("suggest")
      .setDescription("Suggest a route using Corps Trailmark and contact records.")
      .addStringOption((option) => option
        .setName("hold")
        .setDescription("Choose a Hold or leave blank for your assigned Hold.")
        .addChoices(...HOLDS.map((hold) => ({ name: hold, value: hold }))))),

  async execute(interaction) {
    if (!interaction.inCachedGuild()) {
      throw new UserFacingError("Patrol suggestions are only available in the Ranger Corps server.");
    }
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (!mainRankFromMember(member)) {
      throw new UserFacingError("An Apprentice or Ranger Corps rank is required for patrol suggestions.");
    }
    const canUseAnywhere = member.permissions.has(PermissionsBitField.Flags.Administrator);
    if (!canUseAnywhere && interaction.channelId !== env.GENERAL_CHANNEL_ID) {
      throw new UserFacingError("Use `/patrol suggest` in #general.");
    }
    await interaction.deferReply();
    const suggestion = await buildPatrolSuggestion({
      guild: interaction.guild,
      member,
      requestedHold: interaction.options.getString("hold")
    });
    await interaction.editReply({ embeds: [suggestion.embed] });
  }
};
