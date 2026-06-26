import { ChannelType, SlashCommandBuilder } from "discord.js";
import { env } from "../config/env.js";
import { UserFacingError } from "../utils/errors.js";
import { canOpenPromotionVotes } from "../utils/permissions.js";
import type { BotCommand } from "./types.js";

export const recruitCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("recruit")
    .setDescription("Recruitment support.")
    .addSubcommand((subcommand) => subcommand.setName("invite").setDescription("Create an onboarding invite.")),

  async execute(interaction) {
    if (!interaction.inCachedGuild()) {
      throw new UserFacingError("This command can only be used in the configured guild.");
    }

    const actor = await interaction.guild.members.fetch(interaction.user.id);
    if (!canOpenPromotionVotes(actor)) {
      throw new UserFacingError("Ranger Marshal or higher is required to create invites.");
    }

    if (!env.INVITE_CHANNEL_ID) {
      throw new UserFacingError("INVITE_CHANNEL_ID is not configured.");
    }

    const channel = await interaction.guild.channels.fetch(env.INVITE_CHANNEL_ID);
    if (!channel || channel.type !== ChannelType.GuildText) {
      throw new UserFacingError("INVITE_CHANNEL_ID must point to a text channel.");
    }

    const invite = await channel.createInvite({
      maxAge: 86_400,
      maxUses: 1,
      unique: true,
      reason: `Recruit invite created by ${interaction.user.tag}`
    });

    await interaction.reply({ content: invite.url, ephemeral: true });
  }
};
