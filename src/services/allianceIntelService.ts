import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type CategoryChannel,
  type Client,
  type Guild,
  type GuildBasedChannel,
  type GuildMember,
  type Message,
  type NewsChannel,
  type TextChannel
} from "discord.js";
import { env } from "../config/env.js";
import {
  assertNoDbError,
  supabase,
  type AllianceHeadquartersDeliveryRow,
  type AllianceHeadquartersPublicationRow,
  type AllianceHeadquartersRow,
  type AllianceReportRow,
  type IntelReportRow,
  type IntelTopicRow,
  type TrailmarkRow
} from "../db/supabase.js";
import { UserFacingError } from "../utils/errors.js";
import { matchingIntelTopics } from "../utils/intelKeywords.js";
import { slugify } from "../utils/slugs.js";
import { createTrailmark } from "./trailmarkService.js";
import { atlasReportFieldValue } from "./atlasService.js";

const MAX_DESCRIPTION_LENGTH = 4000;
const ALLY_REPORTS_CHANNEL_NAME = "ally-reports";
type ReportChannel = TextChannel | NewsChannel;

interface HeadquartersDefinition {
  key: "north-star" | "undaunted";
  name: string;
  sourceOrder: string;
  viewerRoleId: string;
  categoryName: string;
  intakeChannelName: string;
  trailmarkName: string;
  trailmarkHold: string;
  trailmarkDescription: string;
}

export interface AllianceSetupResult {
  headquarters: number;
  topicChannels: number;
  allianceReportsMigrated: number;
}

export interface AllianceStatus {
  configured: boolean;
  headquarters: number;
  topicChannels: number;
  deliveredReports: number;
  allianceReports: number;
}

export function allianceBridgeConfigured(): boolean {
  return allianceRequiredIds().every(Boolean);
}

export function isAllianceGuildId(guildId: string | null | undefined): boolean {
  return Boolean(env.RANGER_ALLIANCE_GUILD_ID && guildId === env.RANGER_ALLIANCE_GUILD_ID);
}

export function isAllianceLeader(member: GuildMember): boolean {
  return Boolean(env.RANGER_ALLIANCE_ROLE_LEADERS_ID && member.roles.cache.has(env.RANGER_ALLIANCE_ROLE_LEADERS_ID));
}

export function isCorpsOnlyReport(content: string): boolean {
  return content.toLocaleLowerCase().includes(env.RANGER_ALLIANCE_PRIVATE_MARKER.toLocaleLowerCase());
}

export async function setupAllianceBridge(client: Client): Promise<AllianceSetupResult> {
  requireAllianceConfiguration();
  const [corpsGuild, allianceGuild] = await fetchBridgeGuilds(client);
  await validateDiscordConfiguration(corpsGuild, allianceGuild);
  await archiveLegacyAllianceCategory(allianceGuild);

  const topics = await listActiveTopics();
  const headquarters: AllianceHeadquartersRow[] = [];
  let topicChannels = 0;
  for (const definition of headquartersDefinitions()) {
    const hq = await ensureHeadquarters(corpsGuild, allianceGuild, definition);
    headquarters.push(hq);
    for (const topic of topics) {
      await ensureHeadquartersTopicChannel(allianceGuild, hq, topic);
      topicChannels += 1;
    }
  }

  const allianceReportsMigrated = await migrateStoredAllianceReports(client, headquarters);
  const { data: deliveredAllianceReports, error: deliveredError } = await supabase
    .from("intel_reports")
    .select("*")
    .not("source_alliance_report_id", "is", null)
    .not("delivered_at", "is", null)
    .order("created_at", { ascending: true });
  assertNoDbError(deliveredError, "list delivered Alliance reports for Corps archive");
  await publishDeliveredAllianceReportsToCorps(corpsGuild, deliveredAllianceReports ?? []);
  return { headquarters: headquarters.length, topicChannels, allianceReportsMigrated };
}

export async function getAllianceStatus(): Promise<AllianceStatus> {
  if (!allianceBridgeConfigured()) {
    return { configured: false, headquarters: 0, topicChannels: 0, deliveredReports: 0, allianceReports: 0 };
  }

  const [hqResult, topicResult, deliveryResult, reportsResult] = await Promise.all([
    supabase.from("alliance_headquarters").select("id", { count: "exact", head: true }).eq("active", true),
    supabase.from("alliance_headquarters_topic_channels").select("topic_id", { count: "exact", head: true }),
    supabase.from("alliance_headquarters_deliveries").select("report_id", { count: "exact", head: true }),
    supabase.from("alliance_reports").select("id", { count: "exact", head: true })
  ]);
  assertNoDbError(hqResult.error, "count Alliance headquarters");
  assertNoDbError(topicResult.error, "count Alliance headquarters topic channels");
  assertNoDbError(deliveryResult.error, "count Alliance headquarters deliveries");
  assertNoDbError(reportsResult.error, "count Alliance reports");
  return {
    configured: (hqResult.count ?? 0) > 0,
    headquarters: hqResult.count ?? 0,
    topicChannels: topicResult.count ?? 0,
    deliveredReports: deliveryResult.count ?? 0,
    allianceReports: reportsResult.count ?? 0
  };
}

export async function syncAllianceTopicMirrors(client: Client): Promise<number> {
  if (!allianceBridgeConfigured()) {
    return 0;
  }
  const allianceGuild = await client.guilds.fetch(env.RANGER_ALLIANCE_GUILD_ID);
  const [headquarters, topics] = await Promise.all([listHeadquarters(), listActiveTopics()]);
  for (const hq of headquarters) {
    for (const topic of topics) {
      await ensureHeadquartersTopicChannel(allianceGuild, hq, topic);
    }
  }
  return headquarters.length * topics.length;
}

export async function handleAllianceReportMessage(message: Message): Promise<boolean> {
  if (!isAllianceGuildId(message.guildId) || message.author.bot) {
    return false;
  }

  const hq = await getHeadquartersByIntakeChannel(message.channelId);
  if (!hq) {
    return false;
  }
  const member = message.member ?? await message.guild?.members.fetch(message.author.id).catch(() => null);
  if (!member || (!member.roles.cache.has(hq.viewer_role_id) && !isAllianceLeader(member))) {
    await message.reply({
      content: `Only ${hq.source_order} members and Alliance Leaders may submit reports here.`,
      allowedMentions: { repliedUser: false }
    });
    return true;
  }

  const content = message.content.trim();
  const attachmentUrls = [...message.attachments.values()].map((attachment) => attachment.url);
  if (!content && attachmentUrls.length === 0) {
    return true;
  }

  const existing = await getAllianceReportByDiscordMessageId(message.id);
  const values = {
    discord_message_id: message.id,
    discord_channel_id: message.channelId,
    author_discord_user_id: message.author.id,
    author_display_name: member.displayName,
    source_order: hq.source_order,
    content,
    attachment_urls: attachmentUrls,
    headquarters_id: hq.id,
    created_at: message.createdAt.toISOString()
  };

  let report: AllianceReportRow;
  if (existing) {
    const { data, error } = await supabase.from("alliance_reports").update(values).eq("id", existing.id).select("*").single();
    assertNoDbError(error, "update allied headquarters report");
    report = data;
  } else {
    const { data, error } = await supabase.from("alliance_reports").insert({
      ...values,
      corps_ally_channel_id: null,
      corps_ally_message_id: null,
      trailmark_message_channel_id: null,
      trailmark_message_id: null
    }).select("*").single();
    assertNoDbError(error, "create allied headquarters report");
    report = data;
  }

  await synchronizeAllianceReport(message.client, report, hq);
  return true;
}

export async function removeAllianceReportForDiscordMessage(
  client: Client,
  _channelId: string,
  messageId: string
): Promise<boolean> {
  const report = await getAllianceReportByDiscordMessageId(messageId);
  if (!report) {
    return false;
  }

  await deleteMessageIfPresent(client, env.DISCORD_GUILD_ID, report.trailmark_message_channel_id, report.trailmark_message_id);
  const { data: intelReports, error } = await supabase
    .from("intel_reports")
    .select("*")
    .eq("source_alliance_report_id", report.id);
  assertNoDbError(error, "list intel records for deleted Alliance report");
  for (const intelReport of intelReports ?? []) {
    await deleteIntelReportCopies(client, intelReport);
  }
  const { error: deleteError } = await supabase.from("alliance_reports").delete().eq("id", report.id);
  assertNoDbError(deleteError, "delete Alliance report");
  return true;
}

export async function publishDeliveredAllianceReportsToCorps(
  corpsGuild: Guild,
  reports: IntelReportRow[]
): Promise<number> {
  const sourceReportIds = [...new Set(reports
    .map((report) => report.source_alliance_report_id)
    .filter((reportId): reportId is string => Boolean(reportId)))];
  if (sourceReportIds.length === 0) {
    return 0;
  }

  const { data: allianceReports, error } = await supabase
    .from("alliance_reports")
    .select("*")
    .in("id", sourceReportIds)
    .order("created_at", { ascending: true });
  assertNoDbError(error, "list delivered Alliance reports");
  if (!allianceReports?.length) {
    return 0;
  }

  const channel = await ensureCorpsAllyReportsChannel(corpsGuild);
  for (const report of allianceReports) {
    const message = await sendOrEditMessage(channel, report.corps_ally_message_id, allianceReportEmbed(report));
    if (report.corps_ally_channel_id !== channel.id || report.corps_ally_message_id !== message.id) {
      const { error: updateError } = await supabase.from("alliance_reports").update({
        corps_ally_channel_id: channel.id,
        corps_ally_message_id: message.id
      }).eq("id", report.id);
      assertNoDbError(updateError, "store Corps Ally Reports publication");
    }
  }
  return allianceReports.length;
}

export async function deliverReportsOriginatingAtAllianceHeadquarters(params: {
  guild: Guild;
  trailmark: TrailmarkRow;
  deliveredByDiscordUserId: string;
  discordMessageId?: string;
}): Promise<number> {
  const hq = await getHeadquartersByTrailmarkId(params.trailmark.id);
  if (!hq) {
    return 0;
  }

  let query = supabase.from("intel_reports").select("*").eq("trailmark_id", params.trailmark.id);
  if (params.discordMessageId) {
    query = query.eq("discord_message_id", params.discordMessageId);
  }
  const { data: reports, error } = await query;
  assertNoDbError(error, "list reports originating at allied headquarters");
  return deliverReportsToHeadquarters({
    guild: params.guild,
    headquarters: hq,
    reports: reports ?? [],
    deliveredByDiscordUserId: params.deliveredByDiscordUserId,
    deliveredAt: new Date().toISOString()
  });
}

export async function deliverCarriedReportsToAllianceHeadquarters(params: {
  guild: Guild;
  discordUserId: string;
  trailmark: TrailmarkRow;
  hqVisitedAt: string;
}): Promise<number> {
  const hq = await getHeadquartersByTrailmarkId(params.trailmark.id);
  if (!hq) {
    return 0;
  }

  let delivered = await deliverReportsOriginatingAtAllianceHeadquarters({
    guild: params.guild,
    trailmark: params.trailmark,
    deliveredByDiscordUserId: params.discordUserId
  });

  const { data: sessions, error: sessionsError } = await supabase
    .from("trailmark_sessions")
    .select("*")
    .eq("discord_user_id", params.discordUserId)
    .neq("trailmark_id", params.trailmark.id)
    .lte("created_at", params.hqVisitedAt);
  assertNoDbError(sessionsError, "list Trailmark sessions carried to allied headquarters");
  if (!sessions?.length) {
    return delivered;
  }

  const sourceIds = [...new Set(sessions.map((session) => session.trailmark_id))];
  const { data: reports, error: reportsError } = await supabase
    .from("intel_reports")
    .select("*")
    .in("trailmark_id", sourceIds)
    .order("created_at", { ascending: true });
  assertNoDbError(reportsError, "list reports carried to allied headquarters");

  const deliverable = (reports ?? []).filter((report) => sessions.some((session) => {
    if (session.trailmark_id !== report.trailmark_id) {
      return false;
    }
    const carriedThrough = Math.min(Date.parse(session.expires_at), Date.parse(params.hqVisitedAt));
    return Date.parse(report.created_at) <= carriedThrough;
  }));
  delivered += await deliverReportsToHeadquarters({
    guild: params.guild,
    headquarters: hq,
    reports: deliverable,
    deliveredByDiscordUserId: params.discordUserId,
    deliveredAt: params.hqVisitedAt
  });
  return delivered;
}

export async function syncCorpsReportAlliancePrivacyForMessage(message: Message): Promise<number> {
  if (message.guildId !== env.DISCORD_GUILD_ID || message.author.bot) {
    return 0;
  }
  const { data: reports, error } = await supabase
    .from("intel_reports")
    .select("*")
    .eq("discord_channel_id", message.channelId)
    .eq("discord_message_id", message.id);
  assertNoDbError(error, "list edited Corps intel reports");
  if (!reports?.length) {
    return 0;
  }

  const content = message.content.trim();
  const { error: updateError } = await supabase
    .from("intel_reports")
    .update({ content })
    .eq("discord_channel_id", message.channelId)
    .eq("discord_message_id", message.id);
  assertNoDbError(updateError, "update edited Corps intel report content");

  for (const report of reports.map((item) => ({ ...item, content }))) {
    const { data: deliveries, error: deliveriesError } = await supabase
      .from("alliance_headquarters_deliveries")
      .select("*")
      .eq("report_id", report.id);
    assertNoDbError(deliveriesError, "list allied deliveries for edited report");
    for (const delivery of deliveries ?? []) {
      const hq = await getHeadquarters(delivery.headquarters_id);
      if (hq) {
        await publishHeadquartersReport(message.guild!, hq, report, delivery);
      }
    }
  }
  return reports.length;
}

export async function removeCorpsIntelReportFromAlliance(client: Client, reportId: string): Promise<void> {
  const { data: publications, error } = await supabase
    .from("alliance_headquarters_publications")
    .select("*")
    .eq("report_id", reportId);
  if (!error) {
    for (const publication of publications ?? []) {
      await deleteMessageIfPresent(
        client,
        env.RANGER_ALLIANCE_GUILD_ID,
        publication.discord_channel_id,
        publication.discord_message_id
      );
    }
  }

  const { data: legacy, error: legacyError } = await supabase
    .from("alliance_intel_publications")
    .select("*")
    .eq("report_id", reportId)
    .maybeSingle();
  if (!legacyError && legacy) {
    await deleteMessageIfPresent(client, env.RANGER_ALLIANCE_GUILD_ID, legacy.alliance_channel_id, legacy.alliance_message_id);
  }
}

async function synchronizeAllianceReport(client: Client, report: AllianceReportRow, hq: AllianceHeadquartersRow): Promise<void> {
  const corpsGuild = await client.guilds.fetch(env.DISCORD_GUILD_ID);
  const trailmark = await getTrailmark(hq.trailmark_id);
  if (!trailmark) {
    throw new UserFacingError(`${hq.name} Trailmark was not found.`);
  }
  const trailmarkChannel = await requireTextChannel(corpsGuild, trailmark.discord_channel_id);
  const trailmarkEmbed = allianceTrailmarkNoteEmbed(report, hq);
  const trailmarkMessage = await sendOrEditMessage(trailmarkChannel, report.trailmark_message_id, trailmarkEmbed);
  if (report.trailmark_message_id !== trailmarkMessage.id || report.trailmark_message_channel_id !== trailmarkChannel.id) {
    const { error } = await supabase.from("alliance_reports").update({
      trailmark_message_channel_id: trailmarkChannel.id,
      trailmark_message_id: trailmarkMessage.id
    }).eq("id", report.id);
    assertNoDbError(error, "store allied Trailmark note message");
  }

  const topics = await routedTopics(report.content);
  const topicIds = new Set(topics.map((topic) => topic.id));
  const { data: existingReports, error: existingError } = await supabase
    .from("intel_reports")
    .select("*")
    .eq("source_alliance_report_id", report.id);
  assertNoDbError(existingError, "list intel records for Alliance report");

  for (const existing of existingReports ?? []) {
    if (!topicIds.has(existing.topic_id)) {
      await deleteIntelReportCopies(client, existing);
    }
  }

  for (const topic of topics) {
    const existing = (existingReports ?? []).find((item) => item.topic_id === topic.id);
    let intelReport: IntelReportRow;
    if (existing) {
      const { data, error } = await supabase.from("intel_reports").update({
        content: report.content,
        author_display_name: report.author_display_name,
        source_order: report.source_order,
        discord_message_id: trailmarkMessage.id,
        discord_channel_id: trailmarkChannel.id,
        trailmark_id: trailmark.id
      }).eq("id", existing.id).select("*").single();
      assertNoDbError(error, "update intel record for Alliance report");
      intelReport = data;
    } else {
      const { data, error } = await supabase.from("intel_reports").insert({
        topic_id: topic.id,
        trailmark_id: trailmark.id,
        discord_message_id: trailmarkMessage.id,
        discord_channel_id: trailmarkChannel.id,
        author_discord_user_id: report.author_discord_user_id,
        author_display_name: report.author_display_name,
        source_order: report.source_order,
        source_alliance_report_id: report.id,
        content: report.content,
        delivered_by_discord_user_id: null,
        delivered_to_trailmark_id: null,
        delivered_at: null,
        created_at: report.created_at
      }).select("*").single();
      assertNoDbError(error, "create intel record for Alliance report");
      intelReport = data;
    }

    const delivery = await upsertHeadquartersDelivery(intelReport.id, hq.id, report.author_discord_user_id, report.created_at);
    await publishHeadquartersReport(corpsGuild, hq, intelReport, delivery);
  }
}

async function deliverReportsToHeadquarters(params: {
  guild: Guild;
  headquarters: AllianceHeadquartersRow;
  reports: IntelReportRow[];
  deliveredByDiscordUserId: string;
  deliveredAt: string;
}): Promise<number> {
  const eligible = params.reports.filter((report) => !isCorpsOnlyReport(report.content));
  if (eligible.length === 0) {
    return 0;
  }
  const { data: existing, error } = await supabase
    .from("alliance_headquarters_deliveries")
    .select("report_id")
    .eq("headquarters_id", params.headquarters.id)
    .in("report_id", eligible.map((report) => report.id));
  assertNoDbError(error, "list existing allied headquarters deliveries");
  const existingIds = new Set((existing ?? []).map((delivery) => delivery.report_id));
  const fresh = eligible.filter((report) => !existingIds.has(report.id));
  for (const report of fresh) {
    const delivery = await upsertHeadquartersDelivery(
      report.id,
      params.headquarters.id,
      params.deliveredByDiscordUserId,
      params.deliveredAt
    );
    await publishHeadquartersReport(params.guild, params.headquarters, report, delivery);
  }
  return fresh.length;
}

async function publishHeadquartersReport(
  corpsGuild: Guild,
  hq: AllianceHeadquartersRow,
  report: IntelReportRow,
  delivery: AllianceHeadquartersDeliveryRow
): Promise<void> {
  const { data: existing, error } = await supabase
    .from("alliance_headquarters_publications")
    .select("*")
    .eq("report_id", report.id)
    .eq("headquarters_id", hq.id)
    .maybeSingle();
  assertNoDbError(error, "get allied headquarters publication");

  if (isCorpsOnlyReport(report.content)) {
    if (existing) {
      await deleteHeadquartersPublication(corpsGuild.client, existing);
    }
    return;
  }

  const allianceGuild = await corpsGuild.client.guilds.fetch(env.RANGER_ALLIANCE_GUILD_ID);
  const topic = await getTopic(report.topic_id);
  if (!topic) {
    return;
  }
  const channel = await ensureHeadquartersTopicChannel(allianceGuild, hq, topic);
  const trailmark = await getTrailmark(report.trailmark_id);
  const embed = await headquartersReportEmbed(corpsGuild, hq, report, delivery, trailmark);
  const message = await sendOrEditMessage(channel, existing?.discord_message_id ?? null, embed);
  const { error: upsertError } = await supabase.from("alliance_headquarters_publications").upsert({
    report_id: report.id,
    headquarters_id: hq.id,
    discord_channel_id: channel.id,
    discord_message_id: message.id
  });
  assertNoDbError(upsertError, "store allied headquarters publication");
}

async function ensureHeadquarters(
  corpsGuild: Guild,
  allianceGuild: Guild,
  definition: HeadquartersDefinition
): Promise<AllianceHeadquartersRow> {
  const { data: stored, error: storedError } = await supabase.from("alliance_headquarters")
    .select("*")
    .eq("headquarters_key", definition.key)
    .maybeSingle();
  assertNoDbError(storedError, `get stored ${definition.name} headquarters configuration`);
  const trailmark = await ensureHeadquartersTrailmark(corpsGuild, definition, stored?.trailmark_id ?? null);
  const category = await ensureHeadquartersCategory(allianceGuild, definition, stored?.reports_category_id ?? null);
  const intake = await ensureIntakeChannel(allianceGuild, category, definition, stored?.intake_channel_id ?? null);
  const { data, error } = await supabase.from("alliance_headquarters").upsert({
    headquarters_key: definition.key,
    name: definition.name,
    source_order: definition.sourceOrder,
    trailmark_id: trailmark.id,
    alliance_guild_id: allianceGuild.id,
    viewer_role_id: definition.viewerRoleId,
    reports_category_id: category.id,
    intake_channel_id: intake.id,
    active: true
  }, { onConflict: "headquarters_key" }).select("*").single();
  assertNoDbError(error, `store ${definition.name} headquarters configuration`);
  return data;
}

async function ensureHeadquartersTrailmark(
  guild: Guild,
  definition: HeadquartersDefinition,
  storedTrailmarkId: string | null
): Promise<TrailmarkRow> {
  if (storedTrailmarkId) {
    const stored = await getTrailmark(storedTrailmarkId);
    if (stored?.active) {
      return stored;
    }
  }
  const slug = slugify(definition.trailmarkName);
  const { data, error } = await supabase.from("trailmarks").select("*").eq("slug", slug).maybeSingle();
  assertNoDbError(error, `find ${definition.name} Trailmark`);
  if (data) {
    return data;
  }
  return createTrailmark({
    guild,
    name: definition.trailmarkName,
    hold: definition.trailmarkHold,
    locationDescription: definition.trailmarkDescription,
    createdByDiscordUserId: guild.client.user.id
  });
}

async function ensureHeadquartersCategory(
  guild: Guild,
  definition: HeadquartersDefinition,
  storedCategoryId: string | null
): Promise<CategoryChannel> {
  if (storedCategoryId) {
    const stored = await guild.channels.fetch(storedCategoryId).catch(() => null);
    if (stored?.type === ChannelType.GuildCategory) {
      await configureHeadquartersCategory(stored, definition.viewerRoleId);
      return stored;
    }
  }
  await guild.channels.fetch();
  const existing = guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildCategory && channel.name === definition.categoryName
  );
  if (existing?.type === ChannelType.GuildCategory) {
    await configureHeadquartersCategory(existing, definition.viewerRoleId);
    return existing;
  }
  const category = await guild.channels.create({
    name: definition.categoryName,
    type: ChannelType.GuildCategory,
    reason: `Create ${definition.name} intel section`
  });
  await configureHeadquartersCategory(category, definition.viewerRoleId);
  return category;
}

async function configureHeadquartersCategory(category: CategoryChannel, viewerRoleId: string): Promise<void> {
  await category.permissionOverwrites.edit(category.guild.roles.everyone.id, { ViewChannel: false });
  await category.permissionOverwrites.edit(viewerRoleId, { ViewChannel: true, ReadMessageHistory: true });
  await category.permissionOverwrites.delete(env.RANGER_ALLIANCE_ROLE_LEADERS_ID).catch(() => undefined);
  await category.permissionOverwrites.edit(category.guild.client.user.id, {
    ViewChannel: true,
    SendMessages: true,
    EmbedLinks: true,
    ReadMessageHistory: true,
    ManageChannels: true
  });
}

async function ensureIntakeChannel(
  guild: Guild,
  category: CategoryChannel,
  definition: HeadquartersDefinition,
  storedChannelId: string | null
): Promise<TextChannel> {
  if (storedChannelId) {
    const stored = await guild.channels.fetch(storedChannelId).catch(() => null);
    if (stored?.type === ChannelType.GuildText) {
      await stored.permissionOverwrites.edit(guild.roles.everyone.id, { ViewChannel: false });
      await stored.permissionOverwrites.edit(definition.viewerRoleId, { ViewChannel: true, SendMessages: true });
      await stored.permissionOverwrites.delete(env.RANGER_ALLIANCE_ROLE_LEADERS_ID).catch(() => undefined);
      await stored.permissionOverwrites.edit(guild.client.user.id, { SendMessages: true, EmbedLinks: true });
      return stored;
    }
  }
  await guild.channels.fetch();
  const existing = guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildText
      && channel.parentId === category.id
      && channel.name === definition.intakeChannelName
  );
  const channel = existing?.type === ChannelType.GuildText
    ? existing
    : await guild.channels.create({
        name: definition.intakeChannelName,
        type: ChannelType.GuildText,
        parent: category.id,
        reason: `Create ${definition.name} report intake`
      });
  await channel.permissionOverwrites.edit(guild.roles.everyone.id, { ViewChannel: false });
  await channel.permissionOverwrites.edit(definition.viewerRoleId, { ViewChannel: true, SendMessages: true });
  await channel.permissionOverwrites.delete(env.RANGER_ALLIANCE_ROLE_LEADERS_ID).catch(() => undefined);
  await channel.permissionOverwrites.edit(guild.client.user.id, { SendMessages: true, EmbedLinks: true });
  return channel;
}

async function ensureHeadquartersTopicChannel(
  guild: Guild,
  hq: AllianceHeadquartersRow,
  topic: IntelTopicRow
): Promise<TextChannel> {
  const { data: stored, error } = await supabase
    .from("alliance_headquarters_topic_channels")
    .select("*")
    .eq("headquarters_id", hq.id)
    .eq("topic_id", topic.id)
    .maybeSingle();
  assertNoDbError(error, "get allied headquarters topic channel");
  if (stored) {
    const channel = await guild.channels.fetch(stored.discord_channel_id).catch(() => null);
    if (channel?.type === ChannelType.GuildText) {
      await configureHeadquartersTopicChannel(channel, hq);
      return channel;
    }
  }

  await guild.channels.fetch();
  const channelName = `${slugify(topic.name)}-reports`.slice(0, 90);
  const existing = guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildText
      && channel.parentId === hq.reports_category_id
      && channel.name === channelName
  );
  const channel = existing?.type === ChannelType.GuildText
    ? existing
    : await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: hq.reports_category_id,
        reason: `Create ${hq.name} ${topic.name} reports`
      });
  await configureHeadquartersTopicChannel(channel, hq);

  const { error: upsertError } = await supabase.from("alliance_headquarters_topic_channels").upsert({
    headquarters_id: hq.id,
    topic_id: topic.id,
    discord_channel_id: channel.id
  });
  assertNoDbError(upsertError, "store allied headquarters topic channel");
  return channel;
}

async function configureHeadquartersTopicChannel(
  channel: TextChannel,
  hq: AllianceHeadquartersRow
): Promise<void> {
  await channel.permissionOverwrites.edit(channel.guild.roles.everyone.id, { ViewChannel: false });
  await channel.permissionOverwrites.edit(hq.viewer_role_id, {
    ViewChannel: true,
    SendMessages: false,
    ReadMessageHistory: true
  });
  await channel.permissionOverwrites.delete(env.RANGER_ALLIANCE_ROLE_LEADERS_ID).catch(() => undefined);
  await channel.permissionOverwrites.edit(channel.guild.client.user.id, {
    ViewChannel: true,
    SendMessages: true,
    EmbedLinks: true,
    ReadMessageHistory: true
  });
}

async function archiveLegacyAllianceCategory(guild: Guild): Promise<void> {
  const category = await guild.channels.fetch(env.RANGER_ALLIANCE_REPORTS_CATEGORY_ID).catch(() => null);
  if (category?.type !== ChannelType.GuildCategory) {
    return;
  }
  for (const roleId of allianceOrderRoleIds()) {
    await category.permissionOverwrites.delete(roleId).catch(() => undefined);
  }
  await category.permissionOverwrites.edit(guild.roles.everyone.id, { ViewChannel: false });
  await category.permissionOverwrites.delete(env.RANGER_ALLIANCE_ROLE_LEADERS_ID).catch(() => undefined);
  await category.permissionOverwrites.edit(guild.client.user.id, { ViewChannel: true });
  await guild.channels.fetch();
  const children = guild.channels.cache.filter((channel) => channel.parentId === category.id);
  for (const channel of children.values()) {
    if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
      continue;
    }
    for (const roleId of allianceOrderRoleIds()) {
      await channel.permissionOverwrites.delete(roleId).catch(() => undefined);
    }
    await channel.permissionOverwrites.edit(guild.roles.everyone.id, { ViewChannel: false });
    await channel.permissionOverwrites.delete(env.RANGER_ALLIANCE_ROLE_LEADERS_ID).catch(() => undefined);
    await channel.permissionOverwrites.edit(guild.client.user.id, { ViewChannel: true });
  }
  if (!category.name.toLocaleLowerCase().includes("archive")) {
    await category.setName("archive-shared-reports", "Archive the retired direct Alliance mirror");
  }
}

async function migrateStoredAllianceReports(client: Client, headquarters: AllianceHeadquartersRow[]): Promise<number> {
  const { data, error } = await supabase.from("alliance_reports").select("*").order("created_at", { ascending: true });
  assertNoDbError(error, "list stored Alliance reports for headquarters migration");
  let migrated = 0;
  for (const report of data ?? []) {
    const hq = report.headquarters_id
      ? headquarters.find((candidate) => candidate.id === report.headquarters_id)
      : headquarters.find((candidate) => normalizedOrder(candidate.source_order) === normalizedOrder(report.source_order));
    if (!hq) {
      continue;
    }
    if (report.headquarters_id !== hq.id) {
      const { error: updateError } = await supabase.from("alliance_reports").update({ headquarters_id: hq.id }).eq("id", report.id);
      assertNoDbError(updateError, "assign historical Alliance report headquarters");
    }
    await synchronizeAllianceReport(client, { ...report, headquarters_id: hq.id }, hq);
    migrated += 1;
  }
  return migrated;
}

async function deleteIntelReportCopies(client: Client, report: IntelReportRow): Promise<void> {
  if (report.bulletin_channel_id && report.bulletin_message_id && report.bulletin_message_id !== "legacy") {
    await deleteMessageIfPresent(client, env.DISCORD_GUILD_ID, report.bulletin_channel_id, report.bulletin_message_id);
  }
  await removeCorpsIntelReportFromAlliance(client, report.id);
  const { error } = await supabase.from("intel_reports").delete().eq("id", report.id);
  assertNoDbError(error, "delete obsolete intel record");
}

async function deleteHeadquartersPublication(client: Client, publication: AllianceHeadquartersPublicationRow): Promise<void> {
  await deleteMessageIfPresent(
    client,
    env.RANGER_ALLIANCE_GUILD_ID,
    publication.discord_channel_id,
    publication.discord_message_id
  );
  const { error } = await supabase.from("alliance_headquarters_publications")
    .delete()
    .eq("report_id", publication.report_id)
    .eq("headquarters_id", publication.headquarters_id);
  assertNoDbError(error, "delete allied headquarters publication");
}

async function upsertHeadquartersDelivery(
  reportId: string,
  headquartersId: string,
  deliveredByDiscordUserId: string,
  deliveredAt: string
): Promise<AllianceHeadquartersDeliveryRow> {
  const { data, error } = await supabase.from("alliance_headquarters_deliveries").upsert({
    report_id: reportId,
    headquarters_id: headquartersId,
    delivered_by_discord_user_id: deliveredByDiscordUserId,
    delivered_at: deliveredAt
  }).select("*").single();
  assertNoDbError(error, "store allied headquarters delivery");
  return data;
}

async function headquartersReportEmbed(
  corpsGuild: Guild,
  hq: AllianceHeadquartersRow,
  report: IntelReportRow,
  delivery: AllianceHeadquartersDeliveryRow,
  trailmark: TrailmarkRow | null
): Promise<EmbedBuilder> {
  const reporter = report.author_display_name
    ?? await discordDisplayName(corpsGuild, report.author_discord_user_id);
  const deliveredBy = await discordDisplayName(corpsGuild, delivery.delivered_by_discord_user_id);
  const source = trailmark ? `${trailmark.name} (${trailmark.hold})` : "Unknown Trailmark";
  const original = report.source_alliance_report_id
    ? await allianceOriginalLink(report.source_alliance_report_id)
    : `https://discord.com/channels/${corpsGuild.id}/${report.discord_channel_id}/${report.discord_message_id}`;
  const embed = new EmbedBuilder()
    .setTitle(`${trailmark?.name ?? "Ranger Report"} - ${discordTime(report.created_at)}`)
    .setDescription(formatContent(report.content))
    .addFields(
      { name: "Reported by", value: reporter, inline: true },
      { name: "Order", value: report.source_order ?? "Ranger Corps of Skyrim", inline: true },
      { name: "Source", value: source, inline: true },
      { name: "Report time", value: discordTime(report.created_at), inline: true },
      { name: `Delivered to ${hq.name}`, value: `${deliveredBy} - ${discordTime(delivery.delivered_at)}`, inline: true },
      { name: "Original", value: `[Open report](${original})`, inline: false }
    )
    .setColor(0x4f6f91)
    .setTimestamp(new Date(report.created_at));
  const atlasField = atlasReportFieldValue(report.atlas_summary, report.atlas_share_code);
  if (atlasField) {
    embed.addFields({ name: "Atlas Share", value: atlasField, inline: false });
  }
  return embed;
}

function allianceTrailmarkNoteEmbed(report: AllianceReportRow, hq: AllianceHeadquartersRow): EmbedBuilder {
  const originalUrl = `https://discord.com/channels/${env.RANGER_ALLIANCE_GUILD_ID}/${report.discord_channel_id}/${report.discord_message_id}`;
  const embed = new EmbedBuilder()
    .setTitle(`${report.source_order} Report Left at ${hq.name}`)
    .setDescription(formatContent(report.content || "Attachment-only report."))
    .addFields(
      { name: "Reported by", value: report.author_display_name, inline: true },
      { name: "Order", value: report.source_order, inline: true },
      { name: "Left at", value: hq.name, inline: true },
      { name: "Original", value: `[Open Alliance submission](${originalUrl})`, inline: false }
    )
    .setColor(0x4f6f91)
    .setTimestamp(new Date(report.created_at));
  if (report.attachment_urls.length > 0) {
    embed.addFields({
      name: "Attachments",
      value: report.attachment_urls.slice(0, 10).map((url, index) => `[Attachment ${index + 1}](${url})`).join("\n").slice(0, 1024)
    });
  }
  return embed;
}

function allianceReportEmbed(report: AllianceReportRow): EmbedBuilder {
  const originalUrl = `https://discord.com/channels/${env.RANGER_ALLIANCE_GUILD_ID}/${report.discord_channel_id}/${report.discord_message_id}`;
  const embed = new EmbedBuilder()
    .setTitle(`Alliance Report - ${report.source_order}`)
    .setDescription(formatContent(report.content || "Attachment-only report."))
    .addFields(
      { name: "Reported by", value: report.author_display_name, inline: true },
      { name: "Order", value: report.source_order, inline: true },
      { name: "Report time", value: discordTime(report.created_at), inline: true },
      { name: "Original", value: `[Open Alliance report](${originalUrl})`, inline: false }
    )
    .setColor(0x4f6f91)
    .setTimestamp(new Date(report.created_at));
  if (report.attachment_urls.length > 0) {
    embed.addFields({
      name: "Attachments",
      value: report.attachment_urls.slice(0, 10).map((url, index) => `[Attachment ${index + 1}](${url})`).join("\n").slice(0, 1024)
    });
  }
  return embed;
}

async function ensureCorpsAllyReportsChannel(corpsGuild: Guild): Promise<TextChannel> {
  const { data: settings, error } = await supabase
    .from("alliance_intel_settings")
    .select("*")
    .eq("id", true)
    .maybeSingle();
  assertNoDbError(error, "get Ranger Alliance settings");

  if (settings?.corps_ally_reports_channel_id) {
    const stored = await corpsGuild.channels.fetch(settings.corps_ally_reports_channel_id).catch(() => null);
    if (stored?.type === ChannelType.GuildText) {
      return stored;
    }
  }

  await corpsGuild.channels.fetch();
  const existing = corpsGuild.channels.cache.find((channel) =>
    channel.type === ChannelType.GuildText
      && channel.parentId === env.CORPS_INTEL_CATEGORY_ID
      && channel.name === ALLY_REPORTS_CHANNEL_NAME
  );
  const channel = existing?.type === ChannelType.GuildText
    ? existing
    : await corpsGuild.channels.create({
        name: ALLY_REPORTS_CHANNEL_NAME,
        type: ChannelType.GuildText,
        parent: env.CORPS_INTEL_CATEGORY_ID,
        reason: "Create Ranger Alliance report archive"
      });
  await channel.permissionOverwrites.edit(corpsGuild.roles.everyone.id, { SendMessages: false });
  await channel.permissionOverwrites.edit(corpsGuild.client.user.id, { ViewChannel: true, SendMessages: true, EmbedLinks: true });

  if (settings) {
    const { error: updateError } = await supabase.from("alliance_intel_settings")
      .update({ corps_ally_reports_channel_id: channel.id })
      .eq("id", true);
    assertNoDbError(updateError, "store Corps Ally Reports channel");
  }
  return channel;
}

async function routedTopics(content: string): Promise<IntelTopicRow[]> {
  const topics = await listActiveTopics();
  const matched = matchingIntelTopics(topics, content);
  if (matched.length > 0) {
    return matched;
  }
  const { data: settings, error } = await supabase.from("intel_settings").select("*").eq("id", true).maybeSingle();
  assertNoDbError(error, "get intel catchall for allied report");
  const catchall = settings?.catchall_topic_id
    ? topics.find((topic) => topic.id === settings.catchall_topic_id)
    : null;
  return catchall ? [catchall] : [];
}

async function listHeadquarters(): Promise<AllianceHeadquartersRow[]> {
  const { data, error } = await supabase.from("alliance_headquarters").select("*").eq("active", true).order("name");
  assertNoDbError(error, "list allied headquarters");
  return data ?? [];
}

async function getHeadquarters(id: string): Promise<AllianceHeadquartersRow | null> {
  const { data, error } = await supabase.from("alliance_headquarters").select("*").eq("id", id).maybeSingle();
  assertNoDbError(error, "get allied headquarters");
  return data;
}

async function getHeadquartersByTrailmarkId(trailmarkId: string): Promise<AllianceHeadquartersRow | null> {
  const { data, error } = await supabase.from("alliance_headquarters").select("*")
    .eq("trailmark_id", trailmarkId).eq("active", true).maybeSingle();
  assertNoDbError(error, "find allied headquarters by Trailmark");
  return data;
}

async function getHeadquartersByIntakeChannel(channelId: string): Promise<AllianceHeadquartersRow | null> {
  const { data, error } = await supabase.from("alliance_headquarters").select("*")
    .eq("intake_channel_id", channelId).eq("active", true).maybeSingle();
  assertNoDbError(error, "find allied headquarters intake channel");
  return data;
}

async function getTrailmark(id: string): Promise<TrailmarkRow | null> {
  const { data, error } = await supabase.from("trailmarks").select("*").eq("id", id).maybeSingle();
  assertNoDbError(error, "get Trailmark for allied headquarters");
  return data;
}

async function getTopic(id: string): Promise<IntelTopicRow | null> {
  const { data, error } = await supabase.from("intel_topics").select("*").eq("id", id).maybeSingle();
  assertNoDbError(error, "get topic for allied headquarters");
  return data;
}

async function listActiveTopics(): Promise<IntelTopicRow[]> {
  const { data, error } = await supabase.from("intel_topics").select("*").eq("active", true).order("name");
  assertNoDbError(error, "list intel topics for allied headquarters");
  return data ?? [];
}

async function getAllianceReportByDiscordMessageId(messageId: string): Promise<AllianceReportRow | null> {
  const { data, error } = await supabase.from("alliance_reports").select("*")
    .eq("discord_message_id", messageId).maybeSingle();
  assertNoDbError(error, "get Alliance report");
  return data;
}

async function allianceOriginalLink(reportId: string): Promise<string> {
  const { data, error } = await supabase.from("alliance_reports").select("*").eq("id", reportId).maybeSingle();
  assertNoDbError(error, "get original Alliance report link");
  return data
    ? `https://discord.com/channels/${env.RANGER_ALLIANCE_GUILD_ID}/${data.discord_channel_id}/${data.discord_message_id}`
    : "https://discord.com";
}

async function requireTextChannel(guild: Guild, channelId: string): Promise<TextChannel> {
  const channel = await guild.channels.fetch(channelId);
  if (channel?.type !== ChannelType.GuildText) {
    throw new UserFacingError("A required text channel was not found.");
  }
  return channel;
}

async function sendOrEditMessage(channel: ReportChannel, messageId: string | null, embed: EmbedBuilder): Promise<Message> {
  if (messageId) {
    const existing = await channel.messages.fetch(messageId).catch(() => null);
    if (existing) {
      return existing.edit({ embeds: [embed], allowedMentions: { parse: [] } });
    }
  }
  return channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
}

async function deleteMessageIfPresent(
  client: Client,
  guildId: string,
  channelId: string | null,
  messageId: string | null
): Promise<void> {
  if (!channelId || !messageId) {
    return;
  }
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  const channel = await guild?.channels.fetch(channelId).catch(() => null);
  if (!isReportChannel(channel)) {
    return;
  }
  const message = await channel.messages.fetch(messageId).catch(() => null);
  await message?.delete().catch(() => undefined);
}

function isReportChannel(channel: GuildBasedChannel | null | undefined): channel is ReportChannel {
  return channel?.type === ChannelType.GuildText || channel?.type === ChannelType.GuildAnnouncement;
}

async function discordDisplayName(guild: Guild, userId: string): Promise<string> {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (member) {
    return member.displayName;
  }
  const user = await guild.client.users.fetch(userId).catch(() => null);
  return user?.displayName ?? user?.username ?? "Unknown Ranger";
}

async function fetchBridgeGuilds(client: Client): Promise<[Guild, Guild]> {
  return Promise.all([
    client.guilds.fetch(env.DISCORD_GUILD_ID),
    client.guilds.fetch(env.RANGER_ALLIANCE_GUILD_ID)
  ]);
}

async function validateDiscordConfiguration(corpsGuild: Guild, allianceGuild: Guild): Promise<void> {
  const [corpsIntel, legacyCategory, admin] = await Promise.all([
    corpsGuild.channels.fetch(env.CORPS_INTEL_CATEGORY_ID),
    allianceGuild.channels.fetch(env.RANGER_ALLIANCE_REPORTS_CATEGORY_ID),
    allianceGuild.channels.fetch(env.RANGER_ALLIANCE_ADMIN_CHANNEL_ID)
  ]);
  if (corpsIntel?.type !== ChannelType.GuildCategory) {
    throw new UserFacingError("CORPS_INTEL_CATEGORY_ID must point to a category.");
  }
  if (legacyCategory?.type !== ChannelType.GuildCategory) {
    throw new UserFacingError("RANGER_ALLIANCE_REPORTS_CATEGORY_ID must point to a category.");
  }
  if (admin?.type !== ChannelType.GuildText) {
    throw new UserFacingError("RANGER_ALLIANCE_ADMIN_CHANNEL_ID must point to a text channel.");
  }
  for (const roleId of allianceOrderRoleIds().concat(env.RANGER_ALLIANCE_ROLE_LEADERS_ID)) {
    if (!await allianceGuild.roles.fetch(roleId).catch(() => null)) {
      throw new UserFacingError(`Configured Ranger Alliance role ${roleId} was not found.`);
    }
  }
}

function headquartersDefinitions(): HeadquartersDefinition[] {
  return [
    {
      key: "north-star",
      name: "Stonehills",
      sourceOrder: "North Star Rangers",
      viewerRoleId: env.RANGER_ALLIANCE_ROLE_NORTH_STAR_ID,
      categoryName: "NORTH STAR INTEL",
      intakeChannelName: "north-star-submit-report",
      trailmarkName: "Stonehills - North Star Headquarters",
      trailmarkHold: "Hjaalmarch",
      trailmarkDescription: "The North Star Rangers leave and receive field reports at their headquarters in Stonehills."
    },
    {
      key: "undaunted",
      name: "Dancing Horse Inn",
      sourceOrder: "Undaunted",
      viewerRoleId: env.RANGER_ALLIANCE_ROLE_UNDAUNTED_ID,
      categoryName: "UNDAUNTED INTEL",
      intakeChannelName: "undaunted-submit-report",
      trailmarkName: "Dancing Horse Inn - Undaunted Headquarters",
      trailmarkHold: "Whiterun",
      trailmarkDescription: "The Undaunted leave and receive field reports at their headquarters in the Dancing Horse Inn outside Whiterun."
    }
  ];
}

function allianceOrderRoleIds(): string[] {
  return [
    env.RANGER_ALLIANCE_ROLE_UNDAUNTED_ID,
    env.RANGER_ALLIANCE_ROLE_NORTH_STAR_ID,
    env.RANGER_ALLIANCE_ROLE_RANGER_CORPS_ID
  ];
}

function allianceRequiredIds(): string[] {
  return [
    env.CORPS_INTEL_CATEGORY_ID,
    env.RANGER_ALLIANCE_GUILD_ID,
    env.RANGER_ALLIANCE_REPORTS_CATEGORY_ID,
    env.RANGER_ALLIANCE_ADMIN_CHANNEL_ID,
    env.RANGER_ALLIANCE_ROLE_LEADERS_ID,
    ...allianceOrderRoleIds()
  ];
}

function requireAllianceConfiguration(): void {
  if (!allianceBridgeConfigured()) {
    throw new UserFacingError("Ranger Alliance environment configuration is incomplete.");
  }
}

function normalizedOrder(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z]+/g, "");
}

function discordTime(value: string): string {
  return `<t:${Math.floor(new Date(value).getTime() / 1000)}:f>`;
}

function formatContent(content: string): string {
  const trimmed = content.trim();
  return trimmed.length <= MAX_DESCRIPTION_LENGTH
    ? trimmed
    : `${trimmed.slice(0, MAX_DESCRIPTION_LENGTH - 3).trimEnd()}...`;
}
