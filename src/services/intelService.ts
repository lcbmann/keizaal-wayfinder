import { ChannelType, EmbedBuilder, type Guild, type Message, type TextChannel } from "discord.js";
import {
  assertNoDbError,
  supabase,
  type IntelReportRow,
  type IntelSettingsRow,
  type IntelTopicRow,
  type TrailmarkSessionRow,
  type TrailmarkRow
} from "../db/supabase.js";
import { UserFacingError } from "../utils/errors.js";
import { slugify } from "../utils/slugs.js";
import { deleteStoredMessages, saveBotMessageState } from "./botMessageStateService.js";

const INTEL_TOPIC_STATE_PREFIX = "intel-topic";
const MAX_REPORT_DESCRIPTION_LENGTH = 4000;

export type IntelBackfillMode = "historical-delivery" | "pending-only";

export interface IntelBackfillResult {
  trailmarksScanned: number;
  messagesScanned: number;
  matchedReports: number;
  deliveredReports: number;
  topicsRefreshed: number;
}

export async function getIntelSettings(): Promise<IntelSettingsRow> {
  const { data, error } = await supabase.from("intel_settings").select("*").eq("id", true).maybeSingle();
  assertNoDbError(error, "get intel settings");

  if (data) {
    return data;
  }

  const { data: created, error: createError } = await supabase
    .from("intel_settings")
    .insert({ id: true })
    .select("*")
    .single();

  assertNoDbError(createError, "create intel settings");
  return created;
}

export async function setIntelHqTrailmark(trailmarkId: string): Promise<IntelSettingsRow> {
  const { data, error } = await supabase
    .from("intel_settings")
    .upsert({ id: true, hq_trailmark_id: trailmarkId, updated_at: new Date().toISOString() })
    .select("*")
    .single();

  assertNoDbError(error, "set intel HQ trailmark");
  return data;
}

export async function createIntelTopic(params: {
  name: string;
  keywords: string[];
  channelId: string;
  createdByDiscordUserId: string;
}): Promise<IntelTopicRow> {
  const { data, error } = await supabase
    .from("intel_topics")
    .insert({
      name: params.name,
      slug: slugify(params.name),
      keywords: params.keywords,
      discord_channel_id: params.channelId,
      active: true,
      created_by_discord_user_id: params.createdByDiscordUserId
    })
    .select("*")
    .single();

  assertNoDbError(error, "create intel topic");
  return data;
}

export async function listIntelTopics(includeInactive = false): Promise<IntelTopicRow[]> {
  let query = supabase.from("intel_topics").select("*").order("name", { ascending: true });
  if (!includeInactive) {
    query = query.eq("active", true);
  }

  const { data, error } = await query;
  assertNoDbError(error, "list intel topics");
  return data ?? [];
}

export async function findIntelTopicsByName(query: string): Promise<IntelTopicRow[]> {
  const { data, error } = await supabase
    .from("intel_topics")
    .select("*")
    .ilike("name", `%${query}%`)
    .order("name", { ascending: true })
    .limit(25);

  assertNoDbError(error, "find intel topics");
  return data ?? [];
}

export async function refreshIntelTopicBulletin(guild: Guild, topicId: string): Promise<void> {
  const topic = await getIntelTopic(topicId);
  if (!topic) {
    throw new UserFacingError("Intel topic was not found.");
  }

  await repostIntelTopicBulletin(guild, topic);
}

export async function captureTrailmarkIntelReports(message: Message): Promise<number> {
  if (!message.guild || message.author.bot) {
    return 0;
  }

  const content = message.content.trim();
  if (!content) {
    return 0;
  }

  const trailmark = await getActiveTrailmarkByChannelId(message.channelId);
  if (!trailmark) {
    return 0;
  }

  const topics = await listIntelTopics();
  const matchedTopics = topics.filter((topic) => topicMatchesContent(topic, content));
  if (matchedTopics.length === 0) {
    return 0;
  }

  const settings = await getIntelSettings();
  const isHqReport = settings.hq_trailmark_id === trailmark.id;
  const deliveredTopicIds = new Set<string>();

  for (const topic of matchedTopics) {
    const { error } = await supabase.from("intel_reports").upsert(
      {
        topic_id: topic.id,
        trailmark_id: trailmark.id,
        discord_message_id: message.id,
        discord_channel_id: message.channelId,
        author_discord_user_id: message.author.id,
        content,
        delivered_by_discord_user_id: isHqReport ? message.author.id : null,
        delivered_to_trailmark_id: isHqReport ? trailmark.id : null,
        delivered_at: isHqReport ? message.createdAt.toISOString() : null,
        created_at: message.createdAt.toISOString()
      },
      { onConflict: "topic_id,discord_message_id", ignoreDuplicates: true }
    );

    assertNoDbError(error, "capture Trailmark intel report");
    if (isHqReport) {
      deliveredTopicIds.add(topic.id);
    }
  }

  await refreshDeliveredTopics(message.guild, deliveredTopicIds);
  return matchedTopics.length;
}

export async function backfillTrailmarkIntel(params: {
  guild: Guild;
  topicId?: string;
  mode: IntelBackfillMode;
  after?: Date;
  limitPerTrailmark: number;
}): Promise<IntelBackfillResult> {
  const settings = await getIntelSettings();
  if (params.mode === "historical-delivery" && !settings.hq_trailmark_id) {
    throw new UserFacingError("Set an HQ Trailmark with /intel set-hq before historical delivery backfill.");
  }

  const topics = params.topicId ? [await requireIntelTopic(params.topicId)] : await listIntelTopics();
  if (topics.length === 0) {
    throw new UserFacingError("No active intel topics exist.");
  }

  const topicMap = new Map(topics.map((topic) => [topic.id, topic]));
  const trailmarks = await listActiveTrailmarksForIntel();
  const touchedTopicIds = new Set<string>();
  let trailmarksScanned = 0;
  let messagesScanned = 0;
  let matchedReports = 0;

  for (const trailmark of trailmarks) {
    const channel = await params.guild.channels.fetch(trailmark.discord_channel_id).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) {
      continue;
    }

    trailmarksScanned += 1;
    const result = await backfillTrailmarkChannel({
      channel,
      trailmark,
      topics,
      hqTrailmarkId: settings.hq_trailmark_id,
      ...(params.after ? { after: params.after } : {}),
      limit: params.limitPerTrailmark
    });
    messagesScanned += result.messagesScanned;
    matchedReports += result.matchedReports;
    for (const topicId of result.touchedTopicIds) {
      touchedTopicIds.add(topicId);
    }
  }

  let deliveredReports = 0;
  if (params.mode === "historical-delivery" && settings.hq_trailmark_id) {
    deliveredReports = await deliverHistoricallyCarriedReports({
      topicIds: [...topicMap.keys()],
      hqTrailmarkId: settings.hq_trailmark_id
    });
  }

  const refreshedTopicIds = new Set<string>(touchedTopicIds);
  if (deliveredReports > 0) {
    for (const topic of topics) {
      refreshedTopicIds.add(topic.id);
    }
  }

  await refreshDeliveredTopics(params.guild, refreshedTopicIds);
  return {
    trailmarksScanned,
    messagesScanned,
    matchedReports,
    deliveredReports,
    topicsRefreshed: refreshedTopicIds.size
  };
}

export async function recordTrailmarkVisitAndDeliver(params: {
  guild: Guild;
  discordUserId: string;
  trailmark: TrailmarkRow;
}): Promise<number> {
  const visitedAt = new Date().toISOString();
  const { error: visitError } = await supabase.from("intel_trailmark_visits").insert({
    discord_user_id: params.discordUserId,
    trailmark_id: params.trailmark.id,
    visited_at: visitedAt
  });

  assertNoDbError(visitError, "record Trailmark intel visit");

  const settings = await getIntelSettings();
  if (!settings.hq_trailmark_id || settings.hq_trailmark_id !== params.trailmark.id) {
    return 0;
  }

  return deliverCarriedReportsToHq({
    guild: params.guild,
    discordUserId: params.discordUserId,
    hqTrailmarkId: params.trailmark.id,
    hqVisitedAt: visitedAt
  });
}

async function backfillTrailmarkChannel(params: {
  channel: TextChannel;
  trailmark: TrailmarkRow;
  topics: IntelTopicRow[];
  hqTrailmarkId: string | null;
  after?: Date;
  limit: number;
}): Promise<{ messagesScanned: number; matchedReports: number; touchedTopicIds: Set<string> }> {
  let before: string | undefined;
  let messagesScanned = 0;
  let matchedReports = 0;
  const touchedTopicIds = new Set<string>();

  while (messagesScanned < params.limit) {
    const remaining = params.limit - messagesScanned;
    const messages = await params.channel.messages.fetch({
      limit: Math.min(100, remaining),
      ...(before ? { before } : {})
    });

    if (messages.size === 0) {
      break;
    }

    const batch = [...messages.values()];
    before = batch[batch.length - 1]?.id;
    const batchIsOlderThanCutoff = params.after ? batch.every((message) => message.createdAt < params.after!) : false;

    for (const message of batch) {
      messagesScanned += 1;
      if (params.after && message.createdAt < params.after) {
        continue;
      }

      if (message.author.bot || !message.content.trim()) {
        continue;
      }

      const matchedTopics = params.topics.filter((topic) => topicMatchesContent(topic, message.content));
      if (matchedTopics.length === 0) {
        continue;
      }

      const isHqReport = params.hqTrailmarkId === params.trailmark.id;
      for (const topic of matchedTopics) {
        const inserted = await upsertIntelReport({
          topic,
          trailmark: params.trailmark,
          message,
          isHqReport
        });
        if (inserted) {
          matchedReports += 1;
        }

        touchedTopicIds.add(topic.id);
      }
    }

    if (batch.length < 100 || batchIsOlderThanCutoff) {
      break;
    }
  }

  return { messagesScanned, matchedReports, touchedTopicIds };
}

async function upsertIntelReport(params: {
  topic: IntelTopicRow;
  trailmark: TrailmarkRow;
  message: Message;
  isHqReport: boolean;
}): Promise<boolean> {
  const { error } = await supabase.from("intel_reports").upsert(
    {
      topic_id: params.topic.id,
      trailmark_id: params.trailmark.id,
      discord_message_id: params.message.id,
      discord_channel_id: params.message.channelId,
      author_discord_user_id: params.message.author.id,
      content: params.message.content.trim(),
      delivered_by_discord_user_id: params.isHqReport ? params.message.author.id : null,
      delivered_to_trailmark_id: params.isHqReport ? params.trailmark.id : null,
      delivered_at: params.isHqReport ? params.message.createdAt.toISOString() : null,
      created_at: params.message.createdAt.toISOString()
    },
    { onConflict: "topic_id,discord_message_id", ignoreDuplicates: true }
  );

  assertNoDbError(error, "upsert Trailmark intel report");
  return true;
}

async function deliverCarriedReportsToHq(params: {
  guild: Guild;
  discordUserId: string;
  hqTrailmarkId: string;
  hqVisitedAt: string;
}): Promise<number> {
  const { data: visits, error: visitsError } = await supabase
    .from("intel_trailmark_visits")
    .select("*")
    .eq("discord_user_id", params.discordUserId)
    .neq("trailmark_id", params.hqTrailmarkId)
    .lt("visited_at", params.hqVisitedAt);

  assertNoDbError(visitsError, "list carried Trailmark visits");
  if (!visits?.length) {
    return 0;
  }

  const visitedTrailmarkIds = [...new Set(visits.map((visit) => visit.trailmark_id))];
  const { data: pendingReports, error: reportsError } = await supabase
    .from("intel_reports")
    .select("*")
    .is("delivered_at", null)
    .in("trailmark_id", visitedTrailmarkIds)
    .order("created_at", { ascending: true });

  assertNoDbError(reportsError, "list carried intel reports");

  const deliverableReports = (pendingReports ?? []).filter((report) =>
    visits.some((visit) => visit.trailmark_id === report.trailmark_id && visit.visited_at >= report.created_at)
  );

  if (deliverableReports.length === 0) {
    return 0;
  }

  const deliveredAt = new Date().toISOString();
  const deliveredIds = deliverableReports.map((report) => report.id);
  const { error: deliveryError } = await supabase
    .from("intel_reports")
    .update({
      delivered_by_discord_user_id: params.discordUserId,
      delivered_to_trailmark_id: params.hqTrailmarkId,
      delivered_at: deliveredAt
    })
    .in("id", deliveredIds);

  assertNoDbError(deliveryError, "deliver intel reports to HQ");
  await refreshDeliveredTopics(params.guild, new Set(deliverableReports.map((report) => report.topic_id)));
  return deliverableReports.length;
}

async function deliverHistoricallyCarriedReports(params: {
  topicIds: string[];
  hqTrailmarkId: string;
}): Promise<number> {
  if (params.topicIds.length === 0) {
    return 0;
  }

  const { data: pendingReports, error: reportsError } = await supabase
    .from("intel_reports")
    .select("*")
    .is("delivered_at", null)
    .in("topic_id", params.topicIds)
    .order("created_at", { ascending: true });

  assertNoDbError(reportsError, "list historical pending intel reports");
  if (!pendingReports?.length) {
    return 0;
  }

  const earliestReport = pendingReports[0]?.created_at;
  const { data: sessions, error: sessionsError } = await supabase
    .from("trailmark_sessions")
    .select("*")
    .gte("created_at", earliestReport ?? new Date(0).toISOString())
    .order("created_at", { ascending: true });

  assertNoDbError(sessionsError, "list historical Trailmark sessions");
  if (!sessions?.length) {
    return 0;
  }

  const updates = historicalDeliveryUpdates(pendingReports, sessions, params.hqTrailmarkId);
  let delivered = 0;
  for (const update of updates) {
    const { error } = await supabase
      .from("intel_reports")
      .update({
        delivered_by_discord_user_id: update.deliveredByDiscordUserId,
        delivered_to_trailmark_id: params.hqTrailmarkId,
        delivered_at: update.deliveredAt
      })
      .eq("id", update.reportId);

    assertNoDbError(error, "historically deliver intel report");
    delivered += 1;
  }

  return delivered;
}

function historicalDeliveryUpdates(
  reports: IntelReportRow[],
  sessions: TrailmarkSessionRow[],
  hqTrailmarkId: string
): Array<{ reportId: string; deliveredByDiscordUserId: string; deliveredAt: string }> {
  const sessionsByTrailmark = new Map<string, TrailmarkSessionRow[]>();
  const hqSessionsByUser = new Map<string, TrailmarkSessionRow[]>();
  for (const session of sessions) {
    const trailmarkSessions = sessionsByTrailmark.get(session.trailmark_id) ?? [];
    trailmarkSessions.push(session);
    sessionsByTrailmark.set(session.trailmark_id, trailmarkSessions);

    if (session.trailmark_id === hqTrailmarkId) {
      const userSessions = hqSessionsByUser.get(session.discord_user_id) ?? [];
      userSessions.push(session);
      hqSessionsByUser.set(session.discord_user_id, userSessions);
    }
  }

  const updates: Array<{ reportId: string; deliveredByDiscordUserId: string; deliveredAt: string }> = [];
  for (const report of reports) {
    const sourceSessions = sessionsByTrailmark.get(report.trailmark_id) ?? [];
    let bestDelivery: { deliveredByDiscordUserId: string; deliveredAt: string } | null = null;

    for (const sourceSession of sourceSessions) {
      if (sourceSession.created_at < report.created_at) {
        continue;
      }

      const hqSession = (hqSessionsByUser.get(sourceSession.discord_user_id) ?? []).find(
        (session) => session.created_at > sourceSession.created_at
      );
      if (!hqSession) {
        continue;
      }

      if (!bestDelivery || hqSession.created_at < bestDelivery.deliveredAt) {
        bestDelivery = {
          deliveredByDiscordUserId: sourceSession.discord_user_id,
          deliveredAt: hqSession.created_at
        };
      }
    }

    if (bestDelivery) {
      updates.push({ reportId: report.id, ...bestDelivery });
    }
  }

  return updates;
}

async function refreshDeliveredTopics(guild: Guild, topicIds: Set<string>): Promise<void> {
  for (const topicId of topicIds) {
    await refreshIntelTopicBulletin(guild, topicId);
  }
}

async function repostIntelTopicBulletin(guild: Guild, topic: IntelTopicRow): Promise<void> {
  const stateKey = intelTopicStateKey(topic.id);
  await deleteStoredMessages(guild, stateKey);

  const channel = await requireIntelTextChannel(guild, topic.discord_channel_id);
  const reports = await listDeliveredReports(topic.id);
  const trailmarks = await trailmarkMapForReports(reports);
  const sentMessages: Message[] = [];

  const header = new EmbedBuilder()
    .setTitle(`${topic.name} Reports`)
    .setDescription(
      reports.length === 0
        ? "No delivered reports yet."
        : `${reports.length} delivered report${reports.length === 1 ? "" : "s"}. One report per message, sorted by original report time.`
    )
    .setColor(0x587c4a)
    .setTimestamp(new Date());
  sentMessages.push(await channel.send({ embeds: [header] }));

  for (const report of reports) {
    sentMessages.push(
      await channel.send({
        embeds: [reportEmbed(guild, report, trailmarks.get(report.trailmark_id))]
      })
    );
  }

  await saveBotMessageState(stateKey, channel.id, sentMessages.map((message) => message.id));
}

async function listDeliveredReports(topicId: string): Promise<IntelReportRow[]> {
  const { data, error } = await supabase
    .from("intel_reports")
    .select("*")
    .eq("topic_id", topicId)
    .not("delivered_at", "is", null)
    .order("created_at", { ascending: true });

  assertNoDbError(error, "list delivered intel reports");
  return data ?? [];
}

async function trailmarkMapForReports(reports: IntelReportRow[]): Promise<Map<string, TrailmarkRow>> {
  const trailmarkIds = [...new Set(reports.map((report) => report.trailmark_id))];
  if (trailmarkIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase.from("trailmarks").select("*").in("id", trailmarkIds);
  assertNoDbError(error, "list intel report trailmarks");
  return new Map((data ?? []).map((trailmark) => [trailmark.id, trailmark]));
}

async function requireIntelTopic(topicId: string): Promise<IntelTopicRow> {
  const topic = await getIntelTopic(topicId);
  if (!topic || !topic.active) {
    throw new UserFacingError("Intel topic was not found or inactive.");
  }

  return topic;
}

async function getIntelTopic(topicId: string): Promise<IntelTopicRow | null> {
  const { data, error } = await supabase.from("intel_topics").select("*").eq("id", topicId).maybeSingle();
  assertNoDbError(error, "get intel topic");
  return data;
}

async function listActiveTrailmarksForIntel(): Promise<TrailmarkRow[]> {
  const { data, error } = await supabase
    .from("trailmarks")
    .select("*")
    .eq("active", true)
    .order("name", { ascending: true });

  assertNoDbError(error, "list active Trailmarks for intel");
  return data ?? [];
}

async function getActiveTrailmarkByChannelId(channelId: string): Promise<TrailmarkRow | null> {
  const { data, error } = await supabase
    .from("trailmarks")
    .select("*")
    .eq("discord_channel_id", channelId)
    .eq("active", true)
    .maybeSingle();

  assertNoDbError(error, "get active Trailmark by channel");
  return data;
}

async function requireIntelTextChannel(guild: Guild, channelId: string): Promise<TextChannel> {
  const channel = await guild.channels.fetch(channelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new UserFacingError("Intel report channel was not found or is not a text channel.");
  }

  return channel;
}

function topicMatchesContent(topic: IntelTopicRow, content: string): boolean {
  const normalizedContent = content.toLowerCase();
  return topic.keywords.some((keyword) => normalizedContent.includes(keyword.toLowerCase()));
}

function reportEmbed(guild: Guild, report: IntelReportRow, trailmark: TrailmarkRow | undefined): EmbedBuilder {
  const deliveredBy = report.delivered_by_discord_user_id ? `<@${report.delivered_by_discord_user_id}>` : "Unknown";
  const deliveredAt = report.delivered_at
    ? `${formatDiscordTime(report.delivered_at)} (${formatDiscordTime(report.delivered_at, "R")})`
    : "Unknown";
  const originalUrl = `https://discord.com/channels/${guild.id}/${report.discord_channel_id}/${report.discord_message_id}`;
  const where = trailmark ? `${trailmark.name} (${trailmark.hold})` : "Unknown Trailmark";

  return new EmbedBuilder()
    .setTitle(`${trailmark?.name ?? "Unknown Trailmark"} - ${formatDiscordTime(report.created_at)}`)
    .setDescription(formatReportContent(report.content))
    .addFields(
      { name: "Reported by", value: `<@${report.author_discord_user_id}>`, inline: true },
      { name: "Source", value: where, inline: true },
      { name: "Report time", value: formatDiscordTime(report.created_at), inline: true },
      { name: "Delivered by", value: deliveredBy, inline: true },
      { name: "Delivered to HQ", value: deliveredAt, inline: true },
      { name: "Original", value: `[Open report](${originalUrl})`, inline: true }
    )
    .setColor(0x587c4a)
    .setTimestamp(new Date(report.created_at));
}

function formatDiscordTime(value: string, style = "f"): string {
  return `<t:${Math.floor(new Date(value).getTime() / 1000)}:${style}>`;
}

function formatReportContent(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= MAX_REPORT_DESCRIPTION_LENGTH) {
    return trimmed;
  }

  return `${trimmed.slice(0, MAX_REPORT_DESCRIPTION_LENGTH - 3).trimEnd()}...`;
}

function intelTopicStateKey(topicId: string): string {
  return `${INTEL_TOPIC_STATE_PREFIX}:${topicId}`;
}
