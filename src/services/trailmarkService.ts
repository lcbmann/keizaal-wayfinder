import {
  ActionRowBuilder,
  ChannelType,
  EmbedBuilder,
  type Guild,
  type GuildMember,
  type TextChannel,
  PermissionFlagsBits,
  type Message,
  StringSelectMenuBuilder
} from "discord.js";
import { env } from "../config/env.js";
import { roleIdForRank } from "../config/roles.js";
import { assertNoDbError, supabase, type TrailmarkRow, type TrailmarkSessionRow } from "../db/supabase.js";
import { addMinutes } from "../utils/dates.js";
import { UserFacingError } from "../utils/errors.js";
import { channelNameForTrailmark, slugify } from "../utils/slugs.js";
import { deleteStoredMessages, getStoredTextChannel, saveBotMessageState } from "./botMessageStateService.js";

const TRAILMARK_PANEL_STATE_KEY = "trailmark-panel";
export const NO_TRAILMARK_SELECT_VALUE = "trailmark:none";
const TRAILMARKS_PER_MENU = 24;
const MENUS_PER_MESSAGE = 5;
const TRAILMARKS_PER_MESSAGE = TRAILMARKS_PER_MENU * MENUS_PER_MESSAGE;
const TRAILMARK_FETCH_PAGE_SIZE = 1000;

export async function listActiveTrailmarks(limit = 100): Promise<TrailmarkRow[]> {
  const { data, error } = await supabase
    .from("trailmarks")
    .select("*")
    .eq("active", true)
    .order("pinned", { ascending: false })
    .order("hold", { ascending: true })
    .order("name", { ascending: true })
    .limit(limit);

  assertNoDbError(error, "list trailmarks");
  return data ?? [];
}

export async function listAllActiveTrailmarks(): Promise<TrailmarkRow[]> {
  const trailmarks: TrailmarkRow[] = [];

  for (let from = 0; ; from += TRAILMARK_FETCH_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("trailmarks")
      .select("*")
      .eq("active", true)
      .order("pinned", { ascending: false })
      .order("hold", { ascending: true })
      .order("name", { ascending: true })
      .range(from, from + TRAILMARK_FETCH_PAGE_SIZE - 1);

    assertNoDbError(error, "list all trailmarks");
    trailmarks.push(...(data ?? []));

    if ((data?.length ?? 0) < TRAILMARK_FETCH_PAGE_SIZE) {
      return trailmarks;
    }
  }
}

export async function findTrailmarksByName(query: string): Promise<TrailmarkRow[]> {
  const { data, error } = await supabase
    .from("trailmarks")
    .select("*")
    .eq("active", true)
    .ilike("name", `%${query}%`)
    .order("pinned", { ascending: false })
    .order("name", { ascending: true })
    .limit(25);

  assertNoDbError(error, "find trailmarks");
  return data ?? [];
}

export async function getTrailmark(id: string): Promise<TrailmarkRow | null> {
  const { data, error } = await supabase.from("trailmarks").select("*").eq("id", id).maybeSingle();
  assertNoDbError(error, "get trailmark");
  return data;
}

export async function getActiveTrailmarkByChannelId(channelId: string): Promise<TrailmarkRow | null> {
  const { data, error } = await supabase
    .from("trailmarks")
    .select("*")
    .eq("discord_channel_id", channelId)
    .eq("active", true)
    .maybeSingle();

  assertNoDbError(error, "get active Trailmark by channel");
  return data;
}

export async function createTrailmark(params: {
  guild: Guild;
  name: string;
  hold: string;
  locationDescription: string;
  screenshotUrl?: string | null;
  atlasLocationId?: string | null;
  createdByDiscordUserId: string;
}): Promise<TrailmarkRow> {
  const slug = slugify(params.name);
  const channel = await params.guild.channels.create({
    name: channelNameForTrailmark(params.name),
    type: ChannelType.GuildText,
    parent: env.TRAILMARK_CATEGORY_ID,
    reason: `Create Ranger Trailmark ${params.name}`,
    permissionOverwrites: [
      {
        id: params.guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel]
      },
      {
        id: params.guild.client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.ReadMessageHistory
        ]
      },
      {
        id: roleIdForRank("Ranger Commander"),
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
      },
      {
        id: roleIdForRank("Ranger Captain"),
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
      }
    ]
  });

  const { data, error } = await supabase
    .from("trailmarks")
    .insert({
      name: params.name,
      slug,
      hold: params.hold,
      location_description: params.locationDescription,
      screenshot_url: params.screenshotUrl ?? null,
      discord_channel_id: channel.id,
      atlas_location_id: params.atlasLocationId ?? null,
      active: true,
      pinned: false,
      created_by_discord_user_id: params.createdByDiscordUserId
    })
    .select("*")
    .single();

  assertNoDbError(error, "create trailmark");
  await postTrailmarkInfo(channel, data);
  await refreshStoredTrailmarkPanel(params.guild);
  return data;
}

export async function deactivateTrailmark(id: string, guild?: Guild): Promise<TrailmarkRow> {
  const { data, error } = await supabase
    .from("trailmarks")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();

  assertNoDbError(error, "deactivate trailmark");
  if (guild) {
    await refreshStoredTrailmarkPanel(guild);
  }
  return data;
}

export async function editTrailmark(params: {
  guild: Guild;
  id: string;
  name?: string;
  hold?: string;
  locationDescription?: string;
  screenshotUrl?: string | null;
  atlasLocationId?: string | null;
  pinned?: boolean;
}): Promise<TrailmarkRow> {
  const existing = await getTrailmark(params.id);
  if (!existing) {
    throw new UserFacingError("Trailmark was not found.");
  }

  const updates: Partial<TrailmarkRow> = { updated_at: new Date().toISOString() };
  if (params.name) {
    updates.name = params.name;
    updates.slug = slugify(params.name);
  }

  if (params.hold) {
    updates.hold = params.hold;
  }

  if (params.locationDescription) {
    updates.location_description = params.locationDescription;
  }

  if ("screenshotUrl" in params) {
    updates.screenshot_url = params.screenshotUrl ?? null;
  }

  if ("atlasLocationId" in params) {
    updates.atlas_location_id = params.atlasLocationId ?? null;
  }

  if ("pinned" in params) {
    updates.pinned = params.pinned;
  }

  if (Object.keys(updates).length === 1) {
    throw new UserFacingError("Provide at least one Trailmark field to edit.");
  }

  const { data, error } = await supabase
    .from("trailmarks")
    .update(updates)
    .eq("id", params.id)
    .select("*")
    .single();

  assertNoDbError(error, "edit trailmark");

  const channel = await requireTrailmarkTextChannel(params.guild, data.discord_channel_id);
  if (params.name && channel.name !== channelNameForTrailmark(data.name)) {
    await channel.setName(channelNameForTrailmark(data.name), `Rename Ranger Trailmark ${data.name}`);
  }

  await postTrailmarkInfo(channel, data, { titlePrefix: "Trailmark Updated", timestamp: new Date() });
  await refreshStoredTrailmarkPanel(params.guild);
  return data;
}

export async function updateTrailmarkAtlasLocation(id: string, atlasLocationId: string | null): Promise<TrailmarkRow> {
  const { data, error } = await supabase
    .from("trailmarks")
    .update({ atlas_location_id: atlasLocationId, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();

  assertNoDbError(error, "update trailmark Atlas location");
  return data;
}

export async function revokeActiveTrailmarkAccess(guild: Guild, discordUserId: string): Promise<number> {
  const { data, error } = await supabase
    .from("trailmark_sessions")
    .select("*")
    .eq("discord_user_id", discordUserId)
    .eq("active", true);

  assertNoDbError(error, "get active trailmark sessions");

  let revoked = 0;
  for (const session of data ?? []) {
    await revokeSession(guild, session);
    revoked += 1;
  }

  return revoked;
}

export async function grantTrailmarkAccess(params: {
  guild: Guild;
  member: GuildMember;
  trailmark: TrailmarkRow;
  minutes: number;
}): Promise<TrailmarkSessionRow> {
  await revokeActiveTrailmarkAccess(params.guild, params.member.id);

  const channel = await requireTrailmarkTextChannel(params.guild, params.trailmark.discord_channel_id);
  await channel.permissionOverwrites.edit(
    params.member.id,
    {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true
    },
    { reason: `Temporary Trailmark access for ${params.member.user.tag}` }
  );

  const expiresAt = addMinutes(new Date(), params.minutes).toISOString();
  const { data, error } = await supabase
    .from("trailmark_sessions")
    .insert({
      discord_user_id: params.member.id,
      trailmark_id: params.trailmark.id,
      discord_channel_id: params.trailmark.discord_channel_id,
      expires_at: expiresAt,
      active: true
    })
    .select("*")
    .single();

  assertNoDbError(error, "store trailmark session");
  return data;
}

export async function leaveTrailmark(guild: Guild, discordUserId: string): Promise<number> {
  return revokeActiveTrailmarkAccess(guild, discordUserId);
}

export async function expireTrailmarkSessions(guild: Guild): Promise<number> {
  const { data, error } = await supabase
    .from("trailmark_sessions")
    .select("*")
    .eq("active", true)
    .lte("expires_at", new Date().toISOString())
    .limit(100);

  assertNoDbError(error, "get expired trailmark sessions");

  let expired = 0;
  for (const session of data ?? []) {
    try {
      await revokeSession(guild, session);
      expired += 1;
    } catch (error) {
      console.error(`Failed to expire trailmark session ${session.id}:`, error);
    }
  }

  return expired;
}

export async function listActiveTrailmarkSessions(): Promise<TrailmarkSessionRow[]> {
  const { data, error } = await supabase
    .from("trailmark_sessions")
    .select("*")
    .eq("active", true)
    .order("expires_at", { ascending: true })
    .limit(100);

  assertNoDbError(error, "list active trailmark sessions");
  return data ?? [];
}

async function revokeSession(guild: Guild, session: TrailmarkSessionRow): Promise<void> {
  try {
    const channel = await requireTrailmarkTextChannel(guild, session.discord_channel_id);
    await channel.permissionOverwrites.delete(session.discord_user_id, "Trailmark session ended");
  } catch (error) {
    console.warn(`Could not revoke Trailmark channel access for ${session.discord_user_id}:`, error);
  }

  const { error } = await supabase
    .from("trailmark_sessions")
    .update({ active: false })
    .eq("id", session.id);

  assertNoDbError(error, "mark trailmark session inactive");
}

async function requireTrailmarkTextChannel(guild: Guild, channelId: string): Promise<TextChannel> {
  const channel = await guild.channels.fetch(channelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new UserFacingError("Trailmark channel was not found or is not a text channel.");
  }

  return channel;
}

export async function postTrailmarkPanel(channel: TextChannel): Promise<void> {
  await deleteStoredMessages(channel.guild, TRAILMARK_PANEL_STATE_KEY);
  const messages = await sendTrailmarkPanel(channel);
  await saveBotMessageState(TRAILMARK_PANEL_STATE_KEY, channel.id, messages.map((message) => message.id));
}

export async function refreshStoredTrailmarkPanel(guild: Guild): Promise<boolean> {
  const channel = await getStoredTextChannel(guild, TRAILMARK_PANEL_STATE_KEY);
  if (!channel) {
    return false;
  }

  await postTrailmarkPanel(channel);
  return true;
}

async function sendTrailmarkPanel(channel: TextChannel): Promise<Message[]> {
  const trailmarks = await listAllActiveTrailmarks();
  const sentMessages: Message[] = [];

  const embed = new EmbedBuilder()
    .setTitle("Ranger Trailmarks")
    .setDescription(
      "Apprentice or higher required. Select the Trailmark your character is physically visiting. Access lasts for a short time and replaces any previous Trailmark access."
    )
    .setColor(0x3f6f4e);

  if (trailmarks.length === 0) {
    sentMessages.push(await channel.send({ embeds: [embed.setDescription("No active Trailmarks exist yet.")] }));
    return sentMessages;
  }

  for (let start = 0; start < trailmarks.length; start += TRAILMARKS_PER_MESSAGE) {
    const messageTrailmarks = trailmarks.slice(start, start + TRAILMARKS_PER_MESSAGE);
    const messageIndex = Math.floor(start / TRAILMARKS_PER_MESSAGE);
    const rows = chunk(messageTrailmarks, TRAILMARKS_PER_MENU).map((menuTrailmarks, menuIndex) =>
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`trailmark:select:${messageIndex}:${menuIndex}`)
          .setPlaceholder(`Choose a Trailmark ${rangeLabel(start + menuIndex * TRAILMARKS_PER_MENU, menuTrailmarks.length)}`)
          .addOptions({
            label: "No Trailmark",
            description: "Leave your current Trailmark and remove temporary access.",
            value: NO_TRAILMARK_SELECT_VALUE
          })
          .addOptions(
            menuTrailmarks.map((trailmark) => ({
              label: `${trailmark.name} (${trailmark.hold})`.slice(0, 100),
              description: truncateSelectDescription(
                trailmark.pinned ? `Pinned - ${trailmark.location_description}` : trailmark.location_description
              ),
              value: trailmark.id
            }))
          )
      )
    );

    sentMessages.push(await channel.send({
      embeds: [messageIndex === 0 ? embed : EmbedBuilder.from(embed).setTitle("Ranger Trailmarks Continued")],
      components: rows
    }));
  }

  return sentMessages;
}

async function postTrailmarkInfo(
  channel: TextChannel,
  trailmark: TrailmarkRow,
  options: { titlePrefix?: string; timestamp?: Date } = {}
): Promise<void> {
  const embed = new EmbedBuilder()
    .setTitle(options.titlePrefix ? `${options.titlePrefix}: ${trailmark.name}` : trailmark.name)
    .setDescription(trailmark.location_description.slice(0, 4096))
    .addFields({ name: "Hold", value: trailmark.hold, inline: true })
    .addFields({ name: "Pinned", value: trailmark.pinned ? "Yes" : "No", inline: true })
    .setColor(0x587c4a)
    .setTimestamp(options.timestamp ?? new Date(trailmark.created_at));

  if (trailmark.atlas_location_id) {
    embed.addFields({ name: "Atlas Location ID", value: trailmark.atlas_location_id, inline: true });
  }

  if (trailmark.screenshot_url) {
    embed.setImage(trailmark.screenshot_url);
  }

  await channel.send({ embeds: [embed] });
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function rangeLabel(startIndex: number, count: number): string {
  return `(${startIndex + 1}-${startIndex + count})`;
}

function truncateSelectDescription(description: string): string {
  if (description.length <= 100) {
    return description;
  }

  return `${description.slice(0, 97).trimEnd()}...`;
}
