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
  const route = leastRecentlyVisitedTrailmarks(activeTrailmarks, sessions).slice(0, 2);
  const contact = stalestContact(contacts);

  const embed = emojiEmbed(params.guild, "atlas", `Patrol Suggestion - ${hold}`)
    .setDescription(patrolPurpose(contact))
    .addFields(
      { name: "Suggested route", value: suggestedRoute(route, contact), inline: false },
      { name: "Point of interest", value: contactDescription(contact), inline: false },
      { name: "Report", value: reportingInstruction(route), inline: false }
    )
    .setColor(0x587c4a)
    .setFooter({ text: "A Wayfinder suggestion, not a standing assignment. Adapt it to conditions in the field." })
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

function leastRecentlyVisitedTrailmarks(trailmarks: TrailmarkRow[], sessions: TrailmarkSessionRow[]): TrailmarkRow[] {
  const latestByTrailmark = new Map<string, number>();
  for (const session of sessions) {
    if (!latestByTrailmark.has(session.trailmark_id)) {
      latestByTrailmark.set(session.trailmark_id, new Date(session.created_at).getTime());
    }
  }
  return [...trailmarks].sort((left, right) =>
    (latestByTrailmark.get(left.id) ?? 0) - (latestByTrailmark.get(right.id) ?? 0)
      || left.name.localeCompare(right.name)
  );
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
    return "Headquarters has no current contact record selected for this circuit. Survey the roads, note changes in local conditions, and return useful observations to the Corps.";
  }
  const kind = contact.contact.record_type === "Group" ? "group" : "contact";
  return `Headquarters could use a fresh field check concerning the ${kind} **${contact.contact.name}**. Observe conditions along the route and confirm or correct the existing record where possible.`;
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
    return "No active contact or group record is currently filed for this Hold.";
  }
  const lastVerified = contact.summary.lastVerifiedAt
    ? `<t:${Math.floor(new Date(contact.summary.lastVerifiedAt).getTime() / 1000)}:R>`
    : "never formally confirmed";
  const kind = contact.contact.record_type === "Group"
    ? contact.contact.group_category ?? "Group"
    : contact.contact.occupation ?? "Individual contact";
  const recordLink = contact.contact.forum_thread_id ? ` - <#${contact.contact.forum_thread_id}>` : "";
  return `**${contact.contact.name}** - ${kind} - ${contact.summary.status}${recordLink}\nLast confirmed: ${lastVerified}.`;
}

function reportingInstruction(trailmarks: TrailmarkRow[]): string {
  if (trailmarks.length === 0) {
    return "Record anything useful through the nearest available Trailmark or upon returning to Headquarters.";
  }
  const destination = trailmarks.at(-1);
  if (!destination) {
    return "Record anything useful through the nearest available Trailmark or upon returning to Headquarters.";
  }
  return `Leave useful findings at ${trailmarkLabel(destination)}. Use \`/trailmark report\` for a formal report when appropriate.`;
}
