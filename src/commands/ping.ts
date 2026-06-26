import { SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "./types.js";

export const pingCommand: BotCommand = {
  data: new SlashCommandBuilder().setName("ping").setDescription("Check whether the Wayfinder bot is awake."),
  async execute(interaction) {
    await interaction.reply({ content: "Pong.", ephemeral: true });
  }
};
