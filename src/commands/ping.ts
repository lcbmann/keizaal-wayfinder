import { SlashCommandBuilder } from "discord.js";
import { emojiText } from "../utils/guildEmojis.js";
import type { BotCommand } from "./types.js";

export const pingCommand: BotCommand = {
  data: new SlashCommandBuilder().setName("ping").setDescription("Check whether the Wayfinder bot is awake."),
  async execute(interaction) {
    const content = interaction.guild
      ? emojiText(interaction.guild, "wayfinder", "Wayfinder is awake.")
      : "Wayfinder is awake.";
    await interaction.reply({ content, ephemeral: true });
  }
};
