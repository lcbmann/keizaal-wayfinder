import { EmbedBuilder, type Guild, type GuildMember } from "discord.js";
import { HOLDS, isHold, type Hold } from "../config/holds.js";
import { assertNoDbError, supabase, type TrailmarkRow, type TrailmarkSessionRow } from "../db/supabase.js";
import { emojiEmbed } from "../utils/guildEmojis.js";
import { listContacts, type ContactDetails } from "./contactService.js";
import { getRangerByDiscordId } from "./rangerService.js";

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

  const [{ data: trailmarks, error: trailmarkError }, contacts] = await Promise.all([
    supabase.from("trailmarks").select("*").eq("active", true).eq("hold", hold),
    listContacts({ hold })
  ]);
  assertNoDbError(trailmarkError, "list patrol Trailmarks");
  const activeTrailmarks = trailmarks ?? [];
  const sessions = await listTrailmarkSessions(activeTrailmarks);
  const route = rankPatrolLocationsByActivity(activeTrailmarks, sessions).slice(0, 2);
  const contact = stalestContact(contacts);

  const embed = emojiEmbed(params.guild, "atlas", `Patrol Route: ${hold}`)
    .setDescription(patrolPurpose(contact))
    .addFields(
      { name: "Suggested route", value: suggestedRoute(route, contact), inline: false },
      { name: "Point of interest", value: contactDescription(contact), inline: false },
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

async function listTrailmarkSessions(trailmarks: TrailmarkRow[]): Promise<TrailmarkSessionRow[]> {
  if (trailmarks.length === 0) {
    return [];
  }
  const { data, error } = await supabase.from("trailmark_sessions")
    .select("*")
    .in("trailmark_id", trailmarks.map((trailmark) => trailmark.id))
    .order("created_at", { ascending: false });
  assertNoDbError(error, "list patrol Trailmark visits");
  return data ?? [];
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

function stalestContact(contacts: ContactDetails[]): ContactDetails | null {
  return [...contacts].sort((left, right) =>
    contactFreshness(left) - contactFreshness(right)
      || Number(right.contact.high_priority) - Number(left.contact.high_priority)
      || left.contact.name.localeCompare(right.contact.name)
  )[0] ?? null;
}

function contactFreshness(contact: ContactDetails): number {
  return contact.summary.lastVerifiedAt ? new Date(contact.summary.lastVerifiedAt).getTime() : 0;
}

function patrolPurpose(contact: ContactDetails | null): string {
  if (!contact) {
    return "No specific contact needs checking. Patrol the roads and report any useful changes.";
  }
  const kind = contact.contact.record_type === "Group" ? "group" : "contact";
  return `The latest report on the ${kind} **${contact.contact.name}** needs checking. Visit the area and update the record if needed.`;
}

function suggestedRoute(trailmarks: TrailmarkRow[], contact: ContactDetails | null): string {
  const start = trailmarks[0] ? trailmarkLabel(trailmarks[0]) : `a practical entry point into ${contact?.contact.hold ?? "the Hold"}`;
  const end = trailmarks[1] ? trailmarkLabel(trailmarks[1]) : trailmarks[0] ? trailmarkLabel(trailmarks[0]) : "Headquarters";
  const contactArea = contact?.contact.usual_locations ?? contact?.contact.hold ?? "the surrounding roads";
  return `Begin at ${start}, make a circuit through **${contactArea}**, and finish at ${end}.`;
}

function trailmarkLabel(trailmark: TrailmarkRow): string {
  return `<#${trailmark.discord_channel_id}> (${trailmark.name})`;
}

function contactDescription(contact: ContactDetails | null): string {
  if (!contact) {
    return "No active contact or group records are filed for this Hold.";
  }
  const lastVerified = contact.summary.lastVerifiedAt
    ? `<t:${Math.floor(new Date(contact.summary.lastVerifiedAt).getTime() / 1000)}:R>`
    : "never formally confirmed";
  const kind = contact.contact.record_type === "Group"
    ? contact.contact.group_category ?? "Group"
    : contact.contact.occupation ?? "Individual contact";
  const recordLink = contact.contact.forum_thread_id ? `\nRecord: <#${contact.contact.forum_thread_id}>` : "";
  return `**${contact.contact.name}**\n${kind}\nStatus: ${contact.summary.status}${recordLink}\nLast confirmed: ${lastVerified}.`;
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
