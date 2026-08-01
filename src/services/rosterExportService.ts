import type { Guild } from "discord.js";
import { MAIN_RANKS, RANKS } from "../config/ranks.js";
import {
  assertNoDbError,
  supabase,
  type RangerRow
} from "../db/supabase.js";
import { listDiscordRoleMedals } from "./atlasDiscordProfileService.js";
import { daysBetween } from "../utils/dates.js";

export async function exportRosterCsv(guild?: Guild): Promise<string> {
  const [
    rangersResult,
    dutiesResult,
    assignmentsResult,
    medalsResult,
    awardsResult,
    fieldNamesResult,
    apprenticeshipsResult,
    intelReportsResult,
    allianceReportsResult,
    historicalMembersResult
  ] = await Promise.all([
    supabase.from("rangers").select("*").order("current_rank", { ascending: true }).order("discord_display_name", { ascending: true }),
    supabase.from("corps_duties").select("*"),
    supabase.from("ranger_duty_assignments").select("*").eq("status", "Active"),
    supabase.from("corps_medals").select("*"),
    supabase.from("ranger_medal_awards").select("*"),
    supabase.from("ranger_field_names").select("*").eq("active", true),
    supabase.from("apprenticeships").select("*").eq("status", "Active"),
    supabase.from("intel_reports").select("author_discord_user_id, discord_message_id").is("source_alliance_report_id", null),
    supabase.from("alliance_reports").select("author_discord_user_id, discord_message_id"),
    supabase.from("historical_corps_members").select("*")
  ]);

  assertNoDbError(rangersResult.error, "export roster");
  assertNoDbError(dutiesResult.error, "load Corps duties for roster export");
  assertNoDbError(assignmentsResult.error, "load duty assignments for roster export");
  assertNoDbError(medalsResult.error, "load Corps medals for roster export");
  assertNoDbError(awardsResult.error, "load medal awards for roster export");
  assertNoDbError(fieldNamesResult.error, "load field names for roster export");
  assertNoDbError(apprenticeshipsResult.error, "load apprenticeships for roster export");
  assertNoDbError(intelReportsResult.error, "count Intel reports for roster export");
  assertNoDbError(allianceReportsResult.error, "count Alliance reports for roster export");
  assertNoDbError(historicalMembersResult.error, "load Corps history for roster export");

  const rangers = rangersResult.data ?? [];
  const dutiesById = new Map((dutiesResult.data ?? []).map((duty) => [duty.id, duty]));
  const medalsById = new Map((medalsResult.data ?? []).map((medal) => [medal.id, medal]));
  const rangerByDiscordUserId = new Map(rangers.map((ranger) => [ranger.discord_user_id, ranger]));

  const dutiesByRangerId = new Map<string, string[]>();
  for (const assignment of assignmentsResult.data ?? []) {
    const duty = dutiesById.get(assignment.duty_id);
    if (!duty) {
      continue;
    }
    addToList(
      dutiesByRangerId,
      assignment.ranger_id,
      assignment.assignment_detail ? `${duty.name} (${assignment.assignment_detail})` : duty.name
    );
  }

  const medalsByRangerId = new Map<string, string[]>();
  for (const award of awardsResult.data ?? []) {
    const medal = medalsById.get(award.medal_id);
    if (!medal) {
      continue;
    }
    const reason = award.reason?.trim();
    const awardedAt = award.awarded_at.slice(0, 10);
    addToList(
      medalsByRangerId,
      award.ranger_id,
      `${medal.name} (${awardedAt}${reason ? `: ${reason}` : ""})`
    );
  }

  const fieldNameByDiscordUserId = new Map(
    (fieldNamesResult.data ?? []).map((fieldName) => [fieldName.discord_user_id, fieldName.field_name])
  );
  const reportsByDiscordUserId = countReportsByAuthor([
    ...(intelReportsResult.data ?? []).map((report) => ({ ...report, source: "intel" })),
    ...(allianceReportsResult.data ?? []).map((report) => ({ ...report, source: "alliance" }))
  ]);
  const apprenticeshipsByDiscordUserId = listActiveApprenticeships(
    apprenticeshipsResult.data ?? [],
    rangerByDiscordUserId
  );
  const standingByRangerId = createCorpsStandingMap(rangers, historicalMembersResult.data ?? []);

  const members = guild
    ? await guild.members.fetch().catch((error) => {
      console.warn("Could not fetch Discord members for full roster export:", error);
      return null;
    })
    : null;

  const headers = [
    "Corps Standing",
    "Display Name",
    "Discord Username",
    "Discord User ID",
    "In-Game Name",
    "Field Name",
    "Highest Rank",
    "Cumulative Main Ranks",
    "Current Discord Roles",
    "Status",
    "Promotion Progress",
    "Promotion Progress Started",
    "Join Date",
    "Days in Corps",
    "Last Promotion",
    "Assigned Hold / Range",
    "Active Corps Duties",
    "Active Apprenticeships",
    "Awarded Medals",
    "Medal Count",
    "Reports Filed",
    "Last Discord Activity",
    "Last Bot Interaction",
    "Notes"
  ];

  const rows = rangers.map((ranger) => {
    const member = members?.get(ranger.discord_user_id);
    const liveRoles = member
      ? listDiscordRoleMedals(member).map((role) => role.label)
      : cumulativeRanks(ranger);
    const awardedMedals = medalsByRangerId.get(ranger.id) ?? [];
    return [
      standingByRangerId.get(ranger.id) ?? "",
      ranger.discord_display_name ?? "",
      ranger.discord_username ?? "",
      ranger.discord_user_id,
      ranger.in_game_name ?? "",
      fieldNameByDiscordUserId.get(ranger.discord_user_id) ?? "",
      ranger.current_rank,
      cumulativeRanks(ranger).join(" | "),
      liveRoles.join(" | "),
      ranger.status,
      ranger.promotion_progress ?? "",
      ranger.promotion_progress_started_at ?? "",
      ranger.join_date,
      String(daysBetween(ranger.join_date)),
      ranger.last_promotion_date ?? "",
      ranger.assigned_hold ?? "",
      (dutiesByRangerId.get(ranger.id) ?? []).join(" | "),
      (apprenticeshipsByDiscordUserId.get(ranger.discord_user_id) ?? []).join(" | "),
      awardedMedals.join(" | "),
      String(awardedMedals.length),
      String(reportsByDiscordUserId.get(ranger.discord_user_id)?.size ?? 0),
      ranger.last_discord_activity_at ?? "",
      ranger.last_bot_interaction_at ?? "",
      ranger.notes ?? ""
    ];
  });

  return [headers, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n");
}

function cumulativeRanks(ranger: RangerRow): string[] {
  return MAIN_RANKS.filter((rank) => RANKS[rank].sort >= RANKS[ranger.current_rank].sort);
}

function listActiveApprenticeships(
  apprenticeships: Array<{ mentor_discord_user_id: string; apprentice_discord_user_id: string }>,
  rangerByDiscordUserId: ReadonlyMap<string, RangerRow>
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const apprenticeship of apprenticeships) {
    const mentor = rangerByDiscordUserId.get(apprenticeship.mentor_discord_user_id);
    const apprentice = rangerByDiscordUserId.get(apprenticeship.apprentice_discord_user_id);
    addToList(result, apprenticeship.mentor_discord_user_id, `Mentor to ${displayName(apprentice, apprenticeship.apprentice_discord_user_id)}`);
    addToList(result, apprenticeship.apprentice_discord_user_id, `Apprentice to ${displayName(mentor, apprenticeship.mentor_discord_user_id)}`);
  }
  return result;
}

function countReportsByAuthor(
  reports: Array<{ author_discord_user_id: string; discord_message_id: string; source: string }>
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const report of reports) {
    if (!result.has(report.author_discord_user_id)) {
      result.set(report.author_discord_user_id, new Set());
    }
    result.get(report.author_discord_user_id)?.add(`${report.source}:${report.discord_message_id}`);
  }
  return result;
}

function createCorpsStandingMap(
  rangers: RangerRow[],
  historicalMembers: Array<{ id: string; discord_username: string | null; join_date: string; created_at: string }>
): Map<string, string> {
  const currentUsernames = new Set(
    rangers
      .map((ranger) => ranger.discord_username?.toLowerCase())
      .filter((username): username is string => Boolean(username))
  );
  const history = [
    ...rangers.map((ranger) => ({
      id: ranger.id,
      currentRangerId: ranger.id,
      join_date: ranger.join_date,
      created_at: ranger.created_at
    })),
    ...historicalMembers
      .filter((member) => !member.discord_username || !currentUsernames.has(member.discord_username.toLowerCase()))
      .map((member) => ({ ...member, currentRangerId: null }))
  ].sort((left, right) =>
    left.join_date.localeCompare(right.join_date)
    || left.created_at.localeCompare(right.created_at)
    || left.id.localeCompare(right.id)
  );

  const result = new Map<string, string>();
  for (const [index, entry] of history.entries()) {
    if (entry.currentRangerId) {
      result.set(entry.currentRangerId, `Ranger #${index + 1} of ${history.length}`);
    }
  }
  return result;
}

function displayName(ranger: RangerRow | undefined, fallback: string): string {
  return ranger?.discord_display_name ?? ranger?.in_game_name ?? ranger?.discord_username ?? fallback;
}

function addToList(map: Map<string, string[]>, key: string, value: string): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function escapeCsv(value: string): string {
  if (!/[",\n\r]/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '""')}"`;
}
