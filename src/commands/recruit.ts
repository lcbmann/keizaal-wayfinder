import { ChannelType, SlashCommandBuilder } from "discord.js";
import { env } from "../config/env.js";
import { UserFacingError } from "../utils/errors.js";
import { canOpenPromotionVotes } from "../utils/permissions.js";
import type { BotCommand } from "./types.js";

export const recruitCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("recruit")
    .setDescription("Recruitment support.")
    .addSubcommand((subcommand) => subcommand.setName("invite").setDescription("Create an onboarding invite."))
    .addSubcommand((subcommand) =>
      subcommand
        .setName("welcome")
        .setDescription("Send a recruit onboarding checklist.")
        .addUserOption((option) => option.setName("user").setDescription("Recruit to welcome.").setRequired(true))
    ),

  async execute(interaction) {
    if (!interaction.inCachedGuild()) {
      throw new UserFacingError("This command can only be used in the configured guild.");
    }

    const actor = await interaction.guild.members.fetch(interaction.user.id);
    if (!canOpenPromotionVotes(actor)) {
      throw new UserFacingError("Ranger Marshal or higher is required for recruitment tools.");
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "welcome") {
      const user = interaction.options.getUser("user", true);
      await user.send(recruitWelcomeMessage()).catch(() => {
        throw new UserFacingError("I could not DM that recruit. They may have DMs disabled.");
      });
      await interaction.reply({ content: `Sent onboarding checklist to ${user}.`, ephemeral: true });
      return;
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

function recruitWelcomeMessage(): string {
  return [
    "Welcome to the Ranger Corps.",
    "",
    "Before your first patrol:",
    "- Set your server nickname to your in-game character name.",
    "- Read the Corps rules and Trailmark guidance.",
    "- Ask a Ranger Marshal or Captain if you need an assigned hold.",
    "- Use Trailmarks only when your character has physically visited the cache in-game.",
    "- Keep reports short, useful, and in-character.",
    "",
    "If you need help, ask a Marshal or Captain."
  ].join("\n");
}
