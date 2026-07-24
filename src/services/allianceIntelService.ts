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
import { allyReportsChannelName, emojiTitle, intelReportChannelName, intelTopicEmojiName } from "../utils/guildEmojis.js";
import { slugify } from "../utils/slugs.js";
import { createTrailmark, deactivateTrailmark } from "./trailmarkService.js";
import { atlasReportFieldValue } from "./atlasService.js";

const MAX_DESCRIPTION_LENGTH = 4000;
type ReportChannel = TextChannel | NewsChannel;

interface HeadquartersDefinition {
  key: string;
  name: string;
  sourceOrder: string;
  viewerRoleId: string;
  categoryName: string;
  intakeChannelName: string;
  trailmarkName: string;
  trailmarkHold: string;
  trailmarkDescription: string;
  allTopics: boolean;
}

export interface AllianceSetupResult {
  headquarters: number;
  topicChannels: number;
}

export interface AllianceGroupSetupResult {
  headquarters: AllianceHeadquartersRow;
  topicChannels: number;
}

export interface AllianceStatus {
  configured: boolean;
  headquarters: number;
  topicChannels: number;
  deliveredReports: number;
  allianceReports: number;
}

export function allianceBridgeConfigured(): boolean {
  return [
    env.CORPS_INTEL_CATEGORY_ID,
    env.RANGER_ALLIANCE_GUILD_ID,
    env.RANGER_ALLIANCE_ADMIN_CHANNEL_ID,
    env.RANGER_ALLIANCE_ROLE_LEADERS_ID
  ].every(Boolean);
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

  const activeHeadquarters = await listHeadquarters();
  const headquarters: AllianceHeadquartersRow[] = [];
  let topicChannels = 0;
  for (const stored of activeHeadquarters) {
    const hq = await ensureHeadquarters(corpsGuild, allianceGuild, headquartersDefinitionFromRow(stored));
    headquarters.push(hq);
    const topics = await listConfiguredHeadquartersTopics(hq);
    for (const topic of topics) {
      await ensureHeadquartersTopicChannel(allianceGuild, hq, topic, true);
      topicChannels += 1;
    }
  }

  // Setup repairs configuration only. It deliberately does not replay historical reports.
  return { headquarters: headquarters.length, topicChannels };
}

export async function getAllianceStatus(): Promise<AllianceStatus> {
  if (!allianceBridgeConfigured()) {
    return { configured: false, headquarters: 0, topicChannels: 0, deliveredReports: 0, allianceReports: 0 };
  }

  const [hqResult, topicResult, deliveryResult, reportsResult] = await Promise.all([
    supabase.from("alliance_headquarters").select("id", { count: "exact", head: true }).eq("active", true),
    supabase.from("alliance_headquarters_topic_channels").select("topic_id", { count: "exact", head: true }).eq("active", true),
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
  const [corpsGuild, allianceGuild] = await Promise.all([
    client.guilds.fetch(env.DISCORD_GUILD_ID),
    client.guilds.fetch(env.RANGER_ALLIANCE_GUILD_ID)
  ]);
  const storedHeadquarters = await listHeadquarters();
  let repaired = 0;
  for (const stored of storedHeadquarters) {
    const hq = await ensureHeadquarters(
      corpsGuild,
      allianceGuild,
      headquartersDefinitionFromRow(stored)
    );
    const topics = await listConfiguredHeadquartersTopics(hq);
    for (const topic of topics) {
      await ensureHeadquartersTopicChannel(allianceGuild, hq, topic, true);
      repaired += 1;
    }
  }
  return repaired;
}

export async function addAllianceGroup(params: {
  client: Client;
  key: string;
  sourceOrder: string;
  viewerRoleId: string;
  headquartersName: string;
  hold: string;
  description: string;
  topicNames: string;
}): Promise<AllianceGroupSetupResult> {
  requireAllianceConfiguration();
  const [corpsGuild, allianceGuild] = await fetchBridgeGuilds(params.client);
  const key = normalizeGroupKey(params.key);
  const existing = await getHeadquartersByKey(key, true);
  if (existing) {
    throw new UserFacingError(`Alliance group key ${key} already exists. Use /alliance group-topics to change its topics.`);
  }
  if (!await allianceGuild.roles.fetch(params.viewerRoleId).catch(() => null)) {
    throw new UserFacingError(`Alliance role ${params.viewerRoleId} was not found.`);
  }

  const topics = await resolveAllianceTopics(params.topicNames);
  if (!topics.length) {
    throw new UserFacingError("There are no active intel topics to assign to this group.");
  }
  const allTopics = includesAllTopics(params.topicNames);
  const sourceOrder = params.sourceOrder.trim();
  const headquartersName = params.headquartersName.trim();
  const hold = params.hold.trim();
  const description = params.description.trim();
  if (!sourceOrder || !headquartersName || !hold || !description) {
    throw new UserFacingError("Group name, headquarters, hold, and description cannot be blank.");
  }
  const definition: HeadquartersDefinition = {
    key,
    name: headquartersName,
    sourceOrder,
    viewerRoleId: params.viewerRoleId,
    categoryName: `${slugify(sourceOrder)}-intel`.toUpperCase().slice(0, 100),
    intakeChannelName: `${slugify(key)}-submit-report`.slice(0, 100),
    trailmarkName: `${headquartersName} - ${sourceOrder} Headquarters`,
    trailmarkHold: hold,
    trailmarkDescription: description,
    allTopics
  };
  const headquarters = await ensureHeadquarters(corpsGuild, allianceGuild, definition);
  for (const topic of topics) {
    await ensureHeadquartersTopicChannel(allianceGuild, headquarters, topic, true);
  }
  return { headquarters, topicChannels: topics.length };
}

export async function setAllianceGroupTopics(params: {
  client: Client;
  key: string;
  topicNames: string;
}): Promise<number> {
  requireAllianceConfiguration();
  const allianceGuild = await params.client.guilds.fetch(env.RANGER_ALLIANCE_GUILD_ID);
  const headquarters = await getHeadquartersByKey(normalizeGroupKey(params.key), false);
  if (!headquarters) {
    throw new UserFacingError("That Alliance group does not exist or is inactive.");
  }
  const topics = await resolveAllianceTopics(params.topicNames);
  if (!topics.length) {
    throw new UserFacingError("There are no active intel topics to assign to this group.");
  }
  const allTopics = includesAllTopics(params.topicNames);
  const { error: groupUpdateError } = await supabase.from("alliance_headquarters")
    .update({ all_topics: allTopics, updated_at: new Date().toISOString() })
    .eq("id", headquarters.id);
  assertNoDbError(groupUpdateError, "update Alliance group topic mode");
  const desiredIds = new Set(topics.map((topic) => topic.id));
  const { data: mappings, error } = await supabase
    .from("alliance_headquarters_topic_channels")
    .select("*")
    .eq("headquarters_id", headquarters.id);
  assertNoDbError(error, "list Alliance group topic mappings");
  for (const mapping of mappings ?? []) {
    const { error: updateError } = await supabase
      .from("alliance_headquarters_topic_channels")
      .update({ active: desiredIds.has(mapping.topic_id), updated_at: new Date().toISOString() })
      .eq("headquarters_id", headquarters.id)
      .eq("topic_id", mapping.topic_id);
    assertNoDbError(updateError, "update Alliance group topic mapping");
  }
  for (const topic of topics) {
    await ensureHeadquartersTopicChannel(allianceGuild, headquarters, topic, true);
  }
  return topics.length;
}

export async function removeAllianceGroup(params: { client: Client; key: string }): Promise<void> {
  requireAllianceConfiguration();
  const allianceGuild = await params.client.guilds.fetch(env.RANGER_ALLIANCE_GUILD_ID);
  const headquarters = await getHeadquartersByKey(normalizeGroupKey(params.key), true);
  if (!headquarters || !headquarters.active) {
    throw new UserFacingError("That Alliance group does not exist or is already inactive.");
  }

  const { error: updateError } = await supabase.from("alliance_headquarters")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("id", headquarters.id);
  assertNoDbError(updateError, "deactivate Alliance group");
  const { error: mappingError } = await supabase.from("alliance_headquarters_topic_channels")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("headquarters_id", headquarters.id);
  assertNoDbError(mappingError, "deactivate Alliance group topic mappings");

  await archiveHeadquartersChannels(allianceGuild, headquarters);
  const { data: publications, error: publicationError } = await supabase
    .from("alliance_headquarters_publications")
    .select("*")
    .eq("headquarters_id", headquarters.id);
  assertNoDbError(publicationError, "list Alliance group publications");
  for (const publication of publications ?? []) {
    await deleteHeadquartersPublication(params.client, publication);
  }
  const corpsGuild = await params.client.guilds.fetch(env.DISCORD_GUILD_ID);
  await deactivateTrailmark(headquarters.trailmark_id, corpsGuild);
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
    const message = await sendOrEditMessage(channel, report.corps_ally_message_id, allianceReportEmbed(corpsGuild, report));
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

export async function syncCorpsAllyReportsChannelName(corpsGuild: Guild): Promise<boolean> {
  const { data: settings, error } = await supabase
    .from("alliance_intel_settings")
    .select("corps_ally_reports_channel_id")
    .eq("id", true)
    .maybeSingle();
  assertNoDbError(error, "get Corps Ally Reports channel");
  if (!settings?.corps_ally_reports_channel_id) {
    return false;
  }

  const channel = await corpsGuild.channels.fetch(settings.corps_ally_reports_channel_id).catch(() => null);
  if (channel?.type !== ChannelType.GuildText) {
    return false;
  }

  const previousName = channel.name;
  await renameAllyReportsChannel(channel);
  return channel.name !== previousName;
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
  const trailmarkEmbed = allianceTrailmarkNoteEmbed(corpsGuild, report, hq);
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
  if (!channel) {
    if (existing) {
      await deleteHeadquartersPublication(corpsGuild.client, existing);
    }
    return;
  }
  const trailmark = await getTrailmark(report.trailmark_id);
  const embed = await headquartersReportEmbed(corpsGuild, allianceGuild, hq, report, delivery, trailmark, topic);
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
    active: true,
    all_topics: definition.allTopics
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
  const { data, error } = await supabase.from("trailmarks").select("*").eq("slug", slug).eq("active", true).maybeSingle();
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
  topic: IntelTopicRow,
  forceCreate = false
): Promise<TextChannel | null> {
  const channelName = intelReportChannelName(guild, topic.name);
  const standardChannelName = `${slugify(topic.name)}-reports`.slice(0, 100);
  const { data: stored, error } = await supabase
    .from("alliance_headquarters_topic_channels")
    .select("*")
    .eq("headquarters_id", hq.id)
    .eq("topic_id", topic.id)
    .maybeSingle();
  assertNoDbError(error, "get allied headquarters topic channel");
  if (stored?.active === false && !forceCreate) {
    return null;
  }
  if (stored) {
    const channel = await guild.channels.fetch(stored.discord_channel_id).catch(() => null);
    if (channel?.type === ChannelType.GuildText) {
      await renameIntelTopicChannel(channel, channelName, standardChannelName);
      await configureHeadquartersTopicChannel(channel, hq);
      if (stored.active === false) {
        const { error: activateError } = await supabase.from("alliance_headquarters_topic_channels")
          .update({ active: true, updated_at: new Date().toISOString() })
          .eq("headquarters_id", hq.id)
          .eq("topic_id", topic.id);
        assertNoDbError(activateError, "activate allied headquarters topic channel");
      }
      return channel;
    }
  }

  await guild.channels.fetch();
  const existing = guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildText
      && channel.parentId === hq.reports_category_id
      && (channel.name === standardChannelName || channel.name === channelName)
  );
  const channel = existing?.type === ChannelType.GuildText
    ? existing
    : await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: hq.reports_category_id,
        reason: `Create ${hq.name} ${topic.name} reports`
      });
  await renameIntelTopicChannel(channel, channelName, standardChannelName);
  await configureHeadquartersTopicChannel(channel, hq);

  const { error: upsertError } = await supabase.from("alliance_headquarters_topic_channels").upsert({
    headquarters_id: hq.id,
    topic_id: topic.id,
    discord_channel_id: channel.id,
    active: true
  });
  assertNoDbError(upsertError, "store allied headquarters topic channel");
  return channel;
}

async function renameIntelTopicChannel(
  channel: TextChannel,
  desiredName: string,
  standardName: string
): Promise<void> {
  if (channel.name === standardName && channel.name !== desiredName) {
    await channel.setName(desiredName, "Add report type emoji");
  }
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
  if (!env.RANGER_ALLIANCE_REPORTS_CATEGORY_ID) {
    return;
  }
  const category = await guild.channels.fetch(env.RANGER_ALLIANCE_REPORTS_CATEGORY_ID).catch(() => null);
  if (category?.type !== ChannelType.GuildCategory) {
    return;
  }
  const roleIds = await allianceOrderRoleIds();
  for (const roleId of roleIds) {
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
    for (const roleId of roleIds) {
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
  allianceGuild: Guild,
  hq: AllianceHeadquartersRow,
  report: IntelReportRow,
  delivery: AllianceHeadquartersDeliveryRow,
  trailmark: TrailmarkRow | null,
  topic: IntelTopicRow
): Promise<EmbedBuilder> {
  const reporter = report.author_display_name
    ?? await discordDisplayName(corpsGuild, report.author_discord_user_id);
  const deliveredBy = await discordDisplayName(corpsGuild, delivery.delivered_by_discord_user_id);
  const source = trailmark ? `${trailmark.name} (${trailmark.hold})` : "Unknown Trailmark";
  const original = report.source_alliance_report_id
    ? await allianceOriginalLink(report.source_alliance_report_id)
    : `https://discord.com/channels/${corpsGuild.id}/${report.discord_channel_id}/${report.discord_message_id}`;
  const embed = new EmbedBuilder()
    .setTitle(emojiTitle(allianceGuild, intelTopicEmojiName(topic.name) ?? "intel", `${trailmark?.name ?? "Ranger Report"} - ${discordTime(report.created_at)}`))
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

function allianceTrailmarkNoteEmbed(corpsGuild: Guild, report: AllianceReportRow, hq: AllianceHeadquartersRow): EmbedBuilder {
  const originalUrl = `https://discord.com/channels/${env.RANGER_ALLIANCE_GUILD_ID}/${report.discord_channel_id}/${report.discord_message_id}`;
  const embed = new EmbedBuilder()
    .setTitle(emojiTitle(corpsGuild, "teamwork", `${report.source_order} Report Left at ${hq.name}`))
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

function allianceReportEmbed(corpsGuild: Guild, report: AllianceReportRow): EmbedBuilder {
  const originalUrl = `https://discord.com/channels/${env.RANGER_ALLIANCE_GUILD_ID}/${report.discord_channel_id}/${report.discord_message_id}`;
  const embed = new EmbedBuilder()
    .setTitle(emojiTitle(corpsGuild, "teamwork", `Alliance Report - ${report.source_order}`))
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
      await renameAllyReportsChannel(stored);
      return stored;
    }
  }

  await corpsGuild.channels.fetch();
  const desiredName = allyReportsChannelName(corpsGuild);
  const existing = corpsGuild.channels.cache.find((channel) =>
    channel.type === ChannelType.GuildText
      && channel.parentId === env.CORPS_INTEL_CATEGORY_ID
      && (channel.name === "ally-reports" || channel.name === desiredName)
  );
  const channel = existing?.type === ChannelType.GuildText
    ? existing
    : await corpsGuild.channels.create({
        name: desiredName,
        type: ChannelType.GuildText,
        parent: env.CORPS_INTEL_CATEGORY_ID,
        reason: "Create Ranger Alliance report archive"
      });
  await renameAllyReportsChannel(channel);
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

async function renameAllyReportsChannel(channel: TextChannel): Promise<void> {
  const desiredName = allyReportsChannelName(channel.guild);
  if (channel.name === "ally-reports" && desiredName !== channel.name) {
    await channel.setName(desiredName, "Add teamwork emoji to Ally Reports");
  }
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

async function getHeadquartersByKey(key: string, includeInactive: boolean): Promise<AllianceHeadquartersRow | null> {
  let query = supabase.from("alliance_headquarters").select("*").eq("headquarters_key", key);
  if (!includeInactive) {
    query = query.eq("active", true);
  }
  const { data, error } = await query.maybeSingle();
  assertNoDbError(error, "get allied headquarters by key");
  return data;
}

async function listConfiguredHeadquartersTopics(headquarters: AllianceHeadquartersRow): Promise<IntelTopicRow[]> {
  if (headquarters.all_topics) {
    return listActiveTopics();
  }
  const { data: mappings, error } = await supabase
    .from("alliance_headquarters_topic_channels")
    .select("topic_id")
    .eq("headquarters_id", headquarters.id)
    .eq("active", true);
  assertNoDbError(error, "list configured allied headquarters topics");
  const topicIds = new Set((mappings ?? []).map((mapping) => mapping.topic_id));
  return (await listActiveTopics()).filter((topic) => topicIds.has(topic.id));
}

async function resolveAllianceTopics(value: string): Promise<IntelTopicRow[]> {
  const requested = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (requested.length === 0) {
    throw new UserFacingError("Provide at least one intel topic, or use all.");
  }
  const topics = await listActiveTopics();
  if (requested.some((item) => item.toLocaleLowerCase() === "all")) {
    return topics;
  }
  const resolved: IntelTopicRow[] = [];
  for (const item of requested) {
    const normalized = slugify(item);
    const topic = topics.find((candidate) =>
      candidate.id === item
      || candidate.slug === normalized
      || candidate.name.toLocaleLowerCase() === item.toLocaleLowerCase()
    );
    if (!topic) {
      throw new UserFacingError(`Intel topic ${item} was not found. Use the topic name or slug.`);
    }
    if (!resolved.some((candidate) => candidate.id === topic.id)) {
      resolved.push(topic);
    }
  }
  return resolved;
}

function includesAllTopics(value: string): boolean {
  return value.split(",").some((item) => item.trim().toLocaleLowerCase() === "all");
}

async function archiveHeadquartersChannels(guild: Guild, hq: AllianceHeadquartersRow): Promise<void> {
  const category = await guild.channels.fetch(hq.reports_category_id).catch(() => null);
  if (category?.type !== ChannelType.GuildCategory) {
    return;
  }
  await category.permissionOverwrites.edit(guild.roles.everyone.id, { ViewChannel: false });
  await category.permissionOverwrites.delete(hq.viewer_role_id).catch(() => undefined);
  await category.permissionOverwrites.delete(env.RANGER_ALLIANCE_ROLE_LEADERS_ID).catch(() => undefined);
  await category.permissionOverwrites.edit(guild.client.user.id, { ViewChannel: true, ReadMessageHistory: true });
  await guild.channels.fetch();
  const children = guild.channels.cache.filter((channel) => channel.parentId === category.id);
  for (const channel of children.values()) {
    if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
      continue;
    }
    await channel.permissionOverwrites.edit(guild.roles.everyone.id, { ViewChannel: false });
    await channel.permissionOverwrites.delete(hq.viewer_role_id).catch(() => undefined);
    await channel.permissionOverwrites.delete(env.RANGER_ALLIANCE_ROLE_LEADERS_ID).catch(() => undefined);
    await channel.permissionOverwrites.edit(guild.client.user.id, { ViewChannel: true, ReadMessageHistory: true });
  }
  if (!category.name.toLocaleLowerCase().includes("archive")) {
    await category.setName(`archive-${slugify(hq.source_order)}`.slice(0, 100), "Archive inactive Alliance group");
  }
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

function headquartersDefinitionFromRow(headquarters: AllianceHeadquartersRow): HeadquartersDefinition {
  return {
    key: headquarters.headquarters_key,
    name: headquarters.name,
    sourceOrder: headquarters.source_order,
    viewerRoleId: headquarters.viewer_role_id,
    categoryName: `${slugify(headquarters.source_order)}-intel`.toUpperCase().slice(0, 100),
    intakeChannelName: `${slugify(headquarters.headquarters_key)}-submit-report`.slice(0, 100),
    trailmarkName: `${headquarters.name} - ${headquarters.source_order} Headquarters`,
    trailmarkHold: "Other Ranges",
    trailmarkDescription: `${headquarters.source_order} leave and receive field reports at their headquarters in ${headquarters.name}.`,
    allTopics: headquarters.all_topics
  };
}

async function validateDiscordConfiguration(corpsGuild: Guild, allianceGuild: Guild): Promise<void> {
  const [corpsIntel, admin, headquarters] = await Promise.all([
    corpsGuild.channels.fetch(env.CORPS_INTEL_CATEGORY_ID),
    allianceGuild.channels.fetch(env.RANGER_ALLIANCE_ADMIN_CHANNEL_ID),
    listHeadquarters()
  ]);
  if (corpsIntel?.type !== ChannelType.GuildCategory) {
    throw new UserFacingError("CORPS_INTEL_CATEGORY_ID must point to a category.");
  }
  if (admin?.type !== ChannelType.GuildText) {
    throw new UserFacingError("RANGER_ALLIANCE_ADMIN_CHANNEL_ID must point to a text channel.");
  }
  const roleIds = [...new Set([
    ...headquarters.map((hq) => hq.viewer_role_id),
    env.RANGER_ALLIANCE_ROLE_LEADERS_ID
  ])];
  for (const roleId of roleIds) {
    if (!await allianceGuild.roles.fetch(roleId).catch(() => null)) {
      throw new UserFacingError(`Configured Ranger Alliance role ${roleId} was not found.`);
    }
  }
}

async function allianceOrderRoleIds(): Promise<string[]> {
  const { data, error } = await supabase.from("alliance_headquarters").select("viewer_role_id");
  assertNoDbError(error, "list Alliance group roles");
  return [...new Set((data ?? []).map((row) => row.viewer_role_id))];
}

function normalizeGroupKey(value: string): string {
  const key = slugify(value.trim());
  if (!value.trim() || key === "trailmark") {
    throw new UserFacingError("Provide a non-empty Alliance group key.");
  }
  return key;
}

function requireAllianceConfiguration(): void {
  if (!allianceBridgeConfigured()) {
    throw new UserFacingError("Ranger Alliance environment configuration is incomplete.");
  }
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
