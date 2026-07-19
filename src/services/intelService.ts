import {
  ChannelType,
  EmbedBuilder,
  type ForumChannel,
  type Guild,
  type GuildBasedChannel,
  type Message,
  type NewsChannel,
  type Snowflake,
  type TextChannel,
  type TextBasedChannel,
  type ThreadChannel
} from "discord.js";
import {
  assertNoDbError,
  supabase,
  type IntelReportRow,
  type IntelSettingsRow,
  type IntelTopicRow,
  type TrailmarkSessionRow,
  type TrailmarkRow
} from "../db/supabase.js";
import {
  atlasPreviewToJson,
  atlasReportFieldValue,
  resolveAtlasSharePreviewFromContent
} from "./atlasService.js";
import { UserFacingError } from "../utils/errors.js";
import { matchingIntelTopics } from "../utils/intelKeywords.js";
import { emojiTitle, guildEmoji } from "../utils/guildEmojis.js";
import { slugify } from "../utils/slugs.js";
import { deleteStoredMessages, getBotMessageState, saveBotMessageState } from "./botMessageStateService.js";
import {
  deliverCarriedReportsToAllianceHeadquarters,
  deliverReportsOriginatingAtAllianceHeadquarters,
  isCorpsOnlyReport,
  publishDeliveredAllianceReportsToCorps,
  removeCorpsIntelReportFromAlliance
} from "./allianceIntelService.js";

const INTEL_TOPIC_STATE_PREFIX = "intel-topic";
const LEGACY_TRAILMARK_FORUM_CHANNEL_ID = "1511443716420800673";
const MAX_REPORT_DESCRIPTION_LENGTH = 4000;

type IntelReportChannel = TextChannel | NewsChannel;

export type IntelBackfillMode = "historical-delivery" | "pending-only";

export interface IntelBackfillResult {
  trailmarksScanned: number;
  legacyForumThreadsScanned: number;
  messagesScanned: number;
  matchedReports: number;
  catchallReports: number;
  deliveredReports: number;
  topicsRefreshed: number;
}

export interface IntelReporterRepairResult {
  topicsChecked: number;
  reportsChecked: number;
  namesRecovered: number;
  messagesUpdated: number;
  messagesMissing: number;
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

export async function setIntelCatchallTopic(topicId: string | null): Promise<IntelSettingsRow> {
  if (topicId) {
    await requireIntelTopic(topicId);
  }

  const { data, error } = await supabase
    .from("intel_settings")
    .upsert({ id: true, catchall_topic_id: topicId, updated_at: new Date().toISOString() })
    .select("*")
    .single();

  if (isMissingColumnError(error)) {
    throw new UserFacingError("Run migration 007_add_intel_catchall_topic.sql before configuring the catchall topic.");
  }

  assertNoDbError(error, "set intel catchall topic");
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

export async function updateIntelTopicKeywords(params: {
  topicId: string;
  keywords: string[];
  append: boolean;
}): Promise<IntelTopicRow> {
  if (params.keywords.length === 0) {
    throw new UserFacingError("Provide at least one keyword.");
  }

  const topic = await requireIntelTopic(params.topicId);
  const keywords = params.append ? dedupeKeywords([...topic.keywords, ...params.keywords]) : dedupeKeywords(params.keywords);
  const { data, error } = await supabase
    .from("intel_topics")
    .update({ keywords, updated_at: new Date().toISOString() })
    .eq("id", topic.id)
    .select("*")
    .single();

  assertNoDbError(error, "update intel topic keywords");
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

export async function repairIntelReporterNames(
  guild: Guild,
  topicId?: string
): Promise<IntelReporterRepairResult> {
  const topics = topicId ? [await requireIntelTopic(topicId)] : await listIntelTopics();
  const result: IntelReporterRepairResult = {
    topicsChecked: topics.length,
    reportsChecked: 0,
    namesRecovered: 0,
    messagesUpdated: 0,
    messagesMissing: 0
  };
  const channelCache = new Map<string, IntelReportChannel>();

  for (const topic of topics) {
    const reports = await listDeliveredReports(topic.id);
    const postedReports = reports.filter((report) =>
      Boolean(report.bulletin_message_id && report.bulletin_message_id !== "legacy")
    );
    result.reportsChecked += postedReports.length;

    const missingNamesBefore = postedReports.filter((report) => !report.author_display_name?.trim()).length;
    const trailmarks = await trailmarkMapForReports(postedReports);
    const displayNames = await resolveReportDisplayNames(guild, postedReports);
    const missingNamesAfter = postedReports.filter((report) => !report.author_display_name?.trim()).length;
    result.namesRecovered += missingNamesBefore - missingNamesAfter;

    for (const report of postedReports) {
      const channelId = report.bulletin_channel_id ?? topic.discord_channel_id;
      let channel = channelCache.get(channelId);
      if (!channel) {
        channel = await requireIntelTextChannel(guild, channelId);
        channelCache.set(channelId, channel);
      }

      const message = await channel.messages.fetch(report.bulletin_message_id!).catch(() => null);
      if (!message) {
        result.messagesMissing += 1;
        continue;
      }

      await message.edit({
        embeds: [reportEmbed(guild, report, trailmarks.get(report.trailmark_id), displayNames)]
      });
      result.messagesUpdated += 1;
    }
  }

  return result;
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

  if (isCorpsOnlyReport(content)) {
    return removeIntelReportsForDiscordMessage({
      guild: message.guild,
      channelId: message.channelId,
      messageId: message.id
    });
  }

  const settings = await getIntelSettings();
  const topics = await listIntelTopics();
  const catchallTopic = catchallTopicFromSettings(settings, topics);
  const routed = routeIntelContent({
    content,
    topics,
    catchallTopic
  });
  if (routed.topics.length === 0) {
    return 0;
  }

  const isHqReport = settings.hq_trailmark_id === trailmark.id;
  const deliveredTopicIds = new Set<string>();

  if (!routed.isCatchall && catchallTopic) {
    await removeCatchallReportForDiscordMessage({
      guild: message.guild,
      catchallTopicId: catchallTopic.id,
      channelId: message.channelId,
      messageId: message.id
    });
  }

  for (const topic of routed.topics) {
    await upsertIntelReport({
      topic,
      trailmark,
      message,
      isHqReport
    });
    if (isHqReport) {
      deliveredTopicIds.add(topic.id);
    }
  }

  await refreshDeliveredTopics(message.guild, deliveredTopicIds);
  await deliverReportsOriginatingAtAllianceHeadquarters({
    guild: message.guild,
    trailmark,
    deliveredByDiscordUserId: message.author.id,
    discordMessageId: message.id
  });
  return routed.topics.length;
}

export async function removeIntelReportsForDiscordMessage(params: {
  guild: Guild;
  channelId: string;
  messageId: string;
}): Promise<number> {
  const { data: reports, error } = await supabase
    .from("intel_reports")
    .select("*")
    .eq("discord_channel_id", params.channelId)
    .eq("discord_message_id", params.messageId);

  assertNoDbError(error, "list intel reports for deleted message");
  if (!reports?.length) {
    return 0;
  }

  for (const report of reports) {
    await deleteBulletinMessageForReport(params.guild, report);
    await removeCorpsIntelReportFromAlliance(params.guild.client, report.id);
  }

  const { error: deleteError } = await supabase
    .from("intel_reports")
    .delete()
    .eq("discord_channel_id", params.channelId)
    .eq("discord_message_id", params.messageId);

  assertNoDbError(deleteError, "delete intel reports for deleted message");
  return reports.length;
}

export async function removeCorpsOnlyIntelReports(guild: Guild): Promise<number> {
  const { data: reports, error } = await supabase
    .from("intel_reports")
    .select("discord_channel_id, discord_message_id, content")
    .order("created_at", { ascending: true });
  assertNoDbError(error, "list Corps-only intel reports");

  const messages = new Map<string, { channelId: string; messageId: string }>();
  for (const report of reports ?? []) {
    if (!isCorpsOnlyReport(report.content)) {
      continue;
    }
    messages.set(`${report.discord_channel_id}:${report.discord_message_id}`, {
      channelId: report.discord_channel_id,
      messageId: report.discord_message_id
    });
  }

  let removed = 0;
  for (const message of messages.values()) {
    removed += await removeIntelReportsForDiscordMessage({
      guild,
      channelId: message.channelId,
      messageId: message.messageId
    });
  }
  return removed;
}

export async function captureRecentTrailmarkMessagesForIntel(params: {
  guild: Guild;
  trailmark: TrailmarkRow;
  limit?: number;
}): Promise<number> {
  const channel = await params.guild.channels.fetch(params.trailmark.discord_channel_id).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) {
    return 0;
  }

  const messages = await channel.messages.fetch({ limit: params.limit ?? 50 });
  if (messages.size === 0) {
    return 0;
  }

  const topics = await listIntelTopics();
  const settings = await getIntelSettings();
  const catchallTopic = catchallTopicFromSettings(settings, topics);
  if (topics.length === 0 && !catchallTopic) {
    return 0;
  }

  const isHqReport = settings.hq_trailmark_id === params.trailmark.id;
  const touchedTopicIds = new Set<string>();
  let matchedReports = 0;

  for (const message of [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp)) {
    if (message.author.bot || !message.content.trim()) {
      continue;
    }

    if (isCorpsOnlyReport(message.content)) {
      await removeIntelReportsForDiscordMessage({
        guild: params.guild,
        channelId: message.channelId,
        messageId: message.id
      });
      continue;
    }

    const routed = routeIntelContent({
      content: message.content,
      topics,
      catchallTopic
    });
    if (routed.topics.length === 0) {
      continue;
    }

    if (!routed.isCatchall && catchallTopic) {
      await removeCatchallReportForDiscordMessage({
        guild: params.guild,
        catchallTopicId: catchallTopic.id,
        channelId: message.channelId,
        messageId: message.id
      });
    }

    for (const topic of routed.topics) {
      await upsertIntelReport({
        topic,
        trailmark: params.trailmark,
        message,
        isHqReport
      });
      matchedReports += 1;
      if (isHqReport) {
        touchedTopicIds.add(topic.id);
      }
    }
  }

  await refreshDeliveredTopics(params.guild, touchedTopicIds);
  return matchedReports;
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

  const allActiveTopics = await listIntelTopics();
  const configuredCatchallTopic = catchallTopicFromSettings(settings, allActiveTopics);
  const targetTopic = params.topicId ? await requireIntelTopic(params.topicId) : null;
  const targetIsCatchall = Boolean(targetTopic && configuredCatchallTopic?.id === targetTopic.id);
  const topics = targetTopic && !targetIsCatchall ? [targetTopic] : allActiveTopics;
  const catchallTopic = targetIsCatchall || !targetTopic ? configuredCatchallTopic : null;
  const deliveryTopicIds = targetTopic ? [targetTopic.id] : allActiveTopics.map((topic) => topic.id);

  if (topics.length === 0) {
    throw new UserFacingError("No active intel topics exist.");
  }

  const trailmarks = await listActiveTrailmarksForIntel();
  const touchedTopicIds = new Set<string>();
  let trailmarksScanned = 0;
  let legacyForumThreadsScanned = 0;
  let messagesScanned = 0;
  let matchedReports = 0;
  let catchallReports = 0;

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
      catchallTopic,
      catchallOnly: targetIsCatchall,
      hqTrailmarkId: settings.hq_trailmark_id,
      ...(params.after ? { after: params.after } : {}),
      limit: params.limitPerTrailmark
    });
    messagesScanned += result.messagesScanned;
    matchedReports += result.matchedReports;
    catchallReports += result.catchallReports;
    for (const topicId of result.touchedTopicIds) {
      touchedTopicIds.add(topicId);
    }
  }

  const legacyForumResult = await backfillLegacyTrailmarkForum({
    guild: params.guild,
    trailmarks,
    topics,
    catchallTopic,
    catchallOnly: targetIsCatchall,
    hqTrailmarkId: settings.hq_trailmark_id,
    ...(params.after ? { after: params.after } : {}),
    limitPerThread: params.limitPerTrailmark
  });
  legacyForumThreadsScanned = legacyForumResult.threadsScanned;
  messagesScanned += legacyForumResult.messagesScanned;
  matchedReports += legacyForumResult.matchedReports;
  catchallReports += legacyForumResult.catchallReports;
  for (const topicId of legacyForumResult.touchedTopicIds) {
    touchedTopicIds.add(topicId);
  }

  let deliveredReports = 0;
  if (params.mode === "historical-delivery" && settings.hq_trailmark_id) {
    deliveredReports = await deliverHistoricallyCarriedReports({
      topicIds: deliveryTopicIds,
      hqTrailmarkId: settings.hq_trailmark_id
    });
  }

  const refreshedTopicIds = new Set<string>(touchedTopicIds);
  if (deliveredReports > 0) {
    for (const topicId of deliveryTopicIds) {
      refreshedTopicIds.add(topicId);
    }
  }

  await refreshDeliveredTopics(params.guild, refreshedTopicIds);
  return {
    trailmarksScanned,
    legacyForumThreadsScanned,
    messagesScanned,
    matchedReports,
    catchallReports,
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
  let delivered = 0;
  if (settings.hq_trailmark_id && settings.hq_trailmark_id === params.trailmark.id) {
    delivered += await deliverCarriedReportsToHq({
      guild: params.guild,
      discordUserId: params.discordUserId,
      hqTrailmarkId: params.trailmark.id,
      hqVisitedAt: visitedAt
    });
  }
  delivered += await deliverCarriedReportsToAllianceHeadquarters({
    guild: params.guild,
    discordUserId: params.discordUserId,
    trailmark: params.trailmark,
    hqVisitedAt: visitedAt
  });
  return delivered;
}

async function backfillLegacyTrailmarkForum(params: {
  guild: Guild;
  trailmarks: TrailmarkRow[];
  topics: IntelTopicRow[];
  catchallTopic: IntelTopicRow | null;
  catchallOnly: boolean;
  hqTrailmarkId: string | null;
  after?: Date;
  limitPerThread: number;
}): Promise<{ threadsScanned: number; messagesScanned: number; matchedReports: number; catchallReports: number; touchedTopicIds: Set<string> }> {
  const forum = await params.guild.channels.fetch(LEGACY_TRAILMARK_FORUM_CHANNEL_ID).catch(() => null);
  if (!forum || forum.type !== ChannelType.GuildForum) {
    return { threadsScanned: 0, messagesScanned: 0, matchedReports: 0, catchallReports: 0, touchedTopicIds: new Set() };
  }

  let threadsScanned = 0;
  let messagesScanned = 0;
  let matchedReports = 0;
  let catchallReports = 0;
  const touchedTopicIds = new Set<string>();
  const threadIds = new Set<string>();

  for await (const thread of fetchLegacyForumThreads(forum)) {
    if (threadIds.has(thread.id)) {
      continue;
    }
    threadIds.add(thread.id);

    const trailmark = matchLegacyThreadToTrailmark(thread.name, params.trailmarks);
    if (!trailmark) {
      console.warn(`Could not map legacy Trailmark forum thread "${thread.name}" to an active Trailmark.`);
      continue;
    }

    threadsScanned += 1;
    const result = await backfillTrailmarkThread({
      thread,
      trailmark,
      topics: params.topics,
      catchallTopic: params.catchallTopic,
      catchallOnly: params.catchallOnly,
      hqTrailmarkId: params.hqTrailmarkId,
      ...(params.after ? { after: params.after } : {}),
      limit: params.limitPerThread
    });
    messagesScanned += result.messagesScanned;
    matchedReports += result.matchedReports;
    catchallReports += result.catchallReports;
    for (const topicId of result.touchedTopicIds) {
      touchedTopicIds.add(topicId);
    }
  }

  return { threadsScanned, messagesScanned, matchedReports, catchallReports, touchedTopicIds };
}

async function* fetchLegacyForumThreads(forum: ForumChannel): AsyncGenerator<ThreadChannel> {
  const active = await forum.threads.fetchActive();
  for (const thread of active.threads.values()) {
    yield thread;
  }

  let before: Snowflake | undefined;
  for (;;) {
    const archived = await forum.threads.fetchArchived({
      type: "public",
      limit: 100,
      ...(before ? { before } : {})
    });

    if (archived.threads.size === 0) {
      break;
    }

    const threads = [...archived.threads.values()];
    for (const thread of threads) {
      yield thread;
    }

    before = threads[threads.length - 1]?.id;
    if (!archived.hasMore) {
      break;
    }
  }
}

async function backfillTrailmarkChannel(params: {
  channel: TextChannel;
  trailmark: TrailmarkRow;
  topics: IntelTopicRow[];
  catchallTopic: IntelTopicRow | null;
  catchallOnly: boolean;
  hqTrailmarkId: string | null;
  after?: Date;
  limit: number;
}): Promise<{ messagesScanned: number; matchedReports: number; catchallReports: number; touchedTopicIds: Set<string> }> {
  let before: string | undefined;
  let messagesScanned = 0;
  let matchedReports = 0;
  let catchallReports = 0;
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

      if (isCorpsOnlyReport(message.content)) {
        await removeIntelReportsForDiscordMessage({
          guild: params.channel.guild,
          channelId: message.channelId,
          messageId: message.id
        });
        continue;
      }

      const routed = routeIntelContent({
        content: message.content,
        topics: params.topics,
        catchallTopic: params.catchallTopic
      });
      if (routed.topics.length === 0) {
        continue;
      }

      const isHqReport = params.hqTrailmarkId === params.trailmark.id;
      if (!routed.isCatchall && params.catchallTopic) {
        await removeCatchallReportForDiscordMessage({
          guild: params.channel.guild,
          catchallTopicId: params.catchallTopic.id,
          channelId: message.channelId,
          messageId: message.id
        });
      }
      if (params.catchallOnly && !routed.isCatchall) {
        continue;
      }

      for (const topic of routed.topics) {
        const inserted = await upsertIntelReport({
          topic,
          trailmark: params.trailmark,
          message,
          isHqReport
        });
        if (inserted) {
          if (routed.isCatchall) {
            catchallReports += 1;
          } else {
            matchedReports += 1;
          }
        }

        touchedTopicIds.add(topic.id);
      }
    }

    if (batch.length < 100 || batchIsOlderThanCutoff) {
      break;
    }
  }

  return { messagesScanned, matchedReports, catchallReports, touchedTopicIds };
}

async function backfillTrailmarkThread(params: {
  thread: ThreadChannel;
  trailmark: TrailmarkRow;
  topics: IntelTopicRow[];
  catchallTopic: IntelTopicRow | null;
  catchallOnly: boolean;
  hqTrailmarkId: string | null;
  after?: Date;
  limit: number;
}): Promise<{ messagesScanned: number; matchedReports: number; catchallReports: number; touchedTopicIds: Set<string> }> {
  let before: string | undefined;
  let messagesScanned = 0;
  let matchedReports = 0;
  let catchallReports = 0;
  const touchedTopicIds = new Set<string>();

  while (messagesScanned < params.limit) {
    const remaining = params.limit - messagesScanned;
    const messages = await params.thread.messages.fetch({
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

      if (isCorpsOnlyReport(message.content)) {
        if (message.guild) {
          await removeIntelReportsForDiscordMessage({
            guild: message.guild,
            channelId: message.channelId,
            messageId: message.id
          });
        }
        continue;
      }

      const routed = routeIntelContent({
        content: message.content,
        topics: params.topics,
        catchallTopic: params.catchallTopic
      });
      if (routed.topics.length === 0) {
        continue;
      }

      const isHqReport = params.hqTrailmarkId === params.trailmark.id;
      if (!routed.isCatchall && params.catchallTopic && message.guild) {
        await removeCatchallReportForDiscordMessage({
          guild: message.guild,
          catchallTopicId: params.catchallTopic.id,
          channelId: message.channelId,
          messageId: message.id
        });
      }
      if (params.catchallOnly && !routed.isCatchall) {
        continue;
      }

      for (const topic of routed.topics) {
        const inserted = await upsertIntelReport({
          topic,
          trailmark: params.trailmark,
          message,
          isHqReport
        });
        if (inserted) {
          if (routed.isCatchall) {
            catchallReports += 1;
          } else {
            matchedReports += 1;
          }
        }

        touchedTopicIds.add(topic.id);
      }
    }

    if (batch.length < 100 || batchIsOlderThanCutoff) {
      break;
    }
  }

  return { messagesScanned, matchedReports, catchallReports, touchedTopicIds };
}

async function upsertIntelReport(params: {
  topic: IntelTopicRow;
  trailmark: TrailmarkRow;
  message: Message;
  isHqReport: boolean;
}): Promise<boolean> {
  const atlasPreview = await resolveAtlasSharePreviewFromContent(params.message.content);
  const authorDisplayName = reportAuthorDisplayName(params.message);
  const basePayload = {
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
  };
  const payload = {
    ...basePayload,
    author_display_name: authorDisplayName,
    atlas_share_code: atlasPreview?.code ?? null,
    atlas_summary: atlasPreviewToJson(atlasPreview)
  };

  const { error } = await supabase
    .from("intel_reports")
    .upsert(payload, { onConflict: "topic_id,discord_message_id", ignoreDuplicates: !params.isHqReport });

  if (isMissingColumnError(error)) {
    const { error: retryError } = await supabase
      .from("intel_reports")
      .upsert(basePayload, { onConflict: "topic_id,discord_message_id", ignoreDuplicates: !params.isHqReport });
    assertNoDbError(retryError, "upsert Trailmark intel report without Atlas summary");
    return true;
  }

  assertNoDbError(error, "upsert Trailmark intel report");

  // Non-HQ backfills preserve existing delivery fields, so update the author
  // name separately when an existing report is ignored by the upsert.
  if (!params.isHqReport) {
    const { error: authorError } = await supabase
      .from("intel_reports")
      .update({ author_display_name: authorDisplayName })
      .eq("topic_id", params.topic.id)
      .eq("discord_message_id", params.message.id);
    assertNoDbError(authorError, "update Trailmark intel report author name");
  }

  return true;
}

function reportAuthorDisplayName(message: Message): string {
  return message.member?.displayName
    ?? message.author.globalName
    ?? message.author.username;
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

  const { data: sessions, error: sessionsError } = await supabase
    .from("trailmark_sessions")
    .select("*")
    .eq("discord_user_id", params.discordUserId)
    .neq("trailmark_id", params.hqTrailmarkId)
    .lte("created_at", params.hqVisitedAt);

  assertNoDbError(sessionsError, "list carried Trailmark sessions");

  const sourceWindows = sourceAccessWindows(visits ?? [], sessions ?? [], params.hqVisitedAt);
  if (sourceWindows.length === 0) {
    return 0;
  }

  const visitedTrailmarkIds = [...new Set(sourceWindows.map((window) => window.trailmarkId))];
  const { data: pendingReports, error: reportsError } = await supabase
    .from("intel_reports")
    .select("*")
    .is("delivered_at", null)
    .in("trailmark_id", visitedTrailmarkIds)
    .order("created_at", { ascending: true });

  assertNoDbError(reportsError, "list carried intel reports");

  const deliverableReports = (pendingReports ?? []).filter((report) =>
    sourceWindows.some((window) => window.trailmarkId === report.trailmark_id && timestampInWindow(report.created_at, window))
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
  await publishDeliveredAllianceReportsToCorps(params.guild, deliverableReports);
  await refreshDeliveredTopics(params.guild, new Set(deliverableReports.map((report) => report.topic_id)));
  return deliverableReports.length;
}

function sourceAccessWindows(
  visits: Array<{ trailmark_id: string; visited_at: string }>,
  sessions: Array<{ trailmark_id: string; created_at: string; expires_at: string }>,
  hqVisitedAt: string
): Array<{ trailmarkId: string; openedAt: string; carriedThroughAt: string }> {
  return [
    ...visits.map((visit) => ({
      trailmarkId: visit.trailmark_id,
      openedAt: new Date(0).toISOString(),
      carriedThroughAt: visit.visited_at
    })),
    ...sessions.map((session) => ({
      trailmarkId: session.trailmark_id,
      openedAt: session.created_at,
      carriedThroughAt: earlierIsoTimestamp(session.expires_at, hqVisitedAt)
    }))
  ];
}

function timestampInWindow(timestamp: string, window: { openedAt: string; carriedThroughAt: string }): boolean {
  const value = timestampMs(timestamp);
  return timestampMs(window.openedAt) <= value && value <= timestampMs(window.carriedThroughAt);
}

function earlierIsoTimestamp(a: string, b: string): string {
  return timestampMs(a) <= timestampMs(b) ? a : b;
}

function laterIsoTimestamp(a: string, b: string): string {
  return timestampMs(a) >= timestampMs(b) ? a : b;
}

function timestampMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
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
      const sourceAvailableAt = carriedReportAvailableAt(report.created_at, sourceSession);
      if (!sourceAvailableAt) {
        continue;
      }

      const hqSession = (hqSessionsByUser.get(sourceSession.discord_user_id) ?? []).find(
        (session) => timestampMs(session.created_at) > timestampMs(sourceAvailableAt)
      );
      if (!hqSession) {
        continue;
      }

      if (!bestDelivery || timestampMs(hqSession.created_at) < timestampMs(bestDelivery.deliveredAt)) {
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

function carriedReportAvailableAt(reportCreatedAt: string, sourceSession: TrailmarkSessionRow): string | null {
  const reportAt = timestampMs(reportCreatedAt);
  const openedAt = timestampMs(sourceSession.created_at);
  const expiresAt = timestampMs(sourceSession.expires_at);
  if (openedAt <= reportAt && reportAt <= expiresAt) {
    return reportCreatedAt;
  }

  if (reportAt <= openedAt) {
    return sourceSession.created_at;
  }

  return null;
}

async function refreshDeliveredTopics(guild: Guild, topicIds: Set<string>): Promise<void> {
  for (const topicId of topicIds) {
    await publishUnpostedDeliveredReports(guild, topicId);
  }
}

async function repostIntelTopicBulletin(guild: Guild, topic: IntelTopicRow): Promise<void> {
  const stateKey = intelTopicStateKey(topic.id);
  await deleteStoredMessages(guild, stateKey);

  const channel = await requireIntelTextChannel(guild, topic.discord_channel_id);
  const reports = await listDeliveredReports(topic.id);
  const validReports = await filterReportsWithExistingOriginals(guild, reports);
  const trailmarks = await trailmarkMapForReports(validReports);
  const displayNames = await resolveReportDisplayNames(guild, validReports);
  const sentMessages: Message[] = [];

  const header = new EmbedBuilder()
    .setTitle(emojiTitle(guild, "intel", `${topic.name} Reports`))
    .setDescription(
      validReports.length === 0
        ? "No delivered reports yet."
        : `${validReports.length} delivered report${validReports.length === 1 ? "" : "s"}. One report per message, sorted by original report time.`
    )
    .setColor(0x587c4a)
    .setTimestamp(new Date());
  sentMessages.push(await channel.send({ embeds: [header] }));

  for (const report of validReports) {
    const message = await channel.send({
      embeds: [reportEmbed(guild, report, trailmarks.get(report.trailmark_id), displayNames)]
    });
    await markReportPosted(report.id, channel.id, message.id);
    sentMessages.push(message);
  }

  await saveBotMessageState(stateKey, channel.id, sentMessages.map((message) => message.id));
}

async function publishUnpostedDeliveredReports(guild: Guild, topicId: string): Promise<void> {
  const topic = await getIntelTopic(topicId);
  if (!topic) {
    return;
  }

  const reports = await listUnpostedDeliveredReports(topic.id);
  if (reports.length === 0) {
    return;
  }

  const channel = await requireIntelTextChannel(guild, topic.discord_channel_id);
  const validReports = await filterReportsWithExistingOriginals(guild, reports);
  if (validReports.length === 0) {
    return;
  }

  const trailmarks = await trailmarkMapForReports(validReports);
  const displayNames = await resolveReportDisplayNames(guild, validReports);
  const sentMessageIds: string[] = [];

  for (const report of validReports) {
    const message = await channel.send({
      embeds: [reportEmbed(guild, report, trailmarks.get(report.trailmark_id), displayNames)]
    });
    await markReportPosted(report.id, channel.id, message.id);
    sentMessageIds.push(message.id);
  }

  await appendStoredTopicMessageIds(topic.id, channel.id, sentMessageIds);
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

async function listUnpostedDeliveredReports(topicId: string): Promise<IntelReportRow[]> {
  const { data, error } = await supabase
    .from("intel_reports")
    .select("*")
    .eq("topic_id", topicId)
    .not("delivered_at", "is", null)
    .is("bulletin_message_id", null)
    .order("created_at", { ascending: true });

  assertNoDbError(error, "list unposted delivered intel reports");
  return data ?? [];
}

async function markReportPosted(reportId: string, channelId: string, messageId: string): Promise<void> {
  const { error } = await supabase
    .from("intel_reports")
    .update({
      bulletin_channel_id: channelId,
      bulletin_message_id: messageId,
      bulletin_posted_at: new Date().toISOString()
    })
    .eq("id", reportId);

  assertNoDbError(error, "mark intel report posted");
}

async function filterReportsWithExistingOriginals(guild: Guild, reports: IntelReportRow[]): Promise<IntelReportRow[]> {
  const validReports: IntelReportRow[] = [];
  for (const report of reports) {
    if (await originalReportExists(guild, report)) {
      validReports.push(report);
      continue;
    }

    await deleteBulletinMessageForReport(guild, report);
    await removeCorpsIntelReportFromAlliance(guild.client, report.id);
    const { error } = await supabase.from("intel_reports").delete().eq("id", report.id);
    assertNoDbError(error, "delete intel report with missing original message");
  }

  return validReports;
}

async function originalReportExists(guild: Guild, report: IntelReportRow): Promise<boolean> {
  const channel = await guild.channels.fetch(report.discord_channel_id).catch(() => null);
  if (!isMessageFetchableChannel(channel)) {
    return false;
  }

  const message = await channel.messages.fetch(report.discord_message_id).catch(() => null);
  return Boolean(message);
}

async function deleteBulletinMessageForReport(guild: Guild, report: IntelReportRow): Promise<void> {
  if (!report.bulletin_channel_id || !report.bulletin_message_id || report.bulletin_message_id === "legacy") {
    return;
  }

  const channel = await guild.channels.fetch(report.bulletin_channel_id).catch(() => null);
  if (!isMessageFetchableChannel(channel)) {
    return;
  }

  const message = await channel.messages.fetch(report.bulletin_message_id).catch(() => null);
  if (message) {
    await message.delete().catch((error) => {
      console.warn(`Could not delete intel bulletin message ${report.bulletin_message_id}:`, error);
    });
  }
}

async function appendStoredTopicMessageIds(topicId: string, channelId: string, messageIds: string[]): Promise<void> {
  if (messageIds.length === 0) {
    return;
  }

  const stateKey = intelTopicStateKey(topicId);
  const existing = await getBotMessageState(stateKey);
  await saveBotMessageState(stateKey, channelId, [...(existing?.discord_message_ids ?? []), ...messageIds]);
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

export async function getIntelTopic(topicId: string): Promise<IntelTopicRow | null> {
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

async function requireIntelTextChannel(guild: Guild, channelId: string): Promise<IntelReportChannel> {
  const channel = await guild.channels.fetch(channelId);
  if (!isIntelReportChannel(channel)) {
    throw new UserFacingError("Intel report channel was not found or is not a text or announcement channel.");
  }

  return channel;
}

function isIntelReportChannel(channel: GuildBasedChannel | null): channel is IntelReportChannel {
  return channel?.type === ChannelType.GuildText || channel?.type === ChannelType.GuildAnnouncement;
}

function isMessageFetchableChannel(channel: GuildBasedChannel | null): channel is GuildBasedChannel & TextBasedChannel {
  return Boolean(channel?.isTextBased() && "messages" in channel);
}

function catchallTopicFromSettings(settings: IntelSettingsRow, topics: IntelTopicRow[]): IntelTopicRow | null {
  if (!settings.catchall_topic_id) {
    return null;
  }

  return topics.find((topic) => topic.id === settings.catchall_topic_id) ?? null;
}

function routeIntelContent(params: {
  content: string;
  topics: IntelTopicRow[];
  catchallTopic: IntelTopicRow | null;
}): { topics: IntelTopicRow[]; isCatchall: boolean } {
  const matchedTopics = params.topics.filter(
    (topic) => topic.id !== params.catchallTopic?.id && topicMatchesContent(topic, params.content)
  );
  if (matchedTopics.length > 0) {
    return { topics: matchedTopics, isCatchall: false };
  }

  return params.catchallTopic ? { topics: [params.catchallTopic], isCatchall: true } : { topics: [], isCatchall: false };
}

async function removeCatchallReportForDiscordMessage(params: {
  guild: Guild;
  catchallTopicId: string;
  channelId: string;
  messageId: string;
}): Promise<number> {
  const { data: reports, error } = await supabase
    .from("intel_reports")
    .select("*")
    .eq("topic_id", params.catchallTopicId)
    .eq("discord_channel_id", params.channelId)
    .eq("discord_message_id", params.messageId);

  assertNoDbError(error, "list catchall intel reports for categorized message");
  if (!reports?.length) {
    return 0;
  }

  for (const report of reports) {
    await deleteBulletinMessageForReport(params.guild, report);
    await removeCorpsIntelReportFromAlliance(params.guild.client, report.id);
  }

  const { error: deleteError } = await supabase
    .from("intel_reports")
    .delete()
    .in("id", reports.map((report) => report.id));

  assertNoDbError(deleteError, "delete catchall intel reports for categorized message");
  return reports.length;
}

function topicMatchesContent(topic: IntelTopicRow, content: string): boolean {
  return matchingIntelTopics([topic], content).length > 0;
}

function isMissingColumnError(error: { message: string; code?: string } | null): boolean {
  return Boolean(error && (error.code === "42703" || error.message.includes("column") && error.message.includes("does not exist")));
}

function dedupeKeywords(keywords: string[]): string[] {
  const seen = new Set<string>();
  return keywords
    .map((keyword) => keyword.trim())
    .filter((keyword) => {
      if (!keyword) {
        return false;
      }

      const key = keyword.toLocaleLowerCase();
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
}

function matchLegacyThreadToTrailmark(threadName: string, trailmarks: TrailmarkRow[]): TrailmarkRow | null {
  const threadSlug = normalizeLegacyTrailmarkName(threadName);
  return trailmarks.find((trailmark) => normalizeLegacyTrailmarkName(trailmark.name) === threadSlug)
    ?? trailmarks.find((trailmark) => threadSlug.includes(normalizeLegacyTrailmarkName(trailmark.name)))
    ?? trailmarks.find((trailmark) => normalizeLegacyTrailmarkName(trailmark.name).includes(threadSlug))
    ?? null;
}

function normalizeLegacyTrailmarkName(name: string): string {
  return slugify(name)
    .replace(/-stash$/u, "")
    .replace(/-trailmark$/u, "")
    .replace(/-headquarters$/u, "")
    .replace(/^trailmark-/u, "");
}

function reportEmbed(
  guild: Guild,
  report: IntelReportRow,
  trailmark: TrailmarkRow | undefined,
  displayNames: ReadonlyMap<string, string>
): EmbedBuilder {
  const reporter = report.author_display_name
    ?? displayNames.get(report.author_discord_user_id)
    ?? "Unknown reporter";
  const deliveredBy = report.delivered_by_discord_user_id
    ? displayNames.get(report.delivered_by_discord_user_id) ?? "Unknown Ranger"
    : "Unknown";
  const deliveredAt = report.delivered_at
    ? `${formatDiscordTime(report.delivered_at)} (${formatDiscordTime(report.delivered_at, "R")})`
    : "Unknown";
  const originalUrl = `https://discord.com/channels/${guild.id}/${report.discord_channel_id}/${report.discord_message_id}`;
  const where = trailmark ? `${trailmark.name} (${trailmark.hold})` : "Unknown Trailmark";
  const atlasField = atlasReportFieldValue(report.atlas_summary, report.atlas_share_code);

  const embed = new EmbedBuilder()
    .setTitle(`${trailmark?.name ?? "Unknown Trailmark"} - ${formatDiscordTime(report.created_at)}`)
    .setDescription(formatReportContent(report.content))
    .addFields(
      {
        name: "Reported by",
        value: reporter,
        inline: true
      },
      { name: "Order", value: report.source_order ?? "Ranger Corps of Skyrim", inline: true },
      { name: "Source", value: where, inline: true },
      { name: "Report time", value: formatDiscordTime(report.created_at), inline: true },
      { name: "Delivered by", value: deliveredBy, inline: true },
      { name: "Delivered to HQ", value: deliveredAt, inline: true },
      { name: "Original", value: `[Open report](${originalUrl})`, inline: true }
    )
    .setColor(0x587c4a)
    .setTimestamp(new Date(report.created_at));

  if (atlasField) {
    const atlasEmoji = guildEmoji(guild, "atlas");
    embed.addFields({ name: atlasEmoji ? `${atlasEmoji} Atlas Share` : "Atlas Share", value: atlasField, inline: false });
  }

  return embed;
}

async function resolveReportDisplayNames(
  guild: Guild,
  reports: IntelReportRow[]
): Promise<Map<string, string>> {
  const displayNames = new Map<string, string>();

  for (const report of reports) {
    const storedName = report.author_display_name?.trim();
    if (storedName) {
      displayNames.set(report.author_discord_user_id, storedName);
    }
  }

  const userIds = new Set<string>();
  for (const report of reports) {
    userIds.add(report.author_discord_user_id);
    if (report.delivered_by_discord_user_id) {
      userIds.add(report.delivered_by_discord_user_id);
    }
  }

  for (const userId of userIds) {
    if (displayNames.has(userId)) {
      continue;
    }

    const member = guild.members.cache.get(userId)
      ?? await guild.members.fetch(userId).catch(() => null);
    if (member) {
      displayNames.set(userId, member.displayName);
      continue;
    }

    const user = guild.client.users.cache.get(userId)
      ?? await guild.client.users.fetch(userId).catch(() => null);
    if (user) {
      displayNames.set(userId, user.globalName ?? user.username);
    }
  }

  const recoveredAuthors = new Map<string, string>();
  for (const report of reports) {
    if (report.author_display_name?.trim()) {
      continue;
    }

    const recoveredName = displayNames.get(report.author_discord_user_id);
    if (recoveredName) {
      report.author_display_name = recoveredName;
      recoveredAuthors.set(report.author_discord_user_id, recoveredName);
    }
  }

  await Promise.all([...recoveredAuthors].map(async ([userId, displayName]) => {
    const { error } = await supabase
      .from("intel_reports")
      .update({ author_display_name: displayName })
      .eq("author_discord_user_id", userId)
      .is("author_display_name", null);
    assertNoDbError(error, `recover intel report author name for ${userId}`);
  }));

  return displayNames;
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
