import { EmbedBuilder, type Guild, type Message, type TextChannel } from "discord.js";
import { HOLDS } from "../config/holds.js";
import { rankSort, type MainRank } from "../config/ranks.js";
import type { ApprenticeshipPreferenceRow, RangerRow } from "../db/supabase.js";
import { deleteStoredMessages, getStoredTextChannel, saveBotMessageState } from "./botMessageStateService.js";
import {
  listApprenticeshipPreferences,
  listCurrentApprenticeships,
  type ApprenticeshipDetails
} from "./apprenticeshipService.js";
import { listActiveDutyAssignments, type DutyAssignmentDetails } from "./dutyService.js";
import { listAllRangers } from "./rangerService.js";

const ASSIGNMENTS_BOARD_STATE_KEY = "ranger-assignments";
const leadershipRanks: MainRank[] = ["Ranger Commander", "Ranger Captain", "Ranger Marshal"];

export async function postAssignmentsBoard(channel: TextChannel): Promise<Message[]> {
  const [rangers, dutyAssignments, apprenticeships, apprenticeshipPreferences] = await Promise.all([
    listAllRangers(),
    listActiveDutyAssignments(),
    listCurrentApprenticeships(),
    listApprenticeshipPreferences()
  ]);
  const embeds = assignmentsEmbeds(rangers, dutyAssignments, apprenticeships, apprenticeshipPreferences);
  await deleteStoredMessages(channel.guild, ASSIGNMENTS_BOARD_STATE_KEY);

  const messages: Message[] = [];
  try {
    for (const embed of embeds) {
      messages.push(await channel.send({ embeds: [embed] }));
    }
    await saveBotMessageState(ASSIGNMENTS_BOARD_STATE_KEY, channel.id, messages.map((message) => message.id));
    return messages;
  } catch (error) {
    await Promise.all(messages.map((message) => message.delete().catch(() => undefined)));
    throw error;
  }
}

export async function refreshStoredAssignmentsBoard(guild: Guild): Promise<boolean> {
  const channel = await getStoredTextChannel(guild, ASSIGNMENTS_BOARD_STATE_KEY);
  if (!channel) {
    return false;
  }

  await postAssignmentsBoard(channel);
  return true;
}

function assignmentsEmbeds(
  rangers: RangerRow[],
  dutyAssignments: DutyAssignmentDetails[],
  apprenticeships: ApprenticeshipDetails[],
  apprenticeshipPreferences: ApprenticeshipPreferenceRow[]
): EmbedBuilder[] {
  const sortedRangers = [...rangers].sort(compareRangersForDisplay);
  const wardens = dutyAssignments.filter(({ duty }) => duty.name === "Warden");
  const detectives = dutyAssignments
    .filter(({ duty }) => duty.name === "Detective")
    .sort((a, b) => compareRangersForDisplay(a.ranger, b.ranger));
  const leadershipEmbed = new EmbedBuilder()
    .setTitle("Ranger Corps Leadership")
    .setDescription("Current senior command of the Ranger Corps.")
    .setColor(0xb08d32)
    .setTimestamp(new Date());

  for (const rank of leadershipRanks) {
    const ranked = sortedRangers.filter((ranger) => ranger.current_rank === rank);
    leadershipEmbed.addFields({
      name: rank,
      value: ranked.length ? truncateField(ranked.map(formatAssignmentRanger).join("\n")) : "None assigned."
    });
  }

  const wardensEmbed = new EmbedBuilder()
    .setTitle("Ranger Corps Wardens")
    .setDescription("Rangers assigned to protect a hold or another designated Range.")
    .setColor(0x587c4a)
    .setTimestamp(new Date());

  for (const hold of HOLDS) {
    const assigned = sortedRangers.filter((ranger) => ranger.assigned_hold === hold);
    wardensEmbed.addFields({
      name: hold,
      value: assigned.length ? truncateField(assigned.map(formatAssignmentRanger).join("\n")) : "None assigned."
    });
  }

  const assignedHoldRangerIds = new Set(rangers
    .filter((ranger) => ranger.assigned_hold)
    .map((ranger) => ranger.id));
  const otherWardens = wardens
    .filter(({ ranger }) => !assignedHoldRangerIds.has(ranger.id))
    .sort((a, b) => compareRangersForDisplay(a.ranger, b.ranger));
  wardensEmbed.addFields({
    name: "Other Ranges",
    value: otherWardens.length
      ? truncateField(otherWardens.map(formatDutyAssignment).join("\n"))
      : "None assigned."
  });

  const detectivesEmbed = new EmbedBuilder()
    .setTitle("Ranger Corps Detectives")
    .setDescription("Rangers assigned to investigations and evidence gathering.")
    .setColor(0x4f6d8a)
    .addFields({
      name: "Active Detectives",
      value: detectives.length
        ? truncateField(detectives.map(formatDutyAssignment).join("\n"))
        : "None assigned."
    })
    .setTimestamp(new Date());

  const activeApprenticeships = apprenticeships.filter(({ apprenticeship }) => apprenticeship.status === "Active");
  const seekingMentors = apprenticeshipPreferences.filter((preference) => preference.seeking === "Mentor");
  const seekingApprentices = apprenticeshipPreferences.filter((preference) => preference.seeking === "Apprentice");
  const apprenticeshipsEmbed = new EmbedBuilder()
    .setTitle("Ranger Corps Apprenticeships")
    .setDescription("Rangers can mentor Apprentices and help prepare them for promotion. Use `/apprenticeship looking-for` to find a match.")
    .setColor(0x8b6f9e)
    .addFields(
      {
        name: "Active Apprenticeships",
        value: activeApprenticeships.length
          ? truncateField(activeApprenticeships.map(formatApprenticeship).join("\n"))
          : "None active."
      },
      {
        name: "Looking for a Mentor",
        value: seekingMentors.length
          ? truncateField(seekingMentors.map((preference) => `<@${preference.discord_user_id}>`).join("\n"))
          : "No Apprentices are currently looking."
      },
      {
        name: "Looking for an Apprentice",
        value: seekingApprentices.length
          ? truncateField(seekingApprentices.map((preference) => `<@${preference.discord_user_id}>`).join("\n"))
          : "No Rangers are currently looking."
      }
    )
    .setTimestamp(new Date());

  return [leadershipEmbed, wardensEmbed, detectivesEmbed, apprenticeshipsEmbed];
}

function formatApprenticeship({ apprenticeship }: ApprenticeshipDetails): string {
  return `<@${apprenticeship.mentor_discord_user_id}> mentoring <@${apprenticeship.apprentice_discord_user_id}>`;
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
