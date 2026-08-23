import { ChannelType, SlashCommandBuilder, type TextChannel } from "discord.js";
import {
  APPLICATION_TARGETS,
  configureApplicationChannels,
  isApplicationTarget,
  listPendingCorpsApplications,
  withdrawCorpsApplication
} from "../services/applicationService.js";
import { corpsApplicationModal } from "../services/applicationFormService.js";
import { getRangerByDiscordId } from "../services/rangerService.js";
import { UserFacingError } from "../utils/errors.js";
import { canOpenPromotionVotes, memberRankAtLeast } from "../utils/permissions.js";
import type { BotCommand } from "./types.js";

export const applicationCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("application")
    .setDescription("Apply for Corps duties or leadership consideration.")
    .addSubcommand((subcommand) => subcommand
      .setName("apply")
      .setDescription("Open a Corps duty or leadership application.")
      .addStringOption((option) => option
        .setName("position")
        .setDescription("Position you are applying for.")
        .setRequired(true)
        .addChoices(...APPLICATION_TARGETS.map((target) => ({ name: target, value: target })))))
    .addSubcommand((subcommand) => subcommand
      .setName("withdraw")
      .setDescription("Withdraw one of your pending applications.")
      .addStringOption((option) => option
        .setName("application")
        .setDescription("Your pending application.")
        .setRequired(true)
        .setAutocomplete(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("list")
      .setDescription("Marshal+: list pending Corps applications you can review."))
    .addSubcommand((subcommand) => subcommand
      .setName("setup")
      .setDescription("Commander: configure private leadership vote channels.")
      .addChannelOption((option) => option
        .setName("marshal_channel")
        .setDescription("Private Marshal+ channel for Marshal application votes.")
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText))
      .addChannelOption((option) => option
        .setName("captain_channel")
        .setDescription("Private Captain+ channel for Captain application votes.")
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText))),

  async autocomplete(interaction) {
    if (interaction.options.getSubcommand() !== "withdraw") {
      await interaction.respond([]);
      return;
    }
    const ranger = await getRangerByDiscordId(interaction.user.id);
    if (!ranger) {
      await interaction.respond([]);
      return;
    }
    const applications = await listPendingCorpsApplications(ranger.id);
    await interaction.respond(applications.slice(0, 25).map((details) => ({
      name: applicationLabel(details).slice(0, 100),
      value: details.application.id
    })));
  },

  async execute(interaction) {
    if (!interaction.inCachedGuild()) {
      throw new UserFacingError("Corps applications are only available in the Ranger Corps server.");
    }
    const subcommand = interaction.options.getSubcommand();
    const actor = await interaction.guild.members.fetch(interaction.user.id);

    if (subcommand === "apply") {
      const position = interaction.options.getString("position", true);
      if (!isApplicationTarget(position)) {
        throw new UserFacingError("That application position is not supported.");
      }
      await interaction.showModal(corpsApplicationModal(position));
      return;
    }

    if (subcommand === "withdraw") {
      await interaction.deferReply({ ephemeral: true });
      const details = await withdrawCorpsApplication({
        guild: interaction.guild,
        applicationId: interaction.options.getString("application", true),
        applicantDiscordUserId: interaction.user.id
      });
      await interaction.editReply({ content: `Withdrew your **${applicationLabel(details)}** application.` });
      return;
    }

    if (subcommand === "list") {
      if (!canOpenPromotionVotes(actor)) {
        throw new UserFacingError("Ranger Marshal or higher is required to list pending applications.");
      }
      await interaction.deferReply({ ephemeral: true });
      const applications = (await listPendingCorpsApplications()).filter((details) =>
        details.application.application_kind === "Captain"
          ? memberRankAtLeast(actor, "Ranger Captain")
          : true
      );
      const lines = applications.map((details) =>
        `<@${details.applicant.discord_user_id}> - **${applicationLabel(details)}**${details.application.strongbox_thread_id ? ` - <#${details.application.strongbox_thread_id}>` : ""}`
      );
      await interaction.editReply({ content: lines.join("\n").slice(0, 2000) || "There are no pending Corps applications." });
      return;
    }

    if (!memberRankAtLeast(actor, "Ranger Commander")) {
      throw new UserFacingError("Ranger Commander is required to configure leadership application channels.");
    }
    const marshalChannel = interaction.options.getChannel("marshal_channel", true);
    const captainChannel = interaction.options.getChannel("captain_channel", true);
    if (marshalChannel.type !== ChannelType.GuildText || captainChannel.type !== ChannelType.GuildText) {
      throw new UserFacingError("Both application destinations must be standard text channels.");
    }
    if (marshalChannel.id === captainChannel.id) {
      throw new UserFacingError("Marshal and Captain applications require separate private channels.");
    }
    await configureApplicationChannels({
      marshalChannel: marshalChannel as TextChannel,
      captainChannel: captainChannel as TextChannel
    });
    await interaction.reply({
      content: `Marshal application votes will open in ${marshalChannel}; Captain application votes will open in ${captainChannel}.`,
      ephemeral: true
    });
  }
};

function applicationLabel(details: Awaited<ReturnType<typeof listPendingCorpsApplications>>[number]): string {
  if (details.application.application_kind === "Marshal") {
    return "Ranger Marshal";
  }
  if (details.application.application_kind === "Captain") {
    return "Ranger Captain";
  }
  if (details.application.warden_scope === "hold_primary") {
    return `Ranger of ${details.application.parent_hold}`;
  }
  if (details.application.warden_scope === "local_range") {
    return `Warden of ${details.application.assignment_detail}`;
  }
  return details.duty?.name ?? "Corps Duty";
}
