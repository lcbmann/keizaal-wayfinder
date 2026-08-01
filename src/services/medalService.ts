import type { Guild, GuildMember, Role } from "discord.js";
import { env } from "../config/env.js";
import {
  assertNoDbError,
  supabase,
  type CorpsMedalRow,
  type RangerMedalAwardRow,
  type RangerRow
} from "../db/supabase.js";
import { UserFacingError } from "../utils/errors.js";
import { slugify } from "../utils/slugs.js";
import { requireRangerByDiscordId } from "./rangerService.js";

export interface RangerMedalAwardDetails {
  medal: CorpsMedalRow;
  award: RangerMedalAwardRow;
  newlyAwarded: boolean;
}

export async function listMedals(): Promise<CorpsMedalRow[]> {
  const { data, error } = await supabase
    .from("corps_medals")
    .select("*")
    .eq("active", true)
    .order("name", { ascending: true });
  assertNoDbError(error, "list Corps medals");
  return data ?? [];
}

export async function listRangerMedalAwards(rangerId: string): Promise<RangerMedalAwardDetails[]> {
  const { data: awards, error } = await supabase
    .from("ranger_medal_awards")
    .select("*")
    .eq("ranger_id", rangerId)
    .order("awarded_at", { ascending: true });
  assertNoDbError(error, "list Ranger medal awards");

  if (!awards?.length) {
    return [];
  }

  const medalIds = [...new Set(awards.map((award) => award.medal_id))];
  const { data: medals, error: medalError } = await supabase
    .from("corps_medals")
    .select("*")
    .in("id", medalIds)
    .eq("active", true);
  assertNoDbError(medalError, "load awarded Corps medals");
  const medalById = new Map((medals ?? []).map((medal) => [medal.id, medal]));

  return awards.flatMap((award) => {
    const medal = medalById.get(award.medal_id);
    return medal ? [{ medal, award, newlyAwarded: false }] : [];
  });
}

export async function createMedal(params: {
  guild: Guild;
  name: string;
  description: string;
  emoji: string | null;
  createdByDiscordUserId: string;
}): Promise<CorpsMedalRow> {
  const name = params.name.trim();
  const slug = slugify(name);
  if (!name || !slug) {
    throw new UserFacingError("The medal needs a valid name.");
  }

  const { data, error } = await supabase
    .from("corps_medals")
    .insert({
      slug,
      name,
      description: params.description.trim(),
      emoji: normalizeEmoji(params.emoji),
      discord_role_id: null,
      active: true,
      created_by_discord_user_id: params.createdByDiscordUserId
    })
    .select("*")
    .single();
  assertNoDbError(error, "create Corps medal");
  return ensureMedalRole(params.guild, data);
}

export async function awardMedal(params: {
  guild: Guild;
  rangerDiscordUserId: string;
  medalId: string;
  awardedByDiscordUserId: string;
  reason: string | null;
  notifyRecipient?: boolean;
}): Promise<RangerMedalAwardDetails> {
  const [ranger, medal] = await Promise.all([
    requireRangerByDiscordId(params.rangerDiscordUserId),
    requireMedal(params.medalId)
  ]);
  const roleReadyMedal = await ensureMedalRole(params.guild, medal);

  const { data: existing, error: existingError } = await supabase
    .from("ranger_medal_awards")
    .select("*")
    .eq("ranger_id", ranger.id)
    .eq("medal_id", medal.id)
    .maybeSingle();
  assertNoDbError(existingError, "check existing medal award");

  let award = existing;
  let newlyAwarded = false;
  if (!award) {
    const { data, error } = await supabase
      .from("ranger_medal_awards")
      .insert({
        medal_id: medal.id,
        ranger_id: ranger.id,
        awarded_by_discord_user_id: params.awardedByDiscordUserId,
        reason: params.reason?.trim() || null
      })
      .select("*")
      .single();
    assertNoDbError(error, "award Corps medal");
    award = data;
    newlyAwarded = true;
  }

  await addMedalRole(params.guild, ranger, roleReadyMedal);
  if (newlyAwarded && params.notifyRecipient !== false) {
    await notifyMedalRecipient(params.guild, ranger.discord_user_id, roleReadyMedal);
  }
  return { medal: roleReadyMedal, award, newlyAwarded };
}

export async function revokeMedal(params: {
  guild: Guild;
  rangerDiscordUserId: string;
  medalId: string;
}): Promise<boolean> {
  const [ranger, medal] = await Promise.all([
    requireRangerByDiscordId(params.rangerDiscordUserId),
    requireMedal(params.medalId)
  ]);
  const { data, error } = await supabase
    .from("ranger_medal_awards")
    .delete()
    .eq("ranger_id", ranger.id)
    .eq("medal_id", medal.id)
    .select("id");
  assertNoDbError(error, "revoke Corps medal");
  if (!data?.length) {
    return false;
  }

  if (medal.discord_role_id) {
    const member = await params.guild.members.fetch(ranger.discord_user_id).catch(() => null);
    if (member?.roles.cache.has(medal.discord_role_id)) {
      await member.roles.remove(medal.discord_role_id, `Corps medal ${medal.name} revoked`);
    }
  }
  return true;
}

export async function setupMedals(
  guild: Guild,
  actorDiscordUserId: string
): Promise<{ medals: number; mentors: number; apprentices: number }> {
  const medals = await listMedals();
  for (const medal of medals) {
    await ensureMedalRole(guild, medal);
  }

  const { data: apprenticeships, error } = await supabase
    .from("apprenticeships")
    .select("mentor_discord_user_id, apprentice_discord_user_id")
    .in("status", ["Active", "Ended"]);
  assertNoDbError(error, "list apprenticeship history");
  const mentors = [...new Set((apprenticeships ?? []).map((row) => row.mentor_discord_user_id))];
  const apprentices = [...new Set((apprenticeships ?? []).map((row) => row.apprentice_discord_user_id))];
  let mentorAwards = 0;
  let apprenticeAwards = 0;
  for (const mentorDiscordUserId of mentors) {
    try {
      if (await awardMentorMedal(guild, mentorDiscordUserId, actorDiscordUserId, false)) {
        mentorAwards += 1;
      }
    } catch (error) {
      console.warn(`Could not backfill the Mentor medal for ${mentorDiscordUserId}:`, error);
    }
  }
  for (const apprenticeDiscordUserId of apprentices) {
    try {
      if (await awardApprenticeshipMedal(guild, apprenticeDiscordUserId, actorDiscordUserId, false)) {
        apprenticeAwards += 1;
      }
    } catch (error) {
      console.warn(`Could not backfill the Apprenticeship medal for ${apprenticeDiscordUserId}:`, error);
    }
  }

  return { medals: medals.length, mentors: mentorAwards, apprentices: apprenticeAwards };
}

export async function awardMentorMedal(
  guild: Guild,
  mentorDiscordUserId: string,
  awardedByDiscordUserId = "system",
  notifyRecipient = true
): Promise<boolean> {
  return awardBuiltInMedal({
    guild,
    rangerDiscordUserId: mentorDiscordUserId,
    awardedByDiscordUserId,
    medalSlug: "mentor",
    reason: "Served as a Ranger Corps mentor.",
    notifyRecipient
  });
}

export async function awardApprenticeshipMedal(
  guild: Guild,
  apprenticeDiscordUserId: string,
  awardedByDiscordUserId = "system",
  notifyRecipient = true
): Promise<boolean> {
  return awardBuiltInMedal({
    guild,
    rangerDiscordUserId: apprenticeDiscordUserId,
    awardedByDiscordUserId,
    medalSlug: "apprenticeship",
    reason: "Entered a formal Ranger Corps apprenticeship.",
    notifyRecipient
  });
}

export async function awardActiveApprenticeshipMedals(params: {
  guild: Guild;
  mentorDiscordUserId: string;
  apprenticeDiscordUserId: string;
  awardedByDiscordUserId: string;
  notifyRecipient?: boolean;
}): Promise<void> {
  const results = await Promise.allSettled([
    awardMentorMedal(params.guild, params.mentorDiscordUserId, params.awardedByDiscordUserId, params.notifyRecipient),
    awardApprenticeshipMedal(params.guild, params.apprenticeDiscordUserId, params.awardedByDiscordUserId, params.notifyRecipient)
  ]);
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failures.length) {
    throw new AggregateError(failures.map((failure) => failure.reason), "Could not award every apprenticeship medal.");
  }
}

async function awardBuiltInMedal(params: {
  guild: Guild;
  rangerDiscordUserId: string;
  awardedByDiscordUserId: string;
  medalSlug: string;
  reason: string;
  notifyRecipient?: boolean;
}): Promise<boolean> {
  const { data: medal, error } = await supabase
    .from("corps_medals")
    .select("*")
    .eq("slug", params.medalSlug)
    .eq("active", true)
    .maybeSingle();
  assertNoDbError(error, `get ${params.medalSlug} medal`);
  if (!medal) {
    return false;
  }
  await awardMedal({
    guild: params.guild,
    rangerDiscordUserId: params.rangerDiscordUserId,
    medalId: medal.id,
    awardedByDiscordUserId: params.awardedByDiscordUserId,
    reason: params.reason,
    ...(params.notifyRecipient === undefined ? {} : { notifyRecipient: params.notifyRecipient })
  });
  return true;
}

export function medalEmoji(guild: Guild, medal: CorpsMedalRow): string {
  const value = medal.emoji?.trim();
  if (!value) {
    return "";
  }
  const emojiName = customEmojiName(value);
  return guild.emojis.cache.find((emoji) => emoji.name === emojiName)?.toString() ?? value;
}

async function requireMedal(id: string): Promise<CorpsMedalRow> {
  const { data, error } = await supabase
    .from("corps_medals")
    .select("*")
    .eq("id", id)
    .eq("active", true)
    .maybeSingle();
  assertNoDbError(error, "get Corps medal");
  if (!data) {
    throw new UserFacingError("That medal no longer exists.");
  }
  return data;
}

async function ensureMedalRole(guild: Guild, medal: CorpsMedalRow): Promise<CorpsMedalRow> {
  const storedRole = medal.discord_role_id
    ? await guild.roles.fetch(medal.discord_role_id).catch(() => null)
    : null;
  const role = storedRole ?? guild.roles.cache.find((candidate) => candidate.name === medalRoleName(medal.name))
    ?? await guild.roles.create({
      name: medalRoleName(medal.name),
      colors: { primaryColor: 0x6b7a50 },
      hoist: false,
      mentionable: false,
      reason: `Wayfinder Corps medal: ${medal.name}`
    });

  await applyRoleIcon(guild, role, medal);
  if (medal.discord_role_id === role.id) {
    return medal;
  }

  const { data, error } = await supabase
    .from("corps_medals")
    .update({ discord_role_id: role.id })
    .eq("id", medal.id)
    .select("*")
    .single();
  assertNoDbError(error, "attach Corps medal role");
  return data;
}

async function applyRoleIcon(guild: Guild, role: Role, medal: CorpsMedalRow): Promise<void> {
  const value = medal.emoji?.trim() ?? "";
  const emojiName = customEmojiName(value);
  const emoji = guild.emojis.cache.find((candidate) => candidate.name === emojiName);
  if (emoji) {
    if (role.icon) {
      return;
    }
    await role.setIcon(emoji, `Use ${emoji.name} for the ${medal.name} medal role`).catch((error) => {
      console.warn(`Could not set the ${medal.name} medal role icon:`, error);
    });
    return;
  }

  const unicodeEmoji = unicodeRoleEmoji(value);
  if (unicodeEmoji && role.unicodeEmoji !== unicodeEmoji) {
    await role.setUnicodeEmoji(unicodeEmoji, `Use ${unicodeEmoji} for the ${medal.name} medal role`).catch((error) => {
      console.warn(`Could not set the ${medal.name} medal role emoji:`, error);
    });
  }
}

async function addMedalRole(guild: Guild, ranger: RangerRow, medal: CorpsMedalRow): Promise<void> {
  if (!medal.discord_role_id) {
    return;
  }
  const member = await guild.members.fetch(ranger.discord_user_id).catch(() => null);
  if (member && !member.roles.cache.has(medal.discord_role_id)) {
    await member.roles.add(medal.discord_role_id, `Awarded Corps medal: ${medal.name}`);
  }
}

async function notifyMedalRecipient(guild: Guild, discordUserId: string, medal: CorpsMedalRow): Promise<void> {
  const user = await guild.client.users.fetch(discordUserId).catch((error) => {
    console.warn(`Could not fetch ${discordUserId} to notify them about the ${medal.name} medal:`, error);
    return null;
  });
  if (!user) {
    return;
  }

  const emoji = medalEmoji(guild, medal);
  const medalLabel = `${emoji ? `${emoji} ` : ""}**${medal.name}**`;
  await user.send(
    `${medalLabel} has been added to your Ranger record.\n`
      + `**What it recognizes:** ${medal.description}\n`
      + `View your medals with \`/ranger info\` in <#${env.GENERAL_CHANNEL_ID}>.`
  ).catch((error) => {
    console.warn(`Could not notify ${discordUserId} about the ${medal.name} medal:`, error);
  });
}

function medalRoleName(name: string): string {
  return `Medal: ${name}`.slice(0, 100);
}

function normalizeEmoji(value: string | null): string | null {
  return value?.trim() || null;
}

function customEmojiName(value: string): string {
  const match = value.match(/^<a?:([A-Za-z0-9_]+):\d+>$/u);
  return match?.[1] ?? value.replace(/^:+|:+$/gu, "").trim();
}

function unicodeRoleEmoji(value: string): string | null {
  if (!value || /^<a?:[A-Za-z0-9_]+:\d+>$/u.test(value) || /^:?[A-Za-z0-9_]+:?$/u.test(value)) {
    return null;
  }
  return value;
}
