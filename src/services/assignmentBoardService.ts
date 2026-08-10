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
import { emojiEmbed, emojiText, guildEmoji, rankEmojiName } from "../utils/guildEmojis.js";

const ASSIGNMENTS_BOARD_STATE_KEY = "ranger-assignments";
const leadershipRanks: MainRank[] = ["Ranger Commander", "Ranger Captain", "Ranger Marshal"];
const assignmentBoardTitleSuffixes = [
  "Ranger Corps Leadership",
  "Ranger Corps Quartermasters",
  "Ranger Corps Wardens",
  "Ranger Corps Ambassadors",
  "Ranger Corps Agents",
  "Ranger Corps Apprenticeships"
];
const activeBoardRefreshes = new Map<string, Promise<Message[]>>();

export async function postAssignmentsBoard(channel: TextChannel): Promise<Message[]> {
  const refreshKey = `${channel.guild.id}:${ASSIGNMENTS_BOARD_STATE_KEY}`;
  const activeRefresh = activeBoardRefreshes.get(refreshKey);
  if (activeRefresh) {
    return activeRefresh;
  }

  const refresh = replaceAssignmentsBoard(channel).finally(() => {
    if (activeBoardRefreshes.get(refreshKey) === refresh) {
      activeBoardRefreshes.delete(refreshKey);
    }
  });
  activeBoardRefreshes.set(refreshKey, refresh);
  return refresh;
}

async function replaceAssignmentsBoard(channel: TextChannel): Promise<Message[]> {
  const [rangers, dutyAssignments, apprenticeships, apprenticeshipPreferences] = await Promise.all([
    listAllRangers(),
    listActiveDutyAssignments(),
    listCurrentApprenticeships(),
    listApprenticeshipPreferences()
  ]);
  const embeds = assignmentsEmbeds(channel.guild, rangers, dutyAssignments, apprenticeships, apprenticeshipPreferences);
  await deleteStoredMessages(channel.guild, ASSIGNMENTS_BOARD_STATE_KEY);
  await deleteOrphanedAssignmentBoards(channel);

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
  guild: Guild,
  rangers: RangerRow[],
  dutyAssignments: DutyAssignmentDetails[],
  apprenticeships: ApprenticeshipDetails[],
  apprenticeshipPreferences: ApprenticeshipPreferenceRow[]
): EmbedBuilder[] {
  const sortedRangers = [...rangers].sort(compareRangersForDisplay);
  const quartermasters = dutyAssignments
    .filter(({ duty }) => duty.name === "Quartermaster")
    .sort((a, b) => compareRangersForDisplay(a.ranger, b.ranger));
  const wardens = dutyAssignments.filter(({ duty }) => duty.name === "Warden");
  const agents = dutyAssignments
    .filter(({ duty }) => duty.name === "Agent")
    .sort((a, b) => compareRangersForDisplay(a.ranger, b.ranger));
  const ambassadors = dutyAssignments
    .filter(({ duty }) => duty.name === "Ambassador")
    .sort((a, b) => compareRangersForDisplay(a.ranger, b.ranger));
  const leadershipEmbed = emojiEmbed(guild, "rangercommander", "Ranger Corps Leadership")
    .setDescription("The Rangers presently entrusted with command of the Corps.")
    .setColor(0xb08d32)
    .setTimestamp(new Date());

  for (const rank of leadershipRanks) {
    const ranked = sortedRangers.filter((ranger) => ranger.current_rank === rank && ranger.status === "Active");
    leadershipEmbed.addFields({
      name: emojiText(guild, rankEmojiForBoard(rank), rank),
      value: ranked.length ? truncateField(ranked.map((ranger) => formatAssignmentRanger(guild, ranger)).join("\n")) : "None assigned."
    });
  }

  const wardensEmbed = emojiEmbed(guild, "warden", "Ranger Corps Wardens")
    .setDescription("Rangers entrusted with the safety and oversight of a Hold or another designated Range.")
    .setColor(0x587c4a)
    .setTimestamp(new Date());

  const quartermastersEmbed = emojiEmbed(guild, "quartermaster", "Ranger Corps Quartermasters")
    .setDescription("Rangers entrusted with stores, supplies, and the material needs of the Corps.")
    .setColor(0x8b6f9e)
    .addFields({
      name: "Active Quartermasters",
      value: quartermasters.length
        ? truncateField(quartermasters.map((details) => formatDutyAssignment(guild, details)).join("\n"))
        : "None assigned."
    })
    .setTimestamp(new Date());

  for (const hold of HOLDS) {
    const assigned = sortedRangers.filter((ranger) => ranger.assigned_hold === hold);
    wardensEmbed.addFields({
      name: hold,
      value: assigned.length ? truncateField(assigned.map((ranger) => formatAssignmentRanger(guild, ranger)).join("\n")) : "None assigned."
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
      ? truncateField(otherWardens.map((details) => formatDutyAssignment(guild, details)).join("\n"))
      : "None assigned."
  });

  const agentsEmbed = emojiEmbed(guild, "agent", "Ranger Corps Agents")
    .setDescription("Rangers tasked with investigations, gathering testimony, and preserving evidence.")
    .setColor(0x4f6d8a)
    .addFields({
      name: "Active Agents",
      value: agents.length
        ? truncateField(agents.map((details) => formatDutyAssignment(guild, details)).join("\n"))
        : "None assigned."
    })
    .setTimestamp(new Date());

  const ambassadorsEmbed = emojiEmbed(guild, "ambassador", "Ranger Corps Ambassadors")
    .setDescription("Rangers entrusted with representing the Corps and maintaining relations with other groups.")
    .setColor(0x8b6f9e)
    .addFields({
      name: "Active Ambassadors",
      value: ambassadors.length
        ? truncateField(ambassadors.map((details) => formatDutyAssignment(guild, details)).join("\n"))
        : "None assigned."
    })
    .setTimestamp(new Date());

  const activeApprenticeships = apprenticeships.filter(({ apprenticeship }) => apprenticeship.status === "Active");
  const seekingMentors = apprenticeshipPreferences.filter((preference) => preference.seeking === "Mentor");
  const seekingApprentices = apprenticeshipPreferences.filter((preference) => preference.seeking === "Apprentice");
  const apprenticeshipsEmbed = emojiEmbed(guild, "apprentice", "Ranger Corps Apprenticeships")
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

  return [leadershipEmbed, quartermastersEmbed, wardensEmbed, ambassadorsEmbed, agentsEmbed, apprenticeshipsEmbed];
}

function rankEmojiForBoard(rank: MainRank): "rangercommander" | "rangercaptain" | "rangermarshal" {
  switch (rank) {
    case "Ranger Commander":
      return "rangercommander";
    case "Ranger Captain":
      return "rangercaptain";
    case "Ranger Marshal":
      return "rangermarshal";
    default:
      return "rangercommander";
  }
}

function formatApprenticeship({ apprenticeship }: ApprenticeshipDetails): string {
  return `<@${apprenticeship.mentor_discord_user_id}> mentoring <@${apprenticeship.apprentice_discord_user_id}>`;
}

function formatDutyAssignment(guild: Guild, { assignment, ranger }: DutyAssignmentDetails): string {
  const detail = assignment.assignment_detail ? ` - ${assignment.assignment_detail}` : "";
  return `${formatAssignmentRanger(guild, ranger)}${detail}`;
}

function formatAssignmentRanger(guild: Guild, ranger: RangerRow): string {
  const status = ranger.status === "Active" ? "" : ` (${ranger.status})`;
  const name = ranger.discord_display_name ?? ranger.discord_username ?? "Unknown";
  const emojiName = rankEmojiName(ranger.current_rank);
  const badge = emojiName ? guildEmoji(guild, emojiName) : "";
  return `<@${ranger.discord_user_id}> - ${badge ? `${badge} ` : ""}${name}${status}`;
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

async function deleteOrphanedAssignmentBoards(channel: TextChannel): Promise<void> {
  const botUserId = channel.client.user?.id;
  if (!botUserId) {
    return;
  }

  try {
    let before: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const messages = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
      if (!messages.size) {
        break;
      }

      const orphaned = messages.filter((message) => message.author.id === botUserId
        && message.embeds.some((embed) => isAssignmentsBoardEmbedTitle(embed.title)));
      await Promise.all([...orphaned.values()].map((message) => message.delete().catch((error) => {
        console.warn(`Could not remove an orphaned Ranger assignments board message ${message.id}:`, error);
      })));

      if (messages.size < 100) {
        break;
      }
      before = messages.last()?.id;
    }
  } catch (error) {
    console.warn("Could not scan the Ranger roster channel for orphaned assignment boards:", error);
  }
}

export function isAssignmentsBoardEmbedTitle(title: string | null): boolean {
  return title !== null && assignmentBoardTitleSuffixes.some((suffix) => title.endsWith(suffix));
}
