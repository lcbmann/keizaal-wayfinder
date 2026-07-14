import type { GuildMember } from "discord.js";
import { env } from "../config/env.js";
import { isMainRank, type MainRank } from "../config/ranks.js";
import { assertNoDbError, supabase, type RangerRow, type RangerStatus } from "../db/supabase.js";
import { todayIsoDate } from "../utils/dates.js";
import { UserFacingError } from "../utils/errors.js";
import { getMemberMainRank, hasGuestOnly, syncCumulativeMainRanks } from "./discordRoleService.js";

export async function getRangerByDiscordId(discordUserId: string): Promise<RangerRow | null> {
  const { data, error } = await supabase
    .from("rangers")
    .select("*")
    .eq("discord_user_id", discordUserId)
    .maybeSingle();

  assertNoDbError(error, "get ranger");
  return data;
}

export async function getRangerById(id: string): Promise<RangerRow | null> {
  const { data, error } = await supabase.from("rangers").select("*").eq("id", id).maybeSingle();
  assertNoDbError(error, "get ranger by id");
  return data;
}

export async function requireRangerByDiscordId(discordUserId: string): Promise<RangerRow> {
  const ranger = await getRangerByDiscordId(discordUserId);
  if (!ranger) {
    throw new UserFacingError("No Ranger roster entry exists for that member.");
  }

  return ranger;
}

export async function syncMemberToRoster(member: GuildMember, createdByDiscordUserId?: string): Promise<RangerRow | null> {
  const mainRank = getMemberMainRank(member);
  if (!mainRank) {
    if (hasGuestOnly(member)) {
      return null;
    }

    return null;
  }

  const existing = await getRangerByDiscordId(member.id);
  const now = new Date().toISOString();
  const joinDate = joinDateForSync(member, existing);
  const payload = {
    discord_username: member.user.username,
    discord_display_name: member.displayName,
    in_game_name: existing?.in_game_name ?? member.displayName,
    current_rank: mainRank,
    status: existing?.status ?? "Active",
    join_date: joinDate,
    created_by_discord_user_id: existing?.created_by_discord_user_id ?? createdByDiscordUserId ?? null,
    updated_at: now
  } satisfies Partial<RangerRow>;

  const { data, error } = await supabase
    .from("rangers")
    .upsert(
      {
        discord_user_id: member.id,
        ...payload
      },
      { onConflict: "discord_user_id" }
    )
    .select("*")
    .single();

  assertNoDbError(error, "sync member to roster");
  await syncCumulativeMainRanks(member, mainRank);
  return data;
}

function joinDateForSync(member: GuildMember, existing: RangerRow | null): string {
  const discordJoinedDate = member.joinedAt?.toISOString().slice(0, 10);
  if (!existing) {
    return discordJoinedDate ?? todayIsoDate();
  }

  if (discordJoinedDate && shouldRepairPlaceholderJoinDate(existing, discordJoinedDate)) {
    return discordJoinedDate;
  }

  return existing.join_date;
}

function shouldRepairPlaceholderJoinDate(existing: RangerRow, discordJoinedDate: string): boolean {
  const createdDate = existing.created_at.slice(0, 10);
  return existing.join_date === createdDate && discordJoinedDate < existing.join_date;
}

export async function syncRosterToDiscord(member: GuildMember, ranger: RangerRow): Promise<void> {
  if (!isMainRank(ranger.current_rank)) {
    throw new UserFacingError(`Invalid rank in roster: ${ranger.current_rank}`);
  }

  await syncCumulativeMainRanks(member, ranger.current_rank);
}

export async function promoteRanger(params: {
  member: GuildMember;
  targetRank: MainRank;
  changedByDiscordUserId: string;
  reason?: string;
}): Promise<RangerRow> {
  const existing = await requireRangerByDiscordId(params.member.id);
  const now = new Date().toISOString();
  const today = todayIsoDate();

  const { data, error } = await supabase
    .from("rangers")
    .update({
      current_rank: params.targetRank,
      last_promotion_date: today,
      discord_username: params.member.user.username,
      discord_display_name: params.member.displayName,
      in_game_name: existing.in_game_name ?? params.member.displayName,
      updated_at: now
    })
    .eq("id", existing.id)
    .select("*")
    .single();

  assertNoDbError(error, "promote ranger");

  const { error: historyError } = await supabase.from("rank_history").insert({
    ranger_id: existing.id,
    old_rank: existing.current_rank,
    new_rank: params.targetRank,
    changed_by_discord_user_id: params.changedByDiscordUserId,
    reason: params.reason ?? null
  });

  assertNoDbError(historyError, "write rank history");
  await syncCumulativeMainRanks(params.member, params.targetRank);
  return data;
}

export async function setRangerStatus(discordUserId: string, status: RangerStatus): Promise<RangerRow> {
  const { data, error } = await supabase
    .from("rangers")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("discord_user_id", discordUserId)
    .select("*")
    .single();

  assertNoDbError(error, "set ranger status");
  return data;
}

export async function retireDepartedRanger(discordUserId: string): Promise<RangerRow | null> {
  const { data, error } = await supabase
    .from("rangers")
    .update({ status: "Retired", updated_at: new Date().toISOString() })
    .eq("discord_user_id", discordUserId)
    .select("*")
    .maybeSingle();

  assertNoDbError(error, "retire departed ranger");
  return data;
}

export async function setRangerHold(discordUserId: string, hold: string | null): Promise<RangerRow> {
  const { data, error } = await supabase
    .from("rangers")
    .update({ assigned_hold: hold, updated_at: new Date().toISOString() })
    .eq("discord_user_id", discordUserId)
    .select("*")
    .maybeSingle();

  assertNoDbError(error, "set ranger hold");
  if (!data) {
    throw new UserFacingError("No Ranger roster entry exists for that member.");
  }

  return data;
}

export async function listRangersWithAssignedHolds(): Promise<RangerRow[]> {
  const { data, error } = await supabase
    .from("rangers")
    .select("*")
    .not("assigned_hold", "is", null)
    .order("assigned_hold", { ascending: true })
    .order("discord_display_name", { ascending: true });

  assertNoDbError(error, "list rangers with assigned holds");
  return data ?? [];
}

export async function listAllRangers(): Promise<RangerRow[]> {
  const { data, error } = await supabase
    .from("rangers")
    .select("*")
    .order("current_rank", { ascending: true })
    .order("discord_display_name", { ascending: true });

  assertNoDbError(error, "list all rangers");
  return data ?? [];
}

export async function updateRangerNotes(discordUserId: string, note: string, append: boolean): Promise<RangerRow> {
  const existing = await requireRangerByDiscordId(discordUserId);
  const notes = append && existing.notes ? `${existing.notes}\n${note}` : note;
  const { data, error } = await supabase
    .from("rangers")
    .update({ notes, updated_at: new Date().toISOString() })
    .eq("id", existing.id)
    .select("*")
    .single();

  assertNoDbError(error, "update ranger notes");
  return data;
}

export async function syncAllRankedMembers(guildMembers: Iterable<GuildMember>, createdBy: string): Promise<number> {
  let synced = 0;
  for (const member of guildMembers) {
    if (getMemberMainRank(member)) {
      await syncMemberToRoster(member, createdBy);
      synced += 1;
    }
  }

  return synced;
}

export async function dmNewApprentice(member: GuildMember): Promise<void> {
  if (!member.roles.cache.has(env.ROLE_APPRENTICE_ID)) {
    return;
  }

  const existing = await getRangerByDiscordId(member.id);
  if (existing) {
    return;
  }

  try {
    await member.send(
      "Welcome to the Ranger Corps. Please set your server nickname to your in-game character name so the roster stays accurate. You can ask a Ranger Marshal or Captain if you need help."
    );
  } catch (error) {
    console.warn(`Could not DM new Apprentice ${member.id}:`, error);
  }
}
