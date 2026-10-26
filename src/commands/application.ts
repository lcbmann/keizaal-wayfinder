import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, SlashCommandBuilder, type TextChannel } from "discord.js";
import {
  configureApplicationChannels,
  listPendingCorpsApplications,
  withdrawCorpsApplication
} from "../services/applicationService.js";
import { configuredCorpsApplicationModal } from "../services/applicationFormService.js";
import { APPLICATION_CONFIG_MODAL_PREFIX, APPLICATION_CONFIG_OPEN_PREFIX, applicationConfigurationModal, getApplicationPosition, listApplicationPositions, setApplicationPositionEnabled } from "../services/applicationConfigurationService.js";
import { MAIN_RANKS, type MainRank } from "../config/ranks.js";
import { dutyDisplayName } from "../services/dutyService.js";
import { getRangerByDiscordId } from "../services/rangerService.js";
import { UserFacingError } from "../utils/errors.js";
import { canManageAll, canOpenPromotionVotes, memberRankAtLeast } from "../utils/permissions.js";
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
        .setAutocomplete(true)))
    .addSubcommand((subcommand) => subcommand.setName("configure").setDescription("Captain+: create or edit an application form.")
      .addStringOption((option) => option.setName("position").setDescription("Existing position or new duty name.").setRequired(true).setMaxLength(32).setAutocomplete(true))
      .addRoleOption((option) => option.setName("role").setDescription("Discord duty role granted when an application is approved."))
      .addStringOption((option) => option.setName("minimum_rank").setDescription("Minimum applicant rank, default Ranger.").addChoices(...MAIN_RANKS.map((rank) => ({ name: rank, value: rank }))))
      .addStringOption((option) => option.setName("replaces").setDescription("Old duty names to consolidate, comma separated. For example: Warden,Instructor").setMaxLength(300)))
    .addSubcommand((subcommand) => subcommand.setName("disable").setDescription("Captain+: close an application without deleting its history.")
      .addStringOption((option) => option.setName("position").setDescription("Application to close.").setRequired(true).setAutocomplete(true)))
    .addSubcommand((subcommand) => subcommand.setName("enable").setDescription("Captain+: reopen an application.")
      .addStringOption((option) => option.setName("position").setDescription("Application to reopen.").setRequired(true).setAutocomplete(true)))
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
      .setDescription("Captain+: configure private leadership application review channels.")
      .addChannelOption((option) => option
        .setName("marshal_channel")
        .setDescription("Private Marshal+ channel for reviewing Marshal applications.")
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText))
      .addChannelOption((option) => option
        .setName("captain_channel")
        .setDescription("Private Captain+ channel for reviewing Captain applications.")
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText))),

  async autocomplete(interaction) {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand !== "withdraw") {
      if (!interaction.inCachedGuild() || (subcommand !== "apply" && !canManageAll(interaction.member))) {
        await interaction.respond([]);
        return;
      }
      const query = interaction.options.getFocused().toLowerCase();
      const positions = (await listApplicationPositions()).filter((position) => position.key.toLowerCase().includes(query)
        && (subcommand !== "apply" || position.enabled && memberRankAtLeast(interaction.member, position.minimumRank)));
      await interaction.respond(positions.slice(0, 25).map(({ key }) => ({ name: key, value: key })));
      return;
    }
    if (!interaction.inCachedGuild()) {
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
    if (subcommand === "apply") {
      const position = await getApplicationPosition(interaction.options.getString("position", true));
      if (!memberRankAtLeast(interaction.member, position.minimumRank)) throw new UserFacingError(`${position.key} requires ${position.minimumRank} or higher.`);
      await interaction.showModal(configuredCorpsApplicationModal(position));
      return;
    }
    const actor = await interaction.guild.members.fetch(interaction.user.id);
    if (["configure", "disable", "enable"].includes(subcommand)) {
      if (!canManageAll(actor)) throw new UserFacingError("Captain or higher is required to configure applications.");
      const positionName = interaction.options.getString("position", true);
      if (subcommand === "configure") {
        await interaction.deferReply({ ephemeral: true });
        const selectedRole = interaction.options.getRole("role");
        const role = selectedRole ? await interaction.guild.roles.fetch(selectedRole.id) : null;
        const modal = await applicationConfigurationModal({ guild: interaction.guild, actor,
          positionName, role, minimumRank: interaction.options.getString("minimum_rank") as MainRank | null,
          replaces: interaction.options.getString("replaces") ?? "" });
        const draftId = modal.data.custom_id!.slice(APPLICATION_CONFIG_MODAL_PREFIX.length);
        await interaction.editReply({ content: `Edit **${positionName}**. Saving will also consolidate any positions listed in \`replaces\`.`,
          components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder()
            .setCustomId(`${APPLICATION_CONFIG_OPEN_PREFIX}${draftId}`).setLabel("Edit questions").setStyle(ButtonStyle.Primary))] });
      } else {
        await interaction.deferReply({ ephemeral: true });
        const key = await setApplicationPositionEnabled(positionName, subcommand === "enable", actor.id);
        await interaction.editReply({ content: `**${key}** applications are ${subcommand === "enable" ? "open" : "closed"}. Existing records have been kept.` });
      }
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
        throw new UserFacingError("Marshal or higher is required to list pending applications.");
      }
      await interaction.deferReply({ ephemeral: true });
      const applications = (await listPendingCorpsApplications()).filter((details) =>
        details.application.application_kind === "Captain"
          ? memberRankAtLeast(actor, "Captain")
          : true
      );
      const lines = applications.map((details) =>
        `<@${details.applicant.discord_user_id}> - **${applicationLabel(details)}**${details.application.strongbox_thread_id ? ` - <#${details.application.strongbox_thread_id}>` : ""}`
      );
      await interaction.editReply({ content: lines.join("\n").slice(0, 2000) || "There are no pending Corps applications." });
      return;
    }

    if (!canManageAll(actor)) {
      throw new UserFacingError("Captain or higher is required to configure leadership application channels.");
    }
    const marshalChannel = interaction.options.getChannel("marshal_channel", true);
    const captainChannel = interaction.options.getChannel("captain_channel", true);
    if (marshalChannel.type !== ChannelType.GuildText || captainChannel.type !== ChannelType.GuildText) {
      throw new UserFacingError("Both application destinations must be standard text channels.");
    }
    if (marshalChannel.id === captainChannel.id) {
      throw new UserFacingError("Marshal and Captain applications require separate private channels.");
    }
    await interaction.deferReply({ ephemeral: true });
    await configureApplicationChannels({
      marshalChannel: marshalChannel as TextChannel,
      captainChannel: captainChannel as TextChannel
    });
    await interaction.editReply({
      content: `Marshal applications will be reviewed in ${marshalChannel}; Captain applications will be reviewed in ${captainChannel}. Approved applications will move to the configured Ranger promotion channel for a Ranger-wide vote.`,
    });
  }
};

function applicationLabel(details: Awaited<ReturnType<typeof listPendingCorpsApplications>>[number]): string {
  if (details.application.application_kind === "Marshal") {
    return "Marshal";
  }
  if (details.application.application_kind === "Captain") {
    return "Captain";
  }
  if (details.application.warden_scope === "hold_primary") {
    return `Ranger of ${details.application.parent_hold}`;
  }
  if (details.application.warden_scope === "local_range") {
    return `Warden of ${details.application.assignment_detail}`;
  }
  return details.duty ? dutyDisplayName(details.duty) : "Corps Duty";
}
