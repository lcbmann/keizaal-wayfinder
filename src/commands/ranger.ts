import { AttachmentBuilder, EmbedBuilder, SlashCommandBuilder, type GuildMember } from "discord.js";
import { HOLDS } from "../config/holds.js";
import { MAIN_RANKS, isMainRank, rankSort, type MainRank } from "../config/ranks.js";
import type { RangerRow, RangerStatus } from "../db/supabase.js";
import {
  canApprovePromotions,
  canManageAll,
  canOpenPromotionVotes,
  memberRankAtLeast
} from "../utils/permissions.js";
import { daysBetween } from "../utils/dates.js";
import { UserFacingError } from "../utils/errors.js";
import {
  getRangerByDiscordId,
  listAllRangers,
  listRangersWithAssignedHolds,
  promoteRanger,
  setRangerHold,
  setRangerStatus,
  syncAllRankedMembers,
  syncMemberToRoster,
  updateRangerNotes
} from "../services/rangerService.js";
import { setMemberHoldRole, syncAssignedHoldRoles } from "../services/holdRoleService.js";
import type { BotCommand } from "./types.js";

const statuses: RangerStatus[] = ["Active", "Inactive", "On Leave", "Retired"];
const leadershipRanks: MainRank[] = ["Ranger Commander", "Ranger Captain", "Ranger Marshal"];

export const rangerCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("ranger")
    .setDescription("Roster and Ranger Corps member tools.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("info")
        .setDescription("Show a Ranger roster entry.")
        .addUserOption((option) => option.setName("user").setDescription("Member to inspect."))
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("assignments").setDescription("Post Ranger leadership and hold assignments.")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("sync-member")
        .setDescription("Refresh one member from Discord roles and display name.")
        .addUserOption((option) => option.setName("user").setDescription("Member to sync."))
    )
    .addSubcommand((subcommand) => subcommand.setName("sync-all").setDescription("Sync all members with Ranger rank roles."))
    .addSubcommand((subcommand) =>
      subcommand
        .setName("status")
        .setDescription("Set a Ranger status.")
        .addUserOption((option) => option.setName("user").setDescription("Member to update.").setRequired(true))
        .addStringOption((option) =>
          option
            .setName("status")
            .setDescription("New status.")
            .setRequired(true)
            .addChoices(...statuses.map((status) => ({ name: status, value: status })))
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set-hold")
        .setDescription("Set a Ranger assigned hold or range.")
        .addUserOption((option) => option.setName("user").setDescription("Member to update.").setRequired(true))
        .addStringOption((option) =>
          option
            .setName("hold")
            .setDescription("Assigned hold.")
            .setRequired(true)
            .addChoices(...HOLDS.map((hold) => ({ name: hold, value: hold })))
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("sync-hold-roles").setDescription("Create and sync assigned hold roles for the current roster.")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("note")
        .setDescription("Set or append roster notes.")
        .addUserOption((option) => option.setName("user").setDescription("Member to update.").setRequired(true))
        .addStringOption((option) => option.setName("note").setDescription("Note text.").setRequired(true))
        .addBooleanOption((option) => option.setName("append").setDescription("Append instead of replacing notes."))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("promote")
        .setDescription("Manually promote or assign a main Ranger rank.")
        .addUserOption((option) => option.setName("user").setDescription("Member to promote.").setRequired(true))
        .addStringOption((option) =>
          option
            .setName("rank")
            .setDescription("Target main rank.")
            .setRequired(true)
            .addChoices(...MAIN_RANKS.map((rank) => ({ name: rank, value: rank })))
        )
        .addStringOption((option) => option.setName("reason").setDescription("Reason for rank history."))
    ),

  async execute(interaction) {
    if (!interaction.inCachedGuild()) {
      throw new UserFacingError("This command can only be used in the configured guild.");
    }

    const actor = await interaction.guild.members.fetch(interaction.user.id);
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "info") {
      const user = interaction.options.getUser("user") ?? interaction.user;
      const ranger = await getRangerByDiscordId(user.id);
      if (!ranger) {
        await interaction.reply({ content: "No roster entry found.", ephemeral: true });
        return;
      }

      await interaction.reply({ embeds: [rangerEmbed(ranger.discord_user_id, ranger)], ephemeral: true });
      return;
    }

    if (subcommand === "assignments") {
      if (!canOpenPromotionVotes(actor)) {
        throw new UserFacingError("Ranger Marshal or higher is required to post assignments.");
      }

      const rangers = await listAllRangers();
      await interaction.reply({ embeds: [assignmentsEmbed(rangers)] });
      return;
    }

    if (subcommand === "sync-member") {
      const user = interaction.options.getUser("user") ?? interaction.user;
      if (user.id !== interaction.user.id && !canOpenPromotionVotes(actor)) {
        throw new UserFacingError("Ranger Marshal or higher is required to sync another member.");
      }

      const member = await interaction.guild.members.fetch(user.id);
      const ranger = await syncMemberToRoster(member, interaction.user.id);
      await interaction.reply({
        content: ranger ? `Synced ${member.displayName} as ${ranger.current_rank}.` : "No Ranger rank role found; roster was not changed.",
        ephemeral: true
      });
      return;
    }

    if (subcommand === "sync-all") {
      if (!canManageAll(actor)) {
        throw new UserFacingError("Ranger Captain or higher is required to sync the full roster.");
      }

      await interaction.deferReply({ ephemeral: true });
      const members = await interaction.guild.members.fetch();
      const count = await syncAllRankedMembers(members.values() as Iterable<GuildMember>, interaction.user.id);
      await interaction.editReply({ content: `Synced ${count} ranked members.` });
      return;
    }

    if (subcommand === "status") {
      requireMarshal(actor);
      const user = interaction.options.getUser("user", true);
      const status = interaction.options.getString("status", true) as RangerStatus;
      const ranger = await setRangerStatus(user.id, status);
      await interaction.reply({ content: `Set ${user} to ${ranger.status}.`, ephemeral: true });
      return;
    }

    if (subcommand === "set-hold") {
      const user = interaction.options.getUser("user", true);
      if (user.id !== interaction.user.id && !canOpenPromotionVotes(actor)) {
        throw new UserFacingError("Ranger Marshal or higher is required to set another Ranger's hold.");
      }

      if (user.id === interaction.user.id && !memberRankAtLeast(actor, "Ranger")) {
        throw new UserFacingError("Ranger or higher is required to set your own assigned hold.");
      }

      const member = user.id === interaction.user.id ? actor : await interaction.guild.members.fetch(user.id);
      const synced = await syncMemberToRoster(member, interaction.user.id);
      if (!synced) {
        throw new UserFacingError("That member does not have a Ranger rank role, so no roster entry can be updated.");
      }

      const hold = interaction.options.getString("hold", true);
      const ranger = await setRangerHold(user.id, hold);
      const role = await setMemberHoldRole(member, hold);
      await interaction.reply({
        content: `Set ${user}'s assigned hold to ${ranger.assigned_hold} and assigned ${role}.`,
        ephemeral: true
      });
      return;
    }

    if (subcommand === "sync-hold-roles") {
      if (!canManageAll(actor)) {
        throw new UserFacingError("Ranger Captain or higher is required to sync assigned hold roles.");
      }

      await interaction.deferReply({ ephemeral: true });
      const rangers = await listRangersWithAssignedHolds();
      const result = await syncAssignedHoldRoles(interaction.guild, rangers);
      await interaction.editReply({
        content: `Synced ${result.synced} assigned hold roles. Skipped ${result.skipped}.`
      });
      return;
    }

    if (subcommand === "note") {
      requireMarshal(actor);
      const user = interaction.options.getUser("user", true);
      const note = interaction.options.getString("note", true);
      const append = interaction.options.getBoolean("append") ?? true;
      await updateRangerNotes(user.id, note, append);
      await interaction.reply({ content: `Updated notes for ${user}.`, ephemeral: true });
      return;
    }

    if (subcommand === "promote") {
      if (!canApprovePromotions(actor)) {
        throw new UserFacingError("Ranger Captain or higher is required to manually promote.");
      }

      const user = interaction.options.getUser("user", true);
      const rank = interaction.options.getString("rank", true);
      if (!isMainRank(rank)) {
        throw new UserFacingError("Invalid target rank.");
      }

      const member = await interaction.guild.members.fetch(user.id);
      const reason = interaction.options.getString("reason");
      const ranger = await promoteRanger({
        member,
        targetRank: rank,
        changedByDiscordUserId: interaction.user.id,
        ...(reason ? { reason } : {})
      });
      await interaction.reply({ content: `Promoted ${user} to ${ranger.current_rank}.`, ephemeral: false });
      return;
    }
  }
};

function requireMarshal(member: GuildMember): void {
  if (!canOpenPromotionVotes(member)) {
    throw new UserFacingError("Ranger Marshal or higher is required.");
  }
}

function rangerEmbed(discordUserId: string, ranger: Awaited<ReturnType<typeof getRangerByDiscordId>>): EmbedBuilder {
  if (!ranger) {
    throw new UserFacingError("No roster entry found.");
  }

  return new EmbedBuilder()
    .setTitle(ranger.discord_display_name ?? ranger.discord_username ?? "Ranger")
    .setDescription(`<@${discordUserId}>`)
    .addFields(
      { name: "Rank", value: ranger.current_rank, inline: true },
      { name: "Status", value: ranger.status, inline: true },
      { name: "Join Date", value: `${ranger.join_date} (${daysBetween(ranger.join_date)} days)`, inline: true },
      { name: "Assigned Hold", value: ranger.assigned_hold ?? "Unassigned", inline: true },
      { name: "In-Game Name", value: ranger.in_game_name ?? "Unknown", inline: true },
      { name: "Notes", value: ranger.notes?.slice(0, 1024) || "None" }
    )
    .setColor(0x587c4a);
}

export function csvAttachment(csv: string): AttachmentBuilder {
  return new AttachmentBuilder(Buffer.from(csv, "utf8"), { name: "ranger-roster.csv" });
}

function assignmentsEmbed(rangers: RangerRow[]): EmbedBuilder {
  const sortedRangers = [...rangers].sort(compareRangersForDisplay);
  const embed = new EmbedBuilder()
    .setTitle("Ranger Corps Assignments")
    .setDescription("Current senior command and assigned hold coverage.")
    .setColor(0x587c4a)
    .setTimestamp(new Date());

  for (const rank of leadershipRanks) {
    const ranked = sortedRangers.filter((ranger) => ranger.current_rank === rank);
    embed.addFields({
      name: rank,
      value: ranked.length ? truncateField(ranked.map(formatAssignmentRanger).join("\n")) : "None assigned."
    });
  }

  for (const hold of HOLDS) {
    const assigned = sortedRangers.filter((ranger) => ranger.assigned_hold === hold);
    embed.addFields({
      name: hold,
      value: assigned.length ? truncateField(assigned.map(formatAssignmentRanger).join("\n")) : "None assigned."
    });
  }

  return embed;
}

function formatAssignmentRanger(ranger: RangerRow): string {
  const status = ranger.status === "Active" ? "" : ` (${ranger.status})`;
  return `<@${ranger.discord_user_id}> - ${ranger.discord_display_name ?? ranger.discord_username ?? "Unknown"}${status}`;
}

function compareRangersForDisplay(a: RangerRow, b: RangerRow): number {
  const rankDiff = rankSort(a.current_rank) - rankSort(b.current_rank);
  if (rankDiff !== 0) {
    return rankDiff;
  }

  return displayName(a).localeCompare(displayName(b));
}

function displayName(ranger: RangerRow): string {
  return ranger.discord_display_name ?? ranger.discord_username ?? "";
}

function truncateField(value: string): string {
  if (value.length <= 1024) {
    return value;
  }

  return `${value.slice(0, 1020).trimEnd()}...`;
}
