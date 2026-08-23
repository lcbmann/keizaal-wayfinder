import { SlashCommandBuilder, type GuildMember } from "discord.js";
import {
  DUTY_NAMES,
  assignDuty,
  listActiveDutyAssignments,
  removeDuty,
  setupDutyRoles
} from "../services/dutyService.js";
import { refreshStoredAssignmentsBoard } from "../services/assignmentBoardService.js";
import { HOLDS } from "../config/holds.js";
import type { WardenScope } from "../db/supabase.js";
import { canApprovePromotions, canOpenPromotionVotes, canUseTrailmarks } from "../utils/permissions.js";
import { UserFacingError } from "../utils/errors.js";
import type { BotCommand } from "./types.js";

const dutyChoices = DUTY_NAMES.map((name) => ({ name, value: name }));

export const dutyCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("duty")
    .setDescription("Manage active Ranger Corps duties. Use /application apply to volunteer.")
    .addSubcommand((subcommand) => subcommand
      .setName("assign")
      .setDescription("Marshal+: directly assign a Corps duty.")
      .addUserOption((option) => option.setName("member").setDescription("Ranger receiving the duty.").setRequired(true))
      .addStringOption((option) => option.setName("duty").setDescription("Duty to assign.").setRequired(true).addChoices(...dutyChoices))
      .addStringOption((option) => option
        .setName("warden_position")
        .setDescription("Required when assigning Warden.")
        .addChoices(
          { name: "Hold Warden (appointed as Ranger of the Hold)", value: "hold_primary" },
          { name: "Local Warden", value: "local_range" }
        ))
      .addStringOption((option) => option.setName("hold").setDescription("Parent Hold for a Warden appointment.").addChoices(...HOLDS.map((hold) => ({ name: hold, value: hold }))))
      .addStringOption((option) => option.setName("range_or_specialty").setDescription("Local Warden Range or optional Craftsman specialty.").setMaxLength(200)))
    .addSubcommand((subcommand) => subcommand
      .setName("remove")
      .setDescription("Marshal+: remove a Corps duty.")
      .addUserOption((option) => option.setName("member").setDescription("Ranger losing the duty.").setRequired(true))
      .addStringOption((option) => option.setName("duty").setDescription("Duty to remove.").setRequired(true).addChoices(...dutyChoices))
      .addStringOption((option) => option
        .setName("warden_position")
        .setDescription("Use when the Ranger has multiple Warden appointments.")
        .addChoices(
          { name: "Hold Warden (appointed as Ranger of the Hold)", value: "hold_primary" },
          { name: "Local Warden", value: "local_range" }
        ))
      .addStringOption((option) => option.setName("hold").setDescription("Parent Hold of the Warden appointment.").addChoices(...HOLDS.map((hold) => ({ name: hold, value: hold }))))
      .addStringOption((option) => option.setName("range").setDescription("Named local Range to remove.").setMaxLength(200))
      .addStringOption((option) => option.setName("reason").setDescription("Optional removal reason.").setMaxLength(500)))
    .addSubcommand((subcommand) => subcommand
      .setName("list")
      .setDescription("List current Corps duty holders.")
      .addStringOption((option) => option.setName("duty").setDescription("Limit the list to one duty.").addChoices(...dutyChoices)))
    .addSubcommand((subcommand) => subcommand.setName("setup").setDescription("Marshal+: create or repair Corps duty roles.")),

  async execute(interaction) {
    if (!interaction.inCachedGuild()) {
      throw new UserFacingError("This command can only be used in the configured guild.");
    }
    const actor = await interaction.guild.members.fetch(interaction.user.id);
    const subcommand = interaction.options.getSubcommand();

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

    const member = interaction.options.getMember("member");
    if (!member) {
      throw new UserFacingError("That member is not available in this server.");
    }
    const dutyName = interaction.options.getString("duty", true);

    if (subcommand === "assign") {
      const wardenScope = interaction.options.getString("warden_position") as WardenScope | null;
      if (dutyName === "Warden" && wardenScope === "hold_primary" && !canApprovePromotions(actor)) {
        throw new UserFacingError("Ranger Captain or higher is required to appoint a Hold Warden.");
      }
      await interaction.deferReply({ ephemeral: true });
      const result = await assignDuty({
        guild: interaction.guild,
        rangerDiscordUserId: member.id,
        dutyName,
        assignmentDetail: interaction.options.getString("range_or_specialty"),
        assignedByDiscordUserId: interaction.user.id,
        wardenScope,
        parentHold: interaction.options.getString("hold")
      });
      const appointment = result.assignment.warden_scope === "hold_primary"
        ? `Ranger of ${result.assignment.parent_hold}`
        : result.assignment.warden_scope === "local_range"
          ? `Warden of ${result.assignment.assignment_detail}`
          : result.duty.name;
      await interaction.editReply({ content: `Assigned **${appointment}** to ${member}.` });
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
        reason: interaction.options.getString("reason"),
        wardenScope: interaction.options.getString("warden_position") as WardenScope | null,
        parentHold: interaction.options.getString("hold"),
        assignmentDetail: interaction.options.getString("range")
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
