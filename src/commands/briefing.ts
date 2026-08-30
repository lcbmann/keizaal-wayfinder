import { ChannelType, SlashCommandBuilder } from "discord.js";
import type { BriefingAudience, BriefingKind } from "../db/supabase.js";
import {
  createBriefingDispatchModal,
  setBriefingDmEnabled,
  setupBriefingDesk
} from "../services/briefingService.js";
import { UserFacingError } from "../utils/errors.js";
import { mainRankFromMember, memberRankAtLeast } from "../utils/permissions.js";
import type { BotCommand } from "./types.js";

export const briefingCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("briefing")
    .setDescription("Collect and maintain Ranger Headquarters briefings.")
    .addSubcommand((subcommand) => subcommand
      .setName("setup")
      .setDescription("Marshal+: place the Headquarters Dispatch Desk in a channel.")
      .addChannelOption((option) => option
        .setName("channel")
        .setDescription("Read-only channel for the persistent briefing desk.")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("send")
      .setDescription("Marshal+: file an IC dispatch or a small OOC note.")
      .addStringOption((option) => option
        .setName("audience")
        .setDescription("Who should receive this in their next briefing.")
        .setRequired(true)
        .addChoices(
          { name: "All Corps Members", value: "apprentice_plus" },
          { name: "Ranger+", value: "ranger_plus" },
          { name: "Marshal+", value: "marshal_plus" },
          { name: "Captain+", value: "captain_plus" },
          { name: "One Corps Member", value: "individual" }
        ))
      .addUserOption((option) => option
        .setName("recipient")
        .setDescription("Required only when filing for one Corps member."))
      .addStringOption((option) => option
        .setName("kind")
        .setDescription("IC dispatch by default; use OOC sparingly.")
        .addChoices(
          { name: "In-character dispatch", value: "ic" },
          { name: "OOC note", value: "ooc" }
        )))
    .addSubcommand((subcommand) => subcommand
      .setName("settings")
      .setDescription("Choose whether collected briefings are sent to your DMs.")
      .addBooleanOption((option) => option
        .setName("dm_enabled")
        .setDescription("When off, the packet appears only in the private command response.")
        .setRequired(true))),

  async execute(interaction) {
    if (!interaction.inCachedGuild()) {
      throw new UserFacingError("Briefings are only available in the Ranger Corps server.");
    }
    const actor = await interaction.guild.members.fetch(interaction.user.id);
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "settings") {
      if (!mainRankFromMember(actor)) {
        throw new UserFacingError("An Apprentice or Ranger Corps rank is required to change briefing settings.");
      }
      const enabled = interaction.options.getBoolean("dm_enabled", true);
      await interaction.deferReply({ ephemeral: true });
      await setBriefingDmEnabled(interaction.guild.id, actor.id, enabled);
      await interaction.editReply({
        content: enabled
          ? "Collected briefings will be sent to your DMs."
          : "Collected briefings will appear only in the private command response."
      });
      return;
    }

    if (!memberRankAtLeast(actor, "Ranger Marshal")) {
      throw new UserFacingError("Ranger Marshal or higher is required to maintain Headquarters briefings.");
    }

    if (subcommand === "setup") {
      const channel = interaction.options.getChannel("channel", true);
      if (channel.type !== ChannelType.GuildText) {
        throw new UserFacingError("Choose a normal text channel for the Dispatch Desk.");
      }
      await interaction.deferReply({ ephemeral: true });
      await setupBriefingDesk(interaction.guild, channel);
      await interaction.editReply({ content: `The Headquarters Dispatch Desk is ready in ${channel}.` });
      return;
    }

    if (subcommand === "send") {
      const audience = interaction.options.getString("audience", true) as BriefingAudience;
      const kind = (interaction.options.getString("kind") ?? "ic") as BriefingKind;
      const recipient = interaction.options.getUser("recipient");
      if (audience === "individual" && !recipient) {
        throw new UserFacingError("Choose the Corps member who should receive this dispatch.");
      }
      if (audience !== "individual" && recipient) {
        throw new UserFacingError("Only choose a recipient when the audience is One Corps Member.");
      }
      if (recipient) {
        const recipientMember = await interaction.guild.members.fetch(recipient.id).catch(() => null);
        if (!recipientMember || !mainRankFromMember(recipientMember)) {
          throw new UserFacingError("The selected recipient is not an Apprentice or ranked Ranger Corps member.");
        }
      }
      await interaction.showModal(createBriefingDispatchModal({
        kind,
        audience,
        targetDiscordUserId: recipient?.id ?? null
      }));
    }
  }
};
