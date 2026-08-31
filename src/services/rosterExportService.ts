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
    historicalMembersResult,
    qualificationsResult,
    qualificationAwardsResult,
    runecloakSpellsResult,
    runecloakProgressResult,
    runecloakCyclesResult,
    runecloakMembersResult,
    runecloakStagesResult,
    runecloakParticipationResult
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
    supabase.from("historical_corps_members").select("*"),
    supabase.from("corps_qualifications").select("*").eq("active", true),
    supabase.from("ranger_qualifications").select("*").is("revoked_at", null),
    supabase.from("runecloak_spells").select("*").order("sequence"),
    supabase.from("runecloak_spell_progress").select("*"),
    supabase.from("runecloak_cycles").select("*"),
    supabase.from("runecloak_cycle_members").select("*"),
    supabase.from("runecloak_stages").select("*"),
    supabase.from("runecloak_session_participation").select("*").eq("participation_kind", "learner").eq("status", "verified")
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
  assertNoDbError(qualificationsResult.error, "load qualifications for roster export");
  assertNoDbError(qualificationAwardsResult.error, "load qualification awards for roster export");
  assertNoDbError(runecloakSpellsResult.error, "load Runecloak spells for roster export");
  assertNoDbError(runecloakProgressResult.error, "load Runecloak progress for roster export");
  assertNoDbError(runecloakCyclesResult.error, "load Runecloak cycles for roster export");
  assertNoDbError(runecloakMembersResult.error, "load Runecloak rosters for roster export");
  assertNoDbError(runecloakStagesResult.error, "load Runecloak stages for roster export");
  assertNoDbError(runecloakParticipationResult.error, "load Runecloak participation for roster export");

  const rangers = rangersResult.data ?? [];
  const dutiesById = new Map((dutiesResult.data ?? []).map((duty) => [duty.id, duty]));
  const medalsById = new Map((medalsResult.data ?? []).map((medal) => [medal.id, medal]));
  const rangerByDiscordUserId = new Map(rangers.map((ranger) => [ranger.discord_user_id, ranger]));
  const qualificationById = new Map((qualificationsResult.data ?? []).map((qualification) => [qualification.id, qualification]));
  const runecloakSpellById = new Map((runecloakSpellsResult.data ?? []).map((spell) => [spell.id, spell]));
  const runecloakCycleById = new Map((runecloakCyclesResult.data ?? []).map((cycle) => [cycle.id, cycle]));
  const runecloakStageById = new Map((runecloakStagesResult.data ?? []).map((stage) => [stage.id, stage]));

  const qualificationsByRangerId = new Map<string, string[]>();
  for (const award of qualificationAwardsResult.data ?? []) {
    const qualification = qualificationById.get(award.qualification_id);
    if (qualification) {
      addToList(qualificationsByRangerId, award.ranger_id, qualification.name);
    }
  }

  const runecloakSpellsByRangerId = new Map<string, string[]>();
  for (const progress of runecloakProgressResult.data ?? []) {
    const spell = runecloakSpellById.get(progress.spell_id);
    if (spell) {
      addToList(
        runecloakSpellsByRangerId,
        progress.ranger_id,
        `${spell.name}: ${progress.status === "completed" ? "Complete" : `${progress.verified_attendance_credits}/${progress.required_attendance_credits} attendance`}`
      );
    }
  }

  const currentRunecloakMemberByRangerId = new Map(
    (runecloakMembersResult.data ?? []).flatMap((member) => {
      const cycle = runecloakCycleById.get(member.cycle_id);
      return cycle && ["Locked", "Awaiting Moonshadow Start", "Active", "Awaiting Moonshadow Grant"].includes(cycle.status)
        ? [[member.ranger_id, member] as const]
        : [];
    })
  );
  const activeAttendanceByMember = new Map<string, Set<string>>();
  const activePointsByMember = new Map<string, number>();
  for (const participation of runecloakParticipationResult.data ?? []) {
    const stage = runecloakStageById.get(participation.stage_id);
    if (!stage || stage.status !== "Valid") {
      continue;
    }
    const key = `${stage.cycle_id}:${participation.ranger_id}`;
    if (!activeAttendanceByMember.has(key)) {
      activeAttendanceByMember.set(key, new Set());
    }
    activeAttendanceByMember.get(key)?.add(stage.id);
    if (participation.roll_value !== null) {
      activePointsByMember.set(key, (activePointsByMember.get(key) ?? 0) + participation.roll_value);
    }
  }

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
    "Qualifications",
    "Runecloak Spells",
    "Active Runecloak Cycle",
    "Cycle Attendance",
    "Cycle Points",
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
    const runecloakMember = currentRunecloakMemberByRangerId.get(ranger.id);
    const runecloakCycle = runecloakMember ? runecloakCycleById.get(runecloakMember.cycle_id) : null;
    const runecloakKey = runecloakCycle ? `${runecloakCycle.id}:${ranger.id}` : null;
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
      (qualificationsByRangerId.get(ranger.id) ?? []).join(" | "),
      (runecloakSpellsByRangerId.get(ranger.id) ?? []).join(" | "),
      runecloakCycle ? `${runecloakCycle.label} (${runecloakCycle.status})` : "",
      runecloakMember && runecloakCycle
        ? `${activeAttendanceByMember.get(runecloakKey ?? "")?.size ?? 0} stages; ${runecloakMember.participation_status}`
        : "",
      runecloakKey ? String(activePointsByMember.get(runecloakKey) ?? 0) : "",
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
