import { AttachmentBuilder, ChannelType, EmbedBuilder, SlashCommandBuilder, type GuildMember } from "discord.js";
import { HOLDS } from "../config/holds.js";
import { MAIN_RANKS, isMainRank, rankAtLeast } from "../config/ranks.js";
import { roleIdForRank } from "../config/roles.js";
import type { RangerRow, RangerStatus } from "../db/supabase.js";
import {
  canApprovePromotions,
  canManageAll,
  canOpenPromotionVotes
} from "../utils/permissions.js";
import { daysBetween } from "../utils/dates.js";
import { UserFacingError } from "../utils/errors.js";
import {
  getRangerByDiscordId,
  listAllRangers,
  listRangersWithAssignedHolds,
  promoteRanger,
  retireDepartedRanger,
  setRangerHold,
  setRangerStatus,
  syncAllRankedMembers,
  syncMemberToRoster,
  updateRangerNotes
} from "../services/rangerService.js";
import { clearMemberHoldRole, setMemberHoldRole, syncAssignedHoldRoles } from "../services/holdRoleService.js";
import { isRankRoleSyncExempt } from "../services/discordRoleService.js";
import { postAssignmentsBoard, refreshStoredAssignmentsBoard } from "../services/assignmentBoardService.js";
import { mainRankFromMember } from "../utils/permissions.js";
import type { BotCommand } from "./types.js";

const statuses: RangerStatus[] = ["Active", "Inactive", "On Leave", "Retired"];

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
    .addSubcommand((subcommand) => subcommand.setName("audit").setDescription("Check roster and Discord role drift."))
    .addSubcommand((subcommand) =>
      subcommand
        .setName("inactive-review")
        .setDescription("Show Rangers with old or missing tracked activity.")
        .addIntegerOption((option) =>
          option.setName("days").setDescription("Activity age threshold.").setMinValue(1).setMaxValue(365)
        )
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
        .setName("retire-left")
        .setDescription("Mark a roster entry Retired after the Discord user has left.")
        .addStringOption((option) =>
          option
            .setName("discord_user_id")
            .setDescription("Discord user ID from the roster.")
            .setRequired(true)
            .setMinLength(17)
            .setMaxLength(20)
        )
    )
    .addSubcommand((subcommand) => {
      subcommand
        .setName("set-hold")
        .setDescription("Set or remove assigned holds for one or more Rangers.")
        .addUserOption((option) => option.setName("user").setDescription("Member to update.").setRequired(true))
        .addStringOption((option) =>
          option
            .setName("hold")
            .setDescription("Assigned hold.")
            .setRequired(true)
            .addChoices(
              { name: "Unassigned", value: "__unassigned__" },
              ...HOLDS.map((hold) => ({ name: hold, value: hold }))
            )
        );
      for (let index = 2; index <= 10; index += 1) {
        subcommand.addUserOption((option) =>
          option.setName(`user_${index}`).setDescription(`Additional member ${index}.`)
        );
      }
      return subcommand;
    })
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

      const channel = interaction.channel;
      if (!channel || channel.type !== ChannelType.GuildText) {
        throw new UserFacingError("Assignments can only be posted in a text channel.");
      }

      await postAssignmentsBoard(channel);
      await interaction.reply({ content: "Ranger assignments board posted.", ephemeral: true });
      return;
    }

    if (subcommand === "audit") {
      if (!canManageAll(actor)) {
        throw new UserFacingError("Ranger Captain or higher is required to audit the roster.");
      }

      await interaction.deferReply({ ephemeral: true });
      const members = await interaction.guild.members.fetch();
      const rangers = await listAllRangers();
      await interaction.editReply({ embeds: [rosterAuditEmbed([...members.values()], rangers)] });
      return;
    }

    if (subcommand === "inactive-review") {
      if (!canOpenPromotionVotes(actor)) {
        throw new UserFacingError("Ranger Marshal or higher is required.");
      }

      const days = interaction.options.getInteger("days") ?? 14;
      const rangers = await listAllRangers();
      await interaction.reply({ embeds: [inactiveReviewEmbed(rangers, days)], ephemeral: true });
      return;
    }

    if (subcommand === "sync-member") {
      const user = interaction.options.getUser("user") ?? interaction.user;
      if (!canOpenPromotionVotes(actor)) {
        throw new UserFacingError("Ranger Marshal or higher is required to sync members.");
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
      if (!canOpenPromotionVotes(actor)) {
        throw new UserFacingError("Ranger Marshal or higher is required to sync the full roster.");
      }

      await interaction.deferReply({ ephemeral: true });
      const members = await interaction.guild.members.fetch();
      const count = await syncAllRankedMembers(members.values() as Iterable<GuildMember>, interaction.user.id);
      await interaction.editReply({ content: `Synced ${count} ranked members.` });
      await refreshStoredAssignmentsBoard(interaction.guild);
      return;
    }

    if (subcommand === "status") {
      requireMarshal(actor);
      const user = interaction.options.getUser("user", true);
      const status = interaction.options.getString("status", true) as RangerStatus;
      const ranger = await setRangerStatus(user.id, status);
      await refreshStoredAssignmentsBoard(interaction.guild);
      await interaction.reply({ content: `Set ${user} to ${ranger.status}.`, ephemeral: true });
      return;
    }

    if (subcommand === "retire-left") {
      requireMarshal(actor);
      const discordUserId = interaction.options.getString("discord_user_id", true).trim();
      if (!/^\d{17,20}$/.test(discordUserId)) {
        throw new UserFacingError("Discord user ID must be a numeric snowflake.");
      }

      const ranger = await retireDepartedRanger(discordUserId);
      if (!ranger) {
        await interaction.reply({ content: "No roster entry exists for that Discord user ID.", ephemeral: true });
        return;
      }

      await refreshStoredAssignmentsBoard(interaction.guild);
      await interaction.reply({
        content: `Set ${ranger.discord_display_name ?? ranger.discord_username ?? discordUserId} to Retired.`,
        ephemeral: true
      });
      return;
    }

    if (subcommand === "set-hold") {
      if (!canOpenPromotionVotes(actor)) {
        throw new UserFacingError("Ranger Marshal or higher is required to set assigned holds.");
      }

      const users = [interaction.options.getUser("user", true)];
      for (let index = 2; index <= 10; index += 1) {
        const user = interaction.options.getUser(`user_${index}`);
        if (user) {
          users.push(user);
        }
      }
      if (new Set(users.map((user) => user.id)).size !== users.length) {
        throw new UserFacingError("Each member can only be included once.");
      }

      const holdValue = interaction.options.getString("hold", true);
      const hold = holdValue === "__unassigned__" ? null : holdValue;
      const members = await Promise.all(users.map((user) =>
        user.id === interaction.user.id ? actor : interaction.guild.members.fetch(user.id)
      ));
      const synced = await Promise.all(members.map((member) => syncMemberToRoster(member, interaction.user.id)));
      if (synced.some((ranger) => !ranger)) {
        throw new UserFacingError("Every selected member must have a Ranger rank role.");
      }

      for (let index = 0; index < users.length; index += 1) {
        const user = users[index];
        const member = members[index];
        if (!user || !member) {
          throw new UserFacingError("Could not resolve every selected member.");
        }
        await setRangerHold(user.id, hold);
        if (hold) {
          await setMemberHoldRole(member, hold);
        } else {
          await clearMemberHoldRole(member);
        }
      }
      await interaction.reply({
        content: hold
          ? `Set ${users.join(", ")}'s assigned hold to ${hold}.`
          : `Removed hold assignments from ${users.join(", ")}.`,
        ephemeral: true
      });
      await refreshStoredAssignmentsBoard(interaction.guild);
      return;
    }

    if (subcommand === "sync-hold-roles") {
      if (!canOpenPromotionVotes(actor)) {
        throw new UserFacingError("Ranger Marshal or higher is required to sync assigned hold roles.");
      }

      await interaction.deferReply({ ephemeral: true });
      const rangers = await listRangersWithAssignedHolds();
      const result = await syncAssignedHoldRoles(interaction.guild, rangers);
      await interaction.editReply({
        content: `Synced ${result.synced} assigned hold roles. Skipped ${result.skipped}.`
      });
      await refreshStoredAssignmentsBoard(interaction.guild);
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
      await refreshStoredAssignmentsBoard(interaction.guild);
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

function rosterAuditEmbed(members: GuildMember[], rangers: RangerRow[]): EmbedBuilder {
  const rangersByDiscordId = new Map(rangers.map((ranger) => [ranger.discord_user_id, ranger]));
  const issues: string[] = [];

  for (const member of members) {
    const discordRank = mainRankFromMember(member);
    const ranger = rangersByDiscordId.get(member.id);

    if (discordRank && !ranger) {
      issues.push(`${member} has ${discordRank} in Discord but no roster row.`);
    }

    if (discordRank && ranger && ranger.current_rank !== discordRank) {
      issues.push(`${member} is ${discordRank} in Discord but ${ranger.current_rank} in roster.`);
    }

    if (discordRank && ranger && ["Inactive", "Retired"].includes(ranger.status)) {
      issues.push(`${member} is ${ranger.status} but still has ${discordRank} role.`);
    }
  }

  for (const ranger of rangers) {
    const member = members.find((guildMember) => guildMember.id === ranger.discord_user_id);
    if (!member) {
      issues.push(`${ranger.discord_display_name ?? ranger.discord_username ?? ranger.discord_user_id} has a roster row but is not in the server cache.`);
      continue;
    }

    const expectedRoleId = roleIdForRank(ranger.current_rank);
    if (!member.roles.cache.has(expectedRoleId)) {
      issues.push(`${member} roster rank is ${ranger.current_rank}, but that Discord role is missing.`);
    }

    const missingLowerRanks = isRankRoleSyncExempt(member.id)
      ? []
      : MAIN_RANKS.filter((rank) => rankAtLeast(ranger.current_rank, rank))
          .filter((rank) => !member.roles.cache.has(roleIdForRank(rank)));
    if (missingLowerRanks.length > 0) {
      issues.push(`${member} is missing cumulative role(s): ${missingLowerRanks.join(", ")}.`);
    }

    const extraHigherRanks = MAIN_RANKS.filter((rank) => !rankAtLeast(ranger.current_rank, rank))
      .filter((rank) => member.roles.cache.has(roleIdForRank(rank)));
    if (extraHigherRanks.length > 0) {
      issues.push(`${member} has higher role(s) above roster rank ${ranger.current_rank}: ${extraHigherRanks.join(", ")}.`);
    }
  }

  const embed = new EmbedBuilder()
    .setTitle("Roster Audit")
    .setDescription(issues.length ? truncateField(issues.slice(0, 25).join("\n")) : "No roster drift found.")
    .setColor(issues.length ? 0xa64d3f : 0x587c4a)
    .setTimestamp(new Date());

  if (issues.length > 25) {
    embed.setFooter({ text: `Showing first 25 of ${issues.length} issues.` });
  }

  return embed;
}

function inactiveReviewEmbed(rangers: RangerRow[], days: number): EmbedBuilder {
  const cutoff = Date.now() - days * 86_400_000;
  const candidates = rangers
    .filter((ranger) => ranger.status === "Active")
    .filter((ranger) => !ranger.last_discord_activity_at || new Date(ranger.last_discord_activity_at).getTime() < cutoff)
    .sort((a, b) => activitySortValue(a) - activitySortValue(b));

  const lines = candidates.slice(0, 25).map((ranger) => {
    const activity = ranger.last_discord_activity_at
      ? `${daysBetween(ranger.last_discord_activity_at.slice(0, 10))}d ago`
      : "Unknown";
    return `<@${ranger.discord_user_id}> - ${ranger.discord_display_name ?? ranger.discord_username ?? "Unknown"} - ${ranger.current_rank} - last activity ${activity}`;
  });

  const embed = new EmbedBuilder()
    .setTitle("Inactive Review")
    .setDescription(lines.length ? lines.join("\n") : `No active Rangers are missing activity for ${days}+ days.`)
    .setColor(0x587c4a)
    .setTimestamp(new Date());

  if (candidates.length > 25) {
    embed.setFooter({ text: `Showing first 25 of ${candidates.length} Rangers.` });
  }

  return embed;
}

function activitySortValue(ranger: RangerRow): number {
  return ranger.last_discord_activity_at ? new Date(ranger.last_discord_activity_at).getTime() : 0;
}

function truncateField(value: string): string {
  if (value.length <= 4096) {
    return value;
  }

  return `${value.slice(0, 4092).trimEnd()}...`;
}
