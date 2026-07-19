import { SlashCommandBuilder } from "discord.js";
import { guildEmoji } from "../utils/guildEmojis.js";
import type { BotCommand } from "./types.js";

export const pingCommand: BotCommand = {
  data: new SlashCommandBuilder().setName("ping").setDescription("Check whether the Wayfinder bot is awake."),
  async execute(interaction) {
    const emoji = interaction.guild ? guildEmoji(interaction.guild, "wayfinder") : "";
    await interaction.reply({ content: `${emoji ? `${emoji} ` : ""}Wayfinder is awake.`, ephemeral: true });
  }
};
