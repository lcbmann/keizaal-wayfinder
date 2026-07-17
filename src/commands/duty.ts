import { SlashCommandBuilder, type GuildMember } from "discord.js";
import {
  DUTY_NAMES,
  assignDuty,
  createDutyApplication,
  listActiveDutyAssignments,
  listPendingDutyApplications,
  removeDuty,
  setupDutyRoles,
  withdrawDutyApplication
} from "../services/dutyService.js";
import { getStrongboxDropChannel } from "../services/strongboxService.js";
import { refreshStoredAssignmentsBoard } from "../services/assignmentBoardService.js";
import { canOpenPromotionVotes, canUseTrailmarks } from "../utils/permissions.js";
import { UserFacingError } from "../utils/errors.js";
import type { BotCommand } from "./types.js";

const dutyChoices = DUTY_NAMES.map((name) => ({ name, value: name }));

export const dutyCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("duty")
    .setDescription("Volunteer for and manage Ranger Corps duties.")
    .addSubcommand((subcommand) => subcommand
      .setName("volunteer")
      .setDescription("Submit a private application for a Corps duty.")
      .addStringOption((option) => option.setName("duty").setDescription("Duty to volunteer for.").setRequired(true).addChoices(...dutyChoices))
      .addStringOption((option) => option.setName("reason").setDescription("Why you want to take on this duty.").setRequired(true).setMaxLength(1500))
      .addStringOption((option) => option.setName("range_or_specialty").setDescription("Required Range for Wardens; optional specialty for Craftsmen.").setMaxLength(200)))
    .addSubcommand((subcommand) => subcommand
      .setName("withdraw")
      .setDescription("Withdraw one of your pending duty applications.")
      .addStringOption((option) => option.setName("duty").setDescription("Application to withdraw.").setRequired(true).addChoices(...dutyChoices)))
    .addSubcommand((subcommand) => subcommand
      .setName("assign")
      .setDescription("Marshal+: directly assign a Corps duty.")
      .addUserOption((option) => option.setName("member").setDescription("Ranger receiving the duty.").setRequired(true))
      .addStringOption((option) => option.setName("duty").setDescription("Duty to assign.").setRequired(true).addChoices(...dutyChoices))
      .addStringOption((option) => option.setName("range_or_specialty").setDescription("Required Range for Wardens; optional specialty for Craftsmen.").setMaxLength(200)))
    .addSubcommand((subcommand) => subcommand
      .setName("remove")
      .setDescription("Marshal+: remove a Corps duty.")
      .addUserOption((option) => option.setName("member").setDescription("Ranger losing the duty.").setRequired(true))
      .addStringOption((option) => option.setName("duty").setDescription("Duty to remove.").setRequired(true).addChoices(...dutyChoices))
      .addStringOption((option) => option.setName("reason").setDescription("Optional removal reason.").setMaxLength(500)))
    .addSubcommand((subcommand) => subcommand
      .setName("list")
      .setDescription("List current Corps duty holders.")
      .addStringOption((option) => option.setName("duty").setDescription("Limit the list to one duty.").addChoices(...dutyChoices)))
    .addSubcommand((subcommand) => subcommand.setName("applications").setDescription("Marshal+: list pending duty applications."))
    .addSubcommand((subcommand) => subcommand.setName("setup").setDescription("Marshal+: create or repair Corps duty roles.")),

  async execute(interaction) {
    if (!interaction.inCachedGuild()) {
      throw new UserFacingError("This command can only be used in the configured guild.");
    }
    const actor = await interaction.guild.members.fetch(interaction.user.id);
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "volunteer") {
      requireCorpsMember(actor);
      await requireStrongboxDrop(interaction.channelId, interaction.guild);
      await interaction.deferReply({ ephemeral: true });
      const details = await createDutyApplication({
        guild: interaction.guild,
        applicantDiscordUserId: interaction.user.id,
        dutyName: interaction.options.getString("duty", true),
        reason: interaction.options.getString("reason", true).trim(),
        assignmentDetail: interaction.options.getString("range_or_specialty")
      });
      await interaction.editReply({
        content: `Your ${details.duty.name} application was placed in the Strongbox for Marshal review.`
      });
      return;
    }

    if (subcommand === "withdraw") {
      requireCorpsMember(actor);
      await requireStrongboxDrop(interaction.channelId, interaction.guild);
      const dutyName = interaction.options.getString("duty", true);
      const withdrawn = await withdrawDutyApplication({
        guild: interaction.guild,
        discordUserId: interaction.user.id,
        dutyName
      });
      await interaction.reply({
        content: withdrawn ? `Withdrew your pending ${dutyName} application.` : `No pending ${dutyName} application was found.`,
        ephemeral: true
      });
      return;
    }

    if (subcommand === "list") {
      requireCorpsMember(actor);
      const dutyName = interaction.options.getString("duty") ?? undefined;
      const assignments = await listActiveDutyAssignments(dutyName);
      const lines = assignments.map(({ assignment, duty, ranger }) => {
        const detail = assignment.assignment_detail ? ` - ${assignment.assignment_detail}` : "";
        return `**${duty.name}:** <@${ranger.discord_user_id}>${detail}`;
      });
      await interaction.reply({ content: lines.length ? lines.join("\n") : "No active duty assignments found.", ephemeral: true });
      return;
    }

    requireMarshal(actor);

    if (subcommand === "setup") {
      await interaction.deferReply({ ephemeral: true });
      const duties = await setupDutyRoles(interaction.guild);
      await interaction.editReply({ content: `Duty roles are ready: ${duties.map((duty) => duty.name).join(", ")}.` });
      return;
    }

    if (subcommand === "applications") {
      const applications = await listPendingDutyApplications();
      const lines = applications.map(({ application, applicant, duty }) =>
        `<@${applicant.discord_user_id}> - **${duty.name}**${application.strongbox_thread_id ? ` - <#${application.strongbox_thread_id}>` : ""}`
      );
      await interaction.reply({ content: lines.length ? lines.join("\n") : "There are no pending duty applications.", ephemeral: true });
      return;
    }

    const member = interaction.options.getMember("member");
    if (!member) {
      throw new UserFacingError("That member is not available in this server.");
    }
    const dutyName = interaction.options.getString("duty", true);

    if (subcommand === "assign") {
      await interaction.deferReply({ ephemeral: true });
      const result = await assignDuty({
        guild: interaction.guild,
        rangerDiscordUserId: member.id,
        dutyName,
        assignmentDetail: interaction.options.getString("range_or_specialty"),
        assignedByDiscordUserId: interaction.user.id
      });
      await interaction.editReply({ content: `Assigned ${result.duty.name} to ${member}.` });
      await refreshStoredAssignmentsBoard(interaction.guild).catch((error) => {
        console.error("Failed to refresh assignments board after duty assignment:", error);
      });
      return;
    }

    if (subcommand === "remove") {
      await interaction.deferReply({ ephemeral: true });
      const result = await removeDuty({
        guild: interaction.guild,
        rangerDiscordUserId: member.id,
        dutyName,
        removedByDiscordUserId: interaction.user.id,
        reason: interaction.options.getString("reason")
      });
      await interaction.editReply({ content: result ? `Removed ${result.duty.name} from ${member}.` : `${member} does not hold ${dutyName}.` });
      await refreshStoredAssignmentsBoard(interaction.guild).catch((error) => {
        console.error("Failed to refresh assignments board after duty removal:", error);
      });
    }
  }
};

function requireCorpsMember(member: GuildMember): void {
  if (!canUseTrailmarks(member)) {
    throw new UserFacingError("Apprentice or higher is required to use Corps duty commands.");
  }
}

function requireMarshal(member: GuildMember): void {
  if (!canOpenPromotionVotes(member)) {
    throw new UserFacingError("Ranger Marshal or higher is required to manage Corps duties.");
  }
}

async function requireStrongboxDrop(channelId: string, guild: GuildMember["guild"]): Promise<void> {
  const dropChannel = await getStrongboxDropChannel(guild);
  if (!dropChannel) {
    throw new UserFacingError("The Strongbox has not been set up. Ask a Marshal to run `/strongbox setup`.");
  }
  if (channelId !== dropChannel.id) {
    throw new UserFacingError(`Submit duty applications in ${dropChannel}.`);
  }
}
