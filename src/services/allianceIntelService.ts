import {
  ChannelType,
  EmbedBuilder,
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
  type AllianceReportRow,
  type AllianceReportTopicPublicationRow,
  type IntelReportRow,
  type IntelTopicRow,
  type TrailmarkRow
} from "../db/supabase.js";
import { UserFacingError } from "../utils/errors.js";
import { matchingIntelTopics } from "../utils/intelKeywords.js";
import { slugify } from "../utils/slugs.js";
import { atlasReportFieldValue } from "./atlasService.js";

const MAX_DESCRIPTION_LENGTH = 4000;
const ALLY_REPORTS_CHANNEL_NAME = "ally-reports";

type ReportChannel = TextChannel | NewsChannel;

export interface AllianceSetupResult {
  topicChannels: number;
  corpsReportsBackfilled: number;
  allianceReportsSynced: number;
  allyReportsChannelId: string;
}

export interface AllianceStatus {
  configured: boolean;
  topicChannels: number;
  mirroredCorpsReports: number;
  allianceReports: number;
  allyReportsChannelId: string | null;
}

export function allianceBridgeConfigured(): boolean {
  return allianceRequiredIds().every(Boolean);
}

export function isAllianceGuildId(guildId: string | null | undefined): boolean {
  return Boolean(env.RANGER_ALLIANCE_GUILD_ID && guildId === env.RANGER_ALLIANCE_GUILD_ID);
}

export function isAllianceIntakeMessage(message: Message): boolean {
  return isAllianceGuildId(message.guildId) && message.channelId === env.RANGER_ALLIANCE_INTAKE_CHANNEL_ID;
}

export function isAllianceLeader(member: GuildMember): boolean {
  return Boolean(env.RANGER_ALLIANCE_ROLE_LEADERS_ID && member.roles.cache.has(env.RANGER_ALLIANCE_ROLE_LEADERS_ID));
}

export function isCorpsOnlyAllianceReport(content: string): boolean {
  return content.toLocaleLowerCase().includes(env.RANGER_ALLIANCE_PRIVATE_MARKER.toLocaleLowerCase());
}

export async function setupAllianceBridge(client: Client): Promise<AllianceSetupResult> {
  requireAllianceConfiguration();
  const [corpsGuild, allianceGuild] = await fetchBridgeGuilds(client);
  await validateAllianceDiscordConfiguration(allianceGuild);
  await validateCorpsDiscordConfiguration(corpsGuild);

  const { error: settingsError } = await supabase.from("alliance_intel_settings").upsert({
    id: true,
    alliance_guild_id: env.RANGER_ALLIANCE_GUILD_ID,
    reports_category_id: env.RANGER_ALLIANCE_REPORTS_CATEGORY_ID,
    intake_channel_id: env.RANGER_ALLIANCE_INTAKE_CHANNEL_ID,
    admin_channel_id: env.RANGER_ALLIANCE_ADMIN_CHANNEL_ID,
    corps_ally_reports_channel_id: null,
    active: true
  });
  assertNoDbError(settingsError, "save Ranger Alliance settings");

  const allyReportsChannel = await ensureCorpsAllyReportsChannel(corpsGuild);
  const topics = await listActiveTopics();
  for (const topic of topics) {
    await ensureAllianceTopicMirror(allianceGuild, topic);
  }

  const corpsReportsBackfilled = await backfillDeliveredCorpsReports(corpsGuild, topics);
  const allianceReportsSynced = await syncStoredAllianceReports(client);
  return {
    topicChannels: topics.length,
    corpsReportsBackfilled,
    allianceReportsSynced,
    allyReportsChannelId: allyReportsChannel.id
  };
}

export async function getAllianceStatus(): Promise<AllianceStatus> {
  if (!allianceBridgeConfigured()) {
    return {
      configured: false,
      topicChannels: 0,
      mirroredCorpsReports: 0,
      allianceReports: 0,
      allyReportsChannelId: null
    };
  }

  const [settingsResult, topicsResult, corpsReportsResult, allianceReportsResult] = await Promise.all([
    supabase.from("alliance_intel_settings").select("*").eq("id", true).maybeSingle(),
    supabase.from("alliance_topic_mirrors").select("topic_id", { count: "exact", head: true }),
    supabase.from("alliance_intel_publications").select("report_id", { count: "exact", head: true }),
    supabase.from("alliance_reports").select("id", { count: "exact", head: true })
  ]);

  assertNoDbError(settingsResult.error, "get Ranger Alliance settings");
  assertNoDbError(topicsResult.error, "count Ranger Alliance topic channels");
  assertNoDbError(corpsReportsResult.error, "count mirrored Corps reports");
  assertNoDbError(allianceReportsResult.error, "count Alliance reports");

  return {
    configured: Boolean(settingsResult.data?.active),
    topicChannels: topicsResult.count ?? 0,
    mirroredCorpsReports: corpsReportsResult.count ?? 0,
    allianceReports: allianceReportsResult.count ?? 0,
    allyReportsChannelId: settingsResult.data?.corps_ally_reports_channel_id ?? null
  };
}

export async function syncAllianceTopicMirrors(client: Client): Promise<number> {
  if (!allianceBridgeConfigured()) {
    return 0;
  }
  const allianceGuild = await client.guilds.fetch(env.RANGER_ALLIANCE_GUILD_ID);
  const topics = await listActiveTopics();
  for (const topic of topics) {
    await ensureAllianceTopicMirror(allianceGuild, topic);
  }
  return topics.length;
}

export async function handleAllianceReportMessage(message: Message): Promise<boolean> {
  if (!isAllianceIntakeMessage(message) || message.author.bot) {
    return false;
  }

  requireAllianceConfiguration();
  const content = message.content.trim();
  const attachmentUrls = [...message.attachments.values()].map((attachment) => attachment.url);
  if (!content && attachmentUrls.length === 0) {
    return true;
  }

  const member = message.member ?? await message.guild?.members.fetch(message.author.id).catch(() => null);
  if (!member) {
    throw new UserFacingError("The Alliance report author could not be resolved.");
  }

  const sourceOrder = allianceOrderForMember(member);
  if (!sourceOrder) {
    await message.reply({
      content: "This report was not synced. You must have exactly one Alliance order role: Undaunted, North Star Rangers, or Ranger Corps.",
      allowedMentions: { repliedUser: false }
    });
    return true;
  }

  const existing = await getAllianceReportByDiscordMessageId(message.id);
  const values = {
    discord_message_id: message.id,
    discord_channel_id: message.channelId,
    author_discord_user_id: message.author.id,
    author_display_name: member.displayName,
    source_order: sourceOrder,
    content,
    attachment_urls: attachmentUrls,
    created_at: message.createdAt.toISOString()
  };

  let report: AllianceReportRow;
  if (existing) {
    const { data, error } = await supabase
      .from("alliance_reports")
      .update(values)
      .eq("id", existing.id)
      .select("*")
      .single();
    assertNoDbError(error, "update Alliance report");
    report = data;
  } else {
    const { data, error } = await supabase
      .from("alliance_reports")
      .insert({
        ...values,
        corps_ally_channel_id: null,
        corps_ally_message_id: null
      })
      .select("*")
      .single();
    assertNoDbError(error, "create Alliance report");
    report = data;
  }

  await syncAllianceReportPublications(message.client, report);
  return true;
}

export async function removeAllianceReportForDiscordMessage(
  client: Client,
  channelId: string,
  messageId: string
): Promise<boolean> {
  if (channelId !== env.RANGER_ALLIANCE_INTAKE_CHANNEL_ID) {
    return false;
  }

  const report = await getAllianceReportByDiscordMessageId(messageId);
  if (!report) {
    return false;
  }

  await deleteMessageIfPresent(client, env.DISCORD_GUILD_ID, report.corps_ally_channel_id, report.corps_ally_message_id);
  const { data: publications, error: publicationsError } = await supabase
    .from("alliance_report_topic_publications")
    .select("*")
    .eq("alliance_report_id", report.id);
  assertNoDbError(publicationsError, "list Alliance report publications");

  for (const publication of publications ?? []) {
    await deleteAllianceReportTopicPublication(client, publication);
  }

  const { error } = await supabase.from("alliance_reports").delete().eq("id", report.id);
  assertNoDbError(error, "delete Alliance report");
  return true;
}

export async function publishCorpsIntelReportToAlliance(params: {
  corpsGuild: Guild;
  report: IntelReportRow;
  topic: IntelTopicRow;
  trailmark: TrailmarkRow | undefined;
}): Promise<boolean> {
  if (!allianceBridgeConfigured() || !params.report.delivered_at) {
    return false;
  }

  if (isCorpsOnlyAllianceReport(params.report.content)) {
    await removeCorpsIntelReportFromAlliance(params.corpsGuild.client, params.report.id);
    return false;
  }

  const { data: existing, error: existingError } = await supabase
    .from("alliance_intel_publications")
    .select("*")
    .eq("report_id", params.report.id)
    .maybeSingle();
  assertNoDbError(existingError, "get Alliance intel publication");
  if (existing) {
    const existingMessage = await fetchMessage(
      params.corpsGuild.client,
      env.RANGER_ALLIANCE_GUILD_ID,
      existing.alliance_channel_id,
      existing.alliance_message_id
    );
    if (existingMessage) {
      const reporterName = await discordDisplayName(params.corpsGuild, params.report.author_discord_user_id);
      const deliveredBy = params.report.delivered_by_discord_user_id
        ? await discordDisplayName(params.corpsGuild, params.report.delivered_by_discord_user_id)
        : "Unknown";
      await existingMessage.edit({
        embeds: [corpsIntelMirrorEmbed(params.corpsGuild, params.report, params.trailmark, reporterName, deliveredBy)],
        allowedMentions: { parse: [] }
      });
      return false;
    }

    const { error: staleError } = await supabase
      .from("alliance_intel_publications")
      .delete()
      .eq("report_id", params.report.id);
    assertNoDbError(staleError, "remove stale Alliance intel publication");
  }

  const allianceGuild = await params.corpsGuild.client.guilds.fetch(env.RANGER_ALLIANCE_GUILD_ID);
  const channel = await ensureAllianceTopicMirror(allianceGuild, params.topic);
  const reporterName = await discordDisplayName(params.corpsGuild, params.report.author_discord_user_id);
  const deliveredBy = params.report.delivered_by_discord_user_id
    ? await discordDisplayName(params.corpsGuild, params.report.delivered_by_discord_user_id)
    : "Unknown";
  const message = await channel.send({
    embeds: [corpsIntelMirrorEmbed(params.corpsGuild, params.report, params.trailmark, reporterName, deliveredBy)],
    allowedMentions: { parse: [] }
  });

  const { error } = await supabase.from("alliance_intel_publications").insert({
    report_id: params.report.id,
    alliance_channel_id: channel.id,
    alliance_message_id: message.id
  });
  assertNoDbError(error, "store Alliance intel publication");
  return true;
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

  const deliveredReports = reports.filter((report) => report.delivered_at).map((report) => ({ ...report, content }));
  if (deliveredReports.length === 0) {
    return reports.length;
  }

  const topicIds = [...new Set(deliveredReports.map((report) => report.topic_id))];
  const trailmarkIds = [...new Set(deliveredReports.map((report) => report.trailmark_id))];
  const [topicsResult, trailmarksResult] = await Promise.all([
    supabase.from("intel_topics").select("*").in("id", topicIds),
    supabase.from("trailmarks").select("*").in("id", trailmarkIds)
  ]);
  assertNoDbError(topicsResult.error, "list topics for edited Corps intel reports");
  assertNoDbError(trailmarksResult.error, "list Trailmarks for edited Corps intel reports");
  const topicById = new Map((topicsResult.data ?? []).map((topic) => [topic.id, topic]));
  const trailmarkById = new Map((trailmarksResult.data ?? []).map((trailmark) => [trailmark.id, trailmark]));

  for (const report of deliveredReports) {
    const topic = topicById.get(report.topic_id);
    if (!topic) {
      continue;
    }
    await publishCorpsIntelReportToAlliance({
      corpsGuild: message.guild!,
      report,
      topic,
      trailmark: trailmarkById.get(report.trailmark_id)
    });
  }
  return reports.length;
}

export async function removeCorpsIntelReportFromAlliance(client: Client, reportId: string): Promise<void> {
  if (!allianceBridgeConfigured()) {
    return;
  }

  const { data, error } = await supabase
    .from("alliance_intel_publications")
    .select("*")
    .eq("report_id", reportId)
    .maybeSingle();
  assertNoDbError(error, "get Alliance intel publication for deletion");
  if (!data) {
    return;
  }

  await deleteMessageIfPresent(
    client,
    env.RANGER_ALLIANCE_GUILD_ID,
    data.alliance_channel_id,
    data.alliance_message_id
  );
  const { error: deleteError } = await supabase
    .from("alliance_intel_publications")
    .delete()
    .eq("report_id", reportId);
  assertNoDbError(deleteError, "delete Alliance intel publication");
}

async function syncAllianceReportPublications(client: Client, report: AllianceReportRow): Promise<void> {
  const [corpsGuild, allianceGuild] = await fetchBridgeGuilds(client);
  const allyReportsChannel = await ensureCorpsAllyReportsChannel(corpsGuild);
  const embed = allianceReportEmbed(report);
  const allyMessage = await sendOrEditMessage(
    allyReportsChannel,
    report.corps_ally_message_id,
    embed
  );

  if (report.corps_ally_channel_id !== allyReportsChannel.id || report.corps_ally_message_id !== allyMessage.id) {
    const { error } = await supabase
      .from("alliance_reports")
      .update({ corps_ally_channel_id: allyReportsChannel.id, corps_ally_message_id: allyMessage.id })
      .eq("id", report.id);
    assertNoDbError(error, "store Corps Ally Reports publication");
  }

  const topics = matchingIntelTopics(await listActiveTopics(), report.content);
  const topicIds = new Set(topics.map((topic) => topic.id));
  const { data: existingPublications, error: existingError } = await supabase
    .from("alliance_report_topic_publications")
    .select("*")
    .eq("alliance_report_id", report.id);
  assertNoDbError(existingError, "list Alliance report topic publications");

  for (const publication of existingPublications ?? []) {
    if (!topicIds.has(publication.topic_id)) {
      await deleteAllianceReportTopicPublication(client, publication);
      const { error } = await supabase
        .from("alliance_report_topic_publications")
        .delete()
        .eq("alliance_report_id", report.id)
        .eq("topic_id", publication.topic_id);
      assertNoDbError(error, "remove unmatched Alliance report topic publication");
    }
  }

  const publicationByTopic = new Map((existingPublications ?? []).map((publication) => [publication.topic_id, publication]));
  for (const topic of topics) {
    const corpsChannel = await requireReportChannel(corpsGuild, topic.discord_channel_id);
    const allianceChannel = await ensureAllianceTopicMirror(allianceGuild, topic);
    const existing = publicationByTopic.get(topic.id);
    const [corpsMessage, allianceMessage] = await Promise.all([
      sendOrEditMessage(corpsChannel, existing?.corps_message_id ?? null, embed),
      sendOrEditMessage(allianceChannel, existing?.alliance_message_id ?? null, embed)
    ]);

    const { error } = await supabase.from("alliance_report_topic_publications").upsert({
      alliance_report_id: report.id,
      topic_id: topic.id,
      corps_channel_id: corpsChannel.id,
      corps_message_id: corpsMessage.id,
      alliance_channel_id: allianceChannel.id,
      alliance_message_id: allianceMessage.id
    });
    assertNoDbError(error, "store Alliance report topic publication");
  }
}

async function syncStoredAllianceReports(client: Client): Promise<number> {
  const { data, error } = await supabase.from("alliance_reports").select("*").order("created_at", { ascending: true });
  assertNoDbError(error, "list stored Alliance reports");
  for (const report of data ?? []) {
    await syncAllianceReportPublications(client, report);
  }
  return data?.length ?? 0;
}

async function backfillDeliveredCorpsReports(corpsGuild: Guild, topics: IntelTopicRow[]): Promise<number> {
  const { data: reports, error } = await supabase
    .from("intel_reports")
    .select("*")
    .not("delivered_at", "is", null)
    .order("created_at", { ascending: true });
  assertNoDbError(error, "list delivered Corps reports for Alliance backfill");

  const topicById = new Map(topics.map((topic) => [topic.id, topic]));
  const trailmarkIds = [...new Set((reports ?? []).map((report) => report.trailmark_id))];
  const { data: trailmarks, error: trailmarksError } = trailmarkIds.length
    ? await supabase.from("trailmarks").select("*").in("id", trailmarkIds)
    : { data: [], error: null };
  assertNoDbError(trailmarksError, "list Trailmarks for Alliance backfill");
  const trailmarkById = new Map((trailmarks ?? []).map((trailmark) => [trailmark.id, trailmark]));

  let published = 0;
  for (const report of reports ?? []) {
    const topic = topicById.get(report.topic_id);
    if (!topic) {
      continue;
    }
    if (await publishCorpsIntelReportToAlliance({
      corpsGuild,
      report,
      topic,
      trailmark: trailmarkById.get(report.trailmark_id)
    })) {
      published += 1;
    }
  }
  return published;
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
  const existing = corpsGuild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildText
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
  await ensureReadOnlyChannel(channel);

  const { error: updateError } = await supabase
    .from("alliance_intel_settings")
    .update({ corps_ally_reports_channel_id: channel.id })
    .eq("id", true);
  assertNoDbError(updateError, "store Corps Ally Reports channel");
  return channel;
}

async function ensureAllianceTopicMirror(allianceGuild: Guild, topic: IntelTopicRow): Promise<TextChannel> {
  const { data: mirror, error } = await supabase
    .from("alliance_topic_mirrors")
    .select("*")
    .eq("topic_id", topic.id)
    .maybeSingle();
  assertNoDbError(error, "get Ranger Alliance topic mirror");

  if (mirror) {
    const stored = await allianceGuild.channels.fetch(mirror.alliance_channel_id).catch(() => null);
    if (stored?.type === ChannelType.GuildText) {
      return stored;
    }
  }

  const channelName = `${slugify(topic.name)}-reports`.slice(0, 90);
  await allianceGuild.channels.fetch();
  const existing = allianceGuild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildText
      && channel.parentId === env.RANGER_ALLIANCE_REPORTS_CATEGORY_ID
      && channel.name === channelName
  );
  const channel = existing?.type === ChannelType.GuildText
    ? existing
    : await allianceGuild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: env.RANGER_ALLIANCE_REPORTS_CATEGORY_ID,
        reason: `Create Ranger Alliance mirror for ${topic.name}`
      });
  await ensureReadOnlyChannel(channel);

  const { error: upsertError } = await supabase.from("alliance_topic_mirrors").upsert({
    topic_id: topic.id,
    alliance_guild_id: allianceGuild.id,
    alliance_channel_id: channel.id
  });
  assertNoDbError(upsertError, "store Ranger Alliance topic mirror");
  return channel;
}

async function ensureReadOnlyChannel(channel: TextChannel): Promise<void> {
  await channel.permissionOverwrites.edit(channel.guild.roles.everyone.id, { SendMessages: false });
  await channel.permissionOverwrites.edit(channel.guild.client.user.id, {
    ViewChannel: true,
    SendMessages: true,
    EmbedLinks: true,
    AttachFiles: true,
    ReadMessageHistory: true
  });
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

function corpsIntelMirrorEmbed(
  corpsGuild: Guild,
  report: IntelReportRow,
  trailmark: TrailmarkRow | undefined,
  reporterName: string,
  deliveredBy: string
): EmbedBuilder {
  const originalUrl = `https://discord.com/channels/${corpsGuild.id}/${report.discord_channel_id}/${report.discord_message_id}`;
  const source = trailmark ? `${trailmark.name} (${trailmark.hold})` : "Unknown Trailmark";
  const embed = new EmbedBuilder()
    .setTitle(`${trailmark?.name ?? "Ranger Corps Report"} - ${discordTime(report.created_at)}`)
    .setDescription(formatContent(report.content))
    .addFields(
      { name: "Reported by", value: reporterName, inline: true },
      { name: "Order", value: "Ranger Corps of Skyrim", inline: true },
      { name: "Source", value: source, inline: true },
      { name: "Report time", value: discordTime(report.created_at), inline: true },
      { name: "Delivered by", value: deliveredBy, inline: true },
      { name: "Delivered to Corps HQ", value: report.delivered_at ? discordTime(report.delivered_at) : "Unknown", inline: true },
      { name: "Corps archive", value: `[Open original report](${originalUrl})`, inline: false }
    )
    .setColor(0x587c4a)
    .setTimestamp(new Date(report.created_at));
  const atlasField = atlasReportFieldValue(report.atlas_summary, report.atlas_share_code);
  if (atlasField) {
    embed.addFields({ name: "Atlas Share", value: atlasField, inline: false });
  }
  return embed;
}

async function deleteAllianceReportTopicPublication(
  client: Client,
  publication: AllianceReportTopicPublicationRow
): Promise<void> {
  await Promise.all([
    deleteMessageIfPresent(client, env.DISCORD_GUILD_ID, publication.corps_channel_id, publication.corps_message_id),
    deleteMessageIfPresent(
      client,
      env.RANGER_ALLIANCE_GUILD_ID,
      publication.alliance_channel_id,
      publication.alliance_message_id
    )
  ]);
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
  const message = await fetchMessage(client, guildId, channelId, messageId);
  await message?.delete().catch(() => undefined);
}

async function fetchMessage(client: Client, guildId: string, channelId: string, messageId: string): Promise<Message | null> {
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  const channel = await guild?.channels.fetch(channelId).catch(() => null);
  if (!isReportChannel(channel)) {
    return null;
  }
  return channel.messages.fetch(messageId).catch(() => null);
}

async function fetchBridgeGuilds(client: Client): Promise<[Guild, Guild]> {
  const [corpsGuild, allianceGuild] = await Promise.all([
    client.guilds.fetch(env.DISCORD_GUILD_ID),
    client.guilds.fetch(env.RANGER_ALLIANCE_GUILD_ID)
  ]);
  return [corpsGuild, allianceGuild];
}

async function validateAllianceDiscordConfiguration(guild: Guild): Promise<void> {
  const [category, intake, admin] = await Promise.all([
    guild.channels.fetch(env.RANGER_ALLIANCE_REPORTS_CATEGORY_ID),
    guild.channels.fetch(env.RANGER_ALLIANCE_INTAKE_CHANNEL_ID),
    guild.channels.fetch(env.RANGER_ALLIANCE_ADMIN_CHANNEL_ID)
  ]);
  if (category?.type !== ChannelType.GuildCategory) {
    throw new UserFacingError("RANGER_ALLIANCE_REPORTS_CATEGORY_ID must point to a category.");
  }
  if (intake?.type !== ChannelType.GuildText) {
    throw new UserFacingError("RANGER_ALLIANCE_INTAKE_CHANNEL_ID must point to a text channel.");
  }
  if (admin?.type !== ChannelType.GuildText) {
    throw new UserFacingError("RANGER_ALLIANCE_ADMIN_CHANNEL_ID must point to a text channel.");
  }

  for (const roleId of allianceOrderRoleIds().concat(env.RANGER_ALLIANCE_ROLE_LEADERS_ID)) {
    if (!await guild.roles.fetch(roleId).catch(() => null)) {
      throw new UserFacingError(`Configured Ranger Alliance role ${roleId} was not found.`);
    }
  }
}

async function validateCorpsDiscordConfiguration(guild: Guild): Promise<void> {
  const category = await guild.channels.fetch(env.CORPS_INTEL_CATEGORY_ID);
  if (category?.type !== ChannelType.GuildCategory) {
    throw new UserFacingError("CORPS_INTEL_CATEGORY_ID must point to a category.");
  }
}

async function requireReportChannel(guild: Guild, channelId: string): Promise<ReportChannel> {
  const channel = await guild.channels.fetch(channelId);
  if (!isReportChannel(channel)) {
    throw new UserFacingError("An intel report channel was not found or is not a text channel.");
  }
  return channel;
}

function isReportChannel(channel: GuildBasedChannel | null | undefined): channel is ReportChannel {
  return channel?.type === ChannelType.GuildText || channel?.type === ChannelType.GuildAnnouncement;
}

async function listActiveTopics(): Promise<IntelTopicRow[]> {
  const { data, error } = await supabase
    .from("intel_topics")
    .select("*")
    .eq("active", true)
    .order("name", { ascending: true });
  assertNoDbError(error, "list active intel topics for Ranger Alliance");
  return data ?? [];
}

async function getAllianceReportByDiscordMessageId(messageId: string): Promise<AllianceReportRow | null> {
  const { data, error } = await supabase
    .from("alliance_reports")
    .select("*")
    .eq("discord_message_id", messageId)
    .maybeSingle();
  assertNoDbError(error, "get Alliance report");
  return data;
}

async function discordDisplayName(guild: Guild, userId: string): Promise<string> {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (member) {
    return member.displayName;
  }
  const user = await guild.client.users.fetch(userId).catch(() => null);
  return user?.displayName ?? user?.username ?? "Unknown Ranger";
}

function allianceOrderForMember(member: GuildMember): string | null {
  const matches = [
    { roleId: env.RANGER_ALLIANCE_ROLE_UNDAUNTED_ID, name: "Undaunted" },
    { roleId: env.RANGER_ALLIANCE_ROLE_NORTH_STAR_ID, name: "North Star Rangers" },
    { roleId: env.RANGER_ALLIANCE_ROLE_RANGER_CORPS_ID, name: "Ranger Corps of Skyrim" }
  ].filter((order) => member.roles.cache.has(order.roleId));
  return matches.length === 1 ? matches[0]?.name ?? null : null;
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
    env.RANGER_ALLIANCE_INTAKE_CHANNEL_ID,
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

function discordTime(value: string): string {
  return `<t:${Math.floor(new Date(value).getTime() / 1000)}:f>`;
}

function formatContent(content: string): string {
  const trimmed = content.trim();
  return trimmed.length <= MAX_DESCRIPTION_LENGTH
    ? trimmed
    : `${trimmed.slice(0, MAX_DESCRIPTION_LENGTH - 3).trimEnd()}...`;
}
