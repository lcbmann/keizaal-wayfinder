import { EmbedBuilder, type Guild, type GuildMember } from "discord.js";
import { HOLDS, isHold, type Hold } from "../config/holds.js";
import { assertNoDbError, supabase, type TrailmarkRow, type TrailmarkSessionRow } from "../db/supabase.js";
import { emojiEmbed } from "../utils/guildEmojis.js";
import { getRangerByDiscordId } from "./rangerService.js";

const PATROL_FOCUSES = [
  { title: "Roads and passage", text: "Check the condition of roads, crossings, and nearby paths. Note obstacles or useful alternate routes." },
  { title: "Signs of activity", text: "Keep an eye out for tracks, camps, travelers, or other signs of activity. Report what you actually find." },
  { title: "Useful ground", text: "Look for useful gathering grounds, water, shelter, or places worth marking on the Atlas." },
  { title: "Changes in the wilds", text: "Watch for wildlife, hazards, and changes since your last visit. Take a side path if it seems worthwhile." }
] as const;

// A small per-user rotation, not a saved assignment or a new management workflow.
export function createPatrolSuggestionRotation() {
  const cursors = new Map<string, number>();
  return (key: string): number => {
    const cursor = cursors.get(key) ?? 0;
    cursors.delete(key);
    cursors.set(key, (cursor + 1) % 120); // Divisible by 1/3/6/10 route options and four focuses.
    if (cursors.size > 1000) cursors.delete(cursors.keys().next().value!);
    return cursor;
  };
}
const nextPatrolSuggestion = createPatrolSuggestionRotation();

export async function buildPatrolSuggestion(params: {
  guild: Guild;
  member: GuildMember;
  requestedHold?: string | null;
}): Promise<{ hold: Hold; embed: EmbedBuilder }> {
  const ranger = await getRangerByDiscordId(params.member.id);
  const hold = selectPatrolHold({
    requestedHold: params.requestedHold ?? null,
    assignedHold: ranger?.assigned_hold ?? null,
    discordUserId: params.member.id,
    date: new Date()
  });

  const { data: trailmarks, error: trailmarkError } = await supabase.from("trailmarks").select("*").eq("active", true).eq("hold", hold);
  assertNoDbError(trailmarkError, "list patrol Trailmarks");
  const activeTrailmarks = trailmarks ?? [];
  const sessions = await listTrailmarkSessions(activeTrailmarks);
  const options = patrolRouteOptions(rankPatrolLocationsByActivity(activeTrailmarks, sessions));
  const cursor = nextPatrolSuggestion(`${params.guild.id}:${params.member.id}:${hold}`);
  const route = options[cursor % options.length] ?? [];
  const focus = PATROL_FOCUSES[cursor % PATROL_FOCUSES.length]!;

  const embed = emojiEmbed(params.guild, "atlas", `Patrol Route: ${hold}`)
    .setDescription(route.length
      ? "Give a little attention to ground that has gone longer without a recorded Trailmark visit. Take whichever connecting roads and side paths seem worthwhile."
      : `Take a circuit through ${hold} and see what has changed. There are no active Trailmarks recorded here to build a route around yet.`)
    .addFields(
      { name: "Suggested route", value: suggestedRoute(route, hold), inline: false },
      { name: focus.title, value: focus.text, inline: false },
      { name: "Report", value: reportingInstruction(route), inline: false }
    )
    .setColor(0x587c4a)
    .setFooter({ text: "This is a suggestion, not an assignment. Change the route as needed." })
    .setTimestamp(new Date());
  return { hold, embed };
}

export function selectPatrolHold(params: {
  requestedHold?: string | null;
  assignedHold?: string | null;
  discordUserId: string;
  date: Date;
}): Hold {
  if (params.requestedHold && isHold(params.requestedHold)) {
    return params.requestedHold;
  }
  if (params.assignedHold && isHold(params.assignedHold)) {
    return params.assignedHold;
  }
  const day = Math.floor(Date.UTC(
    params.date.getUTCFullYear(),
    params.date.getUTCMonth(),
    params.date.getUTCDate()
  ) / 86_400_000);
  const userSeed = [...params.discordUserId].reduce((total, character) => total + character.charCodeAt(0), 0);
  return HOLDS[(day + userSeed) % HOLDS.length] ?? HOLDS[0];
}

export async function listTrailmarkSessions(trailmarks: TrailmarkRow[]): Promise<TrailmarkSessionRow[]> {
  if (trailmarks.length === 0) {
    return [];
  }
  const sessions: TrailmarkSessionRow[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from("trailmark_sessions")
      .select("*")
      .in("trailmark_id", trailmarks.map((trailmark) => trailmark.id))
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(offset, offset + pageSize - 1);
    assertNoDbError(error, "list patrol Trailmark visits");
    sessions.push(...(data ?? []));
    if (!data || data.length < pageSize) return sessions;
  }
}

export function patrolRouteOptions(ranked: TrailmarkRow[]): TrailmarkRow[][] {
  const pool = ranked.slice(0, 5);
  if (pool.length < 2) return [pool];
  const pairs: { route: TrailmarkRow[]; score: number; first: number }[] = [];
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      pairs.push({ route: [pool[i]!, pool[j]!], score: i + j, first: i });
    }
  }
  return pairs.sort((a, b) => a.score - b.score || a.first - b.first).map(({ route }) => route);
}

export function rankPatrolLocationsByActivity(
  trailmarks: TrailmarkRow[],
  sessions: TrailmarkSessionRow[]
): TrailmarkRow[] {
  const activeTrailmarks = trailmarks.filter((trailmark) => trailmark.active);
  const trailmarkById = new Map(activeTrailmarks.map((trailmark) => [trailmark.id, trailmark]));
  const groupKeyByTrailmarkId = new Map<string, string>();
  const membersByGroupKey = new Map<string, TrailmarkRow[]>();

  for (const trailmark of activeTrailmarks) {
    const groupKey = resolvePatrolGroupKey(trailmark, trailmarkById);
    groupKeyByTrailmarkId.set(trailmark.id, groupKey);
    const members = membersByGroupKey.get(groupKey) ?? [];
    members.push(trailmark);
    membersByGroupKey.set(groupKey, members);
  }

  const latestActivityByGroupKey = new Map<string, number>();
  for (const session of sessions) {
    const groupKey = groupKeyByTrailmarkId.get(session.trailmark_id);
    if (!groupKey) {
      continue;
    }

    const timestamp = new Date(session.created_at).getTime();
    if (!Number.isFinite(timestamp)) {
      continue;
    }

    latestActivityByGroupKey.set(
      groupKey,
      Math.max(latestActivityByGroupKey.get(groupKey) ?? 0, timestamp)
    );
  }

  return [...membersByGroupKey.entries()]
    .map(([groupKey, members]) => ({
      freshness: latestActivityByGroupKey.get(groupKey) ?? 0,
      representative: trailmarkById.get(groupKey) ?? deterministicTrailmark(members)
    }))
    .sort((left, right) =>
      left.freshness - right.freshness
        || compareTrailmarks(left.representative, right.representative)
    )
    .map(({ representative }) => representative);
}

function resolvePatrolGroupKey(trailmark: TrailmarkRow, trailmarkById: Map<string, TrailmarkRow>): string {
  const visitedIds: string[] = [];
  const visitedIndexById = new Map<string, number>();
  let current = trailmark;

  while (current.patrol_anchor_trailmark_id) {
    const cycleStart = visitedIndexById.get(current.id);
    if (cycleStart !== undefined) {
      return visitedIds.slice(cycleStart).sort()[0] ?? trailmark.id;
    }

    visitedIndexById.set(current.id, visitedIds.length);
    visitedIds.push(current.id);
    const anchorId = current.patrol_anchor_trailmark_id;
    const anchor = trailmarkById.get(anchorId);
    if (!anchor) {
      return anchorId;
    }
    current = anchor;
  }

  return current.id;
}

function deterministicTrailmark(trailmarks: TrailmarkRow[]): TrailmarkRow {
  const trailmark = [...trailmarks].sort(compareTrailmarks)[0];
  if (!trailmark) {
    throw new Error("A patrol location group must contain at least one active Trailmark.");
  }
  return trailmark;
}

function compareTrailmarks(left: TrailmarkRow, right: TrailmarkRow): number {
  return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
}

function suggestedRoute(trailmarks: TrailmarkRow[], hold: Hold): string {
  const start = trailmarks[0];
  const end = trailmarks[1];
  if (!start) return `Choose a practical starting point in ${hold}, explore the surrounding roads, and return by a different path if possible.`;
  if (!end) return `Begin at ${trailmarkLabel(start)}, make a circuit through the surrounding countryside, and return with anything worth reporting.`;
  return `Begin at ${trailmarkLabel(start)} and work your way toward ${trailmarkLabel(end)}, checking the surrounding roads and paths along the way.`;
}

function trailmarkLabel(trailmark: TrailmarkRow): string {
  return `<#${trailmark.discord_channel_id}> (${trailmark.name})`;
}

function reportingInstruction(trailmarks: TrailmarkRow[]): string {
  if (trailmarks.length === 0) {
    return "Report useful findings through the nearest Trailmark or when you return to Headquarters.";
  }
  const destination = trailmarks.at(-1);
  if (!destination) {
    return "Report useful findings through the nearest Trailmark or when you return to Headquarters.";
  }
  return `Leave useful findings at ${trailmarkLabel(destination)}. Use \`/trailmark report\` for a formal report when appropriate.`;
}
