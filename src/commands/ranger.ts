import { AttachmentBuilder, ChannelType, EmbedBuilder, PermissionsBitField, SlashCommandBuilder, type GuildMember } from "discord.js";
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
  getRangerProfileStats,
  listAllRangers,
  listRangersWithAssignedHolds,
  promoteRanger,
  retireDepartedRanger,
  setRangerHold,
  setRangerStatus,
  syncAllRankedMembers,
  syncCorpsJoinHistory,
  syncMemberToRoster,
  updateRangerNotes
} from "../services/rangerService.js";
import { syncAssignedHoldRoles } from "../services/holdRoleService.js";
import { postAssignmentsBoard, refreshStoredAssignmentsBoard } from "../services/assignmentBoardService.js";
import { mainRankFromMember } from "../utils/permissions.js";
import type { BotCommand } from "./types.js";
import {
  ensureWardenDutyForHold,
  endActiveDutyAssignmentsForRanger,
  listActiveDutyAssignments,
  removeDuty,
  syncHoldWardenAssignments
} from "../services/dutyService.js";
import { refreshFieldNamesBulletin } from "../services/fieldNameService.js";
import { highestCorpsTitle, listDiscordRoleMedals } from "../services/atlasDiscordProfileService.js";
import { emojiText } from "../utils/guildEmojis.js";
import { env } from "../config/env.js";
import { listRangerMedalAwards, medalEmoji } from "../services/medalService.js";
import { closeSupersededPromotionVotes } from "../services/promotionService.js";
import { collectRangerBriefing } from "../services/briefingService.js";

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
      subcommand.setName("briefing").setDescription("Collect dispatches waiting for you at Headquarters.")
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
        .setName("sync-join-history")
        .setDescription("Marshal+: sync exact Corps entry times from a welcome channel.")
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Channel containing Discord member-join messages.")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
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
    .addSubcommand((subcommand) =>
      subcommand
        .setName("clear-hold")
        .setDescription("Captain+: remove a Hold Warden appointment, including for departed members.")
        .addStringOption((option) =>
          option
            .setName("discord_user_id")
            .setDescription("Discord user ID from the roster.")
            .setRequired(true)
            .setMinLength(17)
            .setMaxLength(20)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set-hold")
        .setDescription("Captain+: appoint a Hold Warden as the Ranger of that Hold.")
        .addUserOption((option) => option.setName("user").setDescription("Ranger to appoint.").setRequired(true))
        .addStringOption((option) =>
          option
            .setName("hold")
            .setDescription("Hold they will represent and coordinate.")
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
      const canUseInfoAnywhere = actor.permissions.has(PermissionsBitField.Flags.Administrator) || canManageAll(actor);
      if (!canUseInfoAnywhere && (interaction.channel?.type !== ChannelType.GuildText || interaction.channel.id !== env.GENERAL_CHANNEL_ID)) {
        throw new UserFacingError("/ranger info can only be used in #general.");
      }

      const user = interaction.options.getUser("user") ?? interaction.user;
      const ranger = await getRangerByDiscordId(user.id);
      if (!ranger) {
        await interaction.reply({ content: "No roster entry found.", ephemeral: true });
        return;
      }

      await interaction.deferReply();
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      const [dutyEntries, stats, medalAwards] = await Promise.all([
        listActiveDutyAssignments(),
        getRangerProfileStats(ranger),
        listRangerMedalAwards(ranger.id)
      ]);
      const duties = dutyEntries
        .filter((entry) => entry.ranger.id === ranger.id)
        .map((entry) => entry.duty.name === "Warden" && entry.assignment.assignment_detail
          ? formatWardenDuty(entry.assignment.assignment_detail, entry.assignment.warden_scope)
          : entry.duty.name);
      const roleMedals = member
        ? listDiscordRoleMedals(member).map(({ label, emojiName, rolePosition }) => ({
            text: emojiText(interaction.guild, emojiName, label),
            rolePosition
          }))
        : [];
      const awardedMedals = medalAwards.map(({ medal }) => {
        const emoji = medalEmoji(interaction.guild, medal);
        return {
          text: `${emoji ? `${emoji} - ` : ""}${medal.name}`,
          rolePosition: medal.discord_role_id
            ? member?.roles.cache.get(medal.discord_role_id)?.position ?? -1
            : -1
        };
      });
      const ranksAndRoles = roleMedals
        .sort((a, b) => b.rolePosition - a.rolePosition || a.text.localeCompare(b.text))
        .map((entry) => entry.text);
      const corpsMedals = awardedMedals
        .sort((a, b) => b.rolePosition - a.rolePosition || a.text.localeCompare(b.text))
        .map((entry) => entry.text);
      const avatarUrl = member?.displayAvatarURL({ extension: "png", size: 256 }) ?? user.displayAvatarURL({ extension: "png", size: 256 });
      await interaction.editReply({
        embeds: [rangerEmbed({
          discordUserId: ranger.discord_user_id,
          ranger,
          duties,
          ranksAndRoles,
          corpsMedals,
          stats,
          avatarUrl,
          displayName: member?.displayName ?? ranger.discord_display_name ?? ranger.discord_username ?? "Ranger",
          title: member ? highestCorpsTitle(member) : rangerTitle(ranger.current_rank)
        })]
      });
      return;
    }

    if (subcommand === "briefing") {
      await collectRangerBriefing(interaction);
      return;
    }

    if (subcommand === "assignments") {
      if (!canOpenPromotionVotes(actor)) {
        throw new UserFacingError("Ranger Marshal or higher is required to post assignments.");
      }

      await interaction.deferReply({ ephemeral: true });

      const channel = interaction.channel;
      if (!channel || channel.type !== ChannelType.GuildText) {
        throw new UserFacingError("Assignments can only be posted in a text channel.");
      }

      await postAssignmentsBoard(channel);
      await interaction.editReply({ content: "Ranger assignments board posted." });
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
        content: ranger ? `Synced ${member.displayName} as ${ranger.current_rank}.` : "No Ranger rank role was found. The roster was not changed.",
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

    if (subcommand === "sync-join-history") {
      requireMarshal(actor);
      const channel = interaction.options.getChannel("channel", true);
      if (channel.type !== ChannelType.GuildText) {
        throw new UserFacingError("Choose a normal text channel containing Discord member-join messages.");
      }

      await interaction.deferReply({ ephemeral: true });
      const result = await syncCorpsJoinHistory(channel);
      await interaction.editReply({
        content: `Scanned **${result.scannedMessages}** messages in ${channel}. ` +
          `Matched **${result.matchedCurrentRangers}** current roster entries and **${result.matchedHistoricalMembers}** historical members. ` +
          `Found **${result.unmatchedJoinMessages}** join messages that were not Corps roster members.`
      });
      return;
    }

    if (subcommand === "status") {
      requireMarshal(actor);
      const user = interaction.options.getUser("user", true);
      const status = interaction.options.getString("status", true) as RangerStatus;
      await interaction.deferReply({ ephemeral: true });
      const ranger = await setRangerStatus(user.id, status);
      const endedDuties = status === "Inactive" || status === "Retired"
        ? await endActiveDutyAssignmentsForRanger({
            guild: interaction.guild,
            rangerDiscordUserId: user.id,
            endedByDiscordUserId: interaction.user.id,
            reason: `Roster status changed to ${status}`
          })
        : 0;
      await interaction.editReply({
        content: `Set ${user} to ${ranger.status}.${endedDuties ? ` Ended ${endedDuties} active duty assignment${endedDuties === 1 ? "" : "s"}.` : ""}`
      });
      await refreshStoredAssignmentsBoard(interaction.guild).catch((error) => {
        console.error("Failed to refresh assignments board after Ranger status change:", error);
      });
      return;
    }

    if (subcommand === "retire-left") {
      requireMarshal(actor);
      await interaction.deferReply({ ephemeral: true });
      const discordUserId = interaction.options.getString("discord_user_id", true).trim();
      if (!/^\d{17,20}$/.test(discordUserId)) {
        throw new UserFacingError("Discord user ID must be a numeric snowflake.");
      }

      const ranger = await retireDepartedRanger(discordUserId);
      if (!ranger) {
        await interaction.editReply({ content: "No roster entry exists for that Discord user ID." });
        return;
      }

      const endedDuties = await endActiveDutyAssignmentsForRanger({
        guild: interaction.guild,
        rangerDiscordUserId: discordUserId,
        endedByDiscordUserId: interaction.user.id,
        reason: "Ranger left the Discord and was retired"
      });
      await refreshStoredAssignmentsBoard(interaction.guild);
      await interaction.editReply({
        content: `Set ${ranger.discord_display_name ?? ranger.discord_username ?? discordUserId} to Retired.` +
          (endedDuties ? ` Ended ${endedDuties} active duty assignment${endedDuties === 1 ? "" : "s"}.` : "")
      });
      return;
    }

    if (subcommand === "clear-hold") {
      if (!canManageAll(actor)) {
        throw new UserFacingError("Ranger Captain or higher is required to remove a Hold Warden appointment.");
      }
      await interaction.deferReply({ ephemeral: true });
      const discordUserId = interaction.options.getString("discord_user_id", true).trim();
      if (!/^\d{17,20}$/u.test(discordUserId)) {
        throw new UserFacingError("Discord user ID must be a numeric snowflake.");
      }

      const removed = await removeDuty({
        guild: interaction.guild,
        rangerDiscordUserId: discordUserId,
        dutyName: "Warden",
        wardenScope: "hold_primary",
        removedByDiscordUserId: interaction.user.id,
        reason: "Ranger of the Hold appointment removed"
      });
      const ranger = await setRangerHold(discordUserId, null);
      await refreshStoredAssignmentsBoard(interaction.guild);
      await interaction.editReply({
        content: removed
          ? `Removed ${ranger.discord_display_name ?? ranger.discord_username ?? discordUserId} as Ranger of ${removed.assignment.parent_hold ?? removed.assignment.assignment_detail ?? "their Hold"}.`
          : `${ranger.discord_display_name ?? ranger.discord_username ?? discordUserId} had no active Hold Warden appointment; any legacy hold value was cleared.`
      });
      return;
    }

    if (subcommand === "set-hold") {
      if (!canManageAll(actor)) {
        throw new UserFacingError("Ranger Captain or higher is required to appoint a Hold Warden.");
      }
      await interaction.deferReply({ ephemeral: true });
      const user = interaction.options.getUser("user", true);
      const hold = interaction.options.getString("hold", true);
      await ensureWardenDutyForHold({
        guild: interaction.guild,
        rangerDiscordUserId: user.id,
        hold,
        assignedByDiscordUserId: interaction.user.id
      });
      await interaction.editReply({
        content: `Appointed ${user} as **Ranger of ${hold}**.`
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
      const [holdRoles, wardens] = await Promise.all([
        syncAssignedHoldRoles(interaction.guild, rangers),
        syncHoldWardenAssignments({
          guild: interaction.guild,
          rangers,
          assignedByDiscordUserId: interaction.user.id
        })
      ]);
      await interaction.editReply({
        content: `Synced ${holdRoles.synced} assigned hold roles and ${wardens.synced} Warden assignments. ` +
          `Skipped ${holdRoles.skipped} hold roles and ${wardens.skipped} Warden assignments.`
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

      const previousRanger = await getRangerByDiscordId(user.id);
      const member = await interaction.guild.members.fetch(user.id);
      const reason = interaction.options.getString("reason");
      const ranger = await promoteRanger({
        member,
        targetRank: rank,
        changedByDiscordUserId: interaction.user.id,
        ...(reason ? { reason } : {})
      });
      await closeSupersededPromotionVotes({
        guild: interaction.guild,
        candidateRangerId: ranger.id,
        currentRank: ranger.current_rank
      });
      await refreshStoredAssignmentsBoard(interaction.guild);
      await refreshFieldNamesBulletin(interaction.guild).catch((error) => {
        console.warn("Could not refresh Field Names after promotion:", error);
      });
      await interaction.reply({
        content: previousRanger && previousRanger.current_rank !== ranger.current_rank
          ? `${user} has been promoted from **${previousRanger.current_rank}** to **${ranger.current_rank}**. Their new rank has been entered on the Corps roster.`
          : `${user} now holds the rank of **${ranger.current_rank}**. The Corps roster has been updated.`,
        ephemeral: false
      });
      return;
    }
  }
};

function requireMarshal(member: GuildMember): void {
  if (!canOpenPromotionVotes(member)) {
    throw new UserFacingError("Ranger Marshal or higher is required.");
  }
}

function rangerEmbed(params: {
  discordUserId: string;
  ranger: Awaited<ReturnType<typeof getRangerByDiscordId>>;
  duties?: string[];
  ranksAndRoles?: string[];
  corpsMedals?: string[];
  stats?: Awaited<ReturnType<typeof getRangerProfileStats>>;
  avatarUrl?: string;
  displayName: string;
  title: string | null;
}): EmbedBuilder {
  const {
    discordUserId,
    ranger,
    duties = [],
    ranksAndRoles = [],
    corpsMedals = [],
    stats = { rosterNumber: 0, rosterTotal: 0, reportCount: 0 },
    avatarUrl,
    displayName,
    title
  } = params;
  if (!ranger) {
    throw new UserFacingError("No roster entry found.");
  }

  const embed = new EmbedBuilder()
    .setTitle(`${title ? `${title} ` : ""}${displayName}`)
    .setDescription(`<@${discordUserId}>`)
    .addFields(
      { name: "Rank", value: ranger.current_rank, inline: true },
      { name: "Status", value: ranger.status, inline: true },
      { name: "Join Date", value: `${ranger.join_date} (${daysBetween(ranger.join_date)} days)`, inline: true },
      { name: "Assigned Hold", value: ranger.assigned_hold ?? "Unassigned", inline: true },
      { name: "In-Game Name", value: displayName, inline: true },
      { name: "Corps Standing", value: `Ranger #${stats.rosterNumber} of ${stats.rosterTotal}`, inline: true },
      { name: "Reports Filed", value: String(stats.reportCount), inline: true },
      { name: "Last Activity", value: ranger.last_discord_activity_at ? `<t:${Math.floor(new Date(ranger.last_discord_activity_at).getTime() / 1000)}:R>` : "Unknown", inline: true },
      { name: "Ranks & Roles", value: embedListValue(ranksAndRoles, "No recorded rank roles"), inline: true },
      { name: "Corps Medals", value: embedListValue(corpsMedals, "None awarded"), inline: true },
      { name: "Corps Duties", value: duties.join("\n") || "None", inline: false },
      { name: "Notes", value: ranger.notes?.slice(0, 1024) || "None" }
    )
    .setColor(0x587c4a);

  if (avatarUrl) {
    embed.setThumbnail(avatarUrl);
  }

  return embed;
}

function embedListValue(entries: string[], emptyValue: string): string {
  const value = entries.join("\n") || emptyValue;
  return value.length <= 1024 ? value : `${value.slice(0, 1021)}...`;
}

function formatWardenDuty(range: string, scope: "hold_primary" | "local_range" | null): string {
  const normalizedRange = range.trim();
  if (/^(?:ranger|warden)\s+of\s+/iu.test(normalizedRange)) {
    return normalizedRange;
  }

  return `${scope === "hold_primary" ? "Ranger" : "Warden"} of ${normalizedRange}`;
}

function rangerTitle(rank: string): string {
  switch (rank) {
    case "Ranger Commander":
      return "Commander";
    case "Ranger Captain":
      return "Captain";
    case "Ranger Marshal":
      return "Marshal";
    default:
      return rank;
  }
}

export function csvAttachment(csv: string, name = "ranger-roster.csv"): AttachmentBuilder {
  return new AttachmentBuilder(Buffer.from(`\uFEFF${csv}`, "utf8"), { name });
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

    const missingLowerRanks = MAIN_RANKS.filter((rank) => rankAtLeast(ranger.current_rank, rank))
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
