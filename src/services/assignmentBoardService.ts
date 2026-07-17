import { EmbedBuilder, type Guild, type Message, type TextChannel } from "discord.js";
import { HOLDS } from "../config/holds.js";
import { rankSort, type MainRank } from "../config/ranks.js";
import type { RangerRow } from "../db/supabase.js";
import { deleteStoredMessages, getStoredTextChannel, saveBotMessageState } from "./botMessageStateService.js";
import { listActiveDutyAssignments, type DutyAssignmentDetails } from "./dutyService.js";
import { listAllRangers } from "./rangerService.js";

const ASSIGNMENTS_BOARD_STATE_KEY = "ranger-assignments";
const leadershipRanks: MainRank[] = ["Ranger Commander", "Ranger Captain", "Ranger Marshal"];

export async function postAssignmentsBoard(channel: TextChannel): Promise<Message> {
  await deleteStoredMessages(channel.guild, ASSIGNMENTS_BOARD_STATE_KEY);
  const [rangers, dutyAssignments] = await Promise.all([
    listAllRangers(),
    listActiveDutyAssignments()
  ]);
  const message = await channel.send({ embeds: [assignmentsEmbed(rangers, dutyAssignments)] });
  await saveBotMessageState(ASSIGNMENTS_BOARD_STATE_KEY, channel.id, [message.id]);
  return message;
}

export async function refreshStoredAssignmentsBoard(guild: Guild): Promise<boolean> {
  const channel = await getStoredTextChannel(guild, ASSIGNMENTS_BOARD_STATE_KEY);
  if (!channel) {
    return false;
  }

  await postAssignmentsBoard(channel);
  return true;
}

function assignmentsEmbed(rangers: RangerRow[], dutyAssignments: DutyAssignmentDetails[]): EmbedBuilder {
  const sortedRangers = [...rangers].sort(compareRangersForDisplay);
  const wardens = dutyAssignments.filter(({ duty }) => duty.name === "Warden");
  const detectives = dutyAssignments
    .filter(({ duty }) => duty.name === "Detective")
    .sort((a, b) => compareRangersForDisplay(a.ranger, b.ranger));
  const embed = new EmbedBuilder()
    .setTitle("Ranger Corps Assignments")
    .setDescription("Current senior command, Warden coverage, and Detectives.")
    .setColor(0x587c4a)
    .setTimestamp(new Date());

  for (const rank of leadershipRanks) {
    const ranked = sortedRangers.filter((ranger) => ranger.current_rank === rank);
    embed.addFields({
      name: rank,
      value: ranked.length ? truncateField(ranked.map(formatAssignmentRanger).join("\n")) : "None assigned."
    });
  }

  embed.addFields({
    name: "Wardens",
    value: "Rangers assigned to protect a hold or another designated Range."
  });

  for (const hold of HOLDS) {
    const assigned = sortedRangers.filter((ranger) => ranger.assigned_hold === hold);
    embed.addFields({
      name: `Warden - ${hold}`,
      value: assigned.length ? truncateField(assigned.map(formatAssignmentRanger).join("\n")) : "None assigned."
    });
  }

  const assignedHoldRangerIds = new Set(rangers
    .filter((ranger) => ranger.assigned_hold)
    .map((ranger) => ranger.id));
  const otherWardens = wardens
    .filter(({ ranger }) => !assignedHoldRangerIds.has(ranger.id))
    .sort((a, b) => compareRangersForDisplay(a.ranger, b.ranger));
  embed.addFields({
    name: "Warden - Other Ranges",
    value: otherWardens.length
      ? truncateField(otherWardens.map(formatDutyAssignment).join("\n"))
      : "None assigned."
  });

  embed.addFields({
    name: "Detectives",
    value: detectives.length
      ? truncateField(detectives.map(formatDutyAssignment).join("\n"))
      : "None assigned."
  });

  return embed;
}

function formatDutyAssignment({ assignment, ranger }: DutyAssignmentDetails): string {
  const detail = assignment.assignment_detail ? ` - ${assignment.assignment_detail}` : "";
  return `${formatAssignmentRanger(ranger)}${detail}`;
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
