import { RANKS } from "../config/ranks.js";
import { assertNoDbError, supabase, type RangerRow } from "../db/supabase.js";
import { daysBetween } from "../utils/dates.js";

export async function exportRosterCsv(): Promise<string> {
  const { data, error } = await supabase
    .from("rangers")
    .select("*")
    .order("current_rank", { ascending: true })
    .order("discord_display_name", { ascending: true });

  assertNoDbError(error, "export roster");

  const headers = [
    "Display Name",
    "Discord Username",
    "Discord User ID",
    "Current Rank",
    "Join Date",
    "Days in Corps",
    "Last Promotion",
    "Assigned Hold",
    "Status",
    "Notes",
    "Rank Sort",
    "Last Discord Activity",
    "Last Bot Interaction"
  ];

  const rows = (data ?? []).map((ranger) => rowForRanger(ranger));
  return [headers, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n");
}

function rowForRanger(ranger: RangerRow): string[] {
  return [
    ranger.discord_display_name ?? "",
    ranger.discord_username ?? "",
    ranger.discord_user_id,
    ranger.current_rank,
    ranger.join_date,
    String(daysBetween(ranger.join_date)),
    ranger.last_promotion_date ?? "",
    ranger.assigned_hold ?? "",
    ranger.status,
    ranger.notes ?? "",
    String(RANKS[ranger.current_rank].sort),
    ranger.last_discord_activity_at ?? "",
    ranger.last_bot_interaction_at ?? ""
  ];
}

function escapeCsv(value: string): string {
  if (!/[",\n\r]/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '""')}"`;
}
