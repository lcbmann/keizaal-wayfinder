import { ChannelType, EmbedBuilder, type Guild, type PublicThreadChannel, type TextChannel } from "discord.js";
import {
  assertNoDbError,
  supabase,
  type CorpsMedalRow,
  type RangerMedalAwardRow,
  type RangerRow,
  type RankHistoryRow
} from "../db/supabase.js";
import { guildEmoji, rankEmojiName } from "../utils/guildEmojis.js";
import { getBotMessageState, saveBotMessageState } from "./botMessageStateService.js";

const HONORS_LEDGER_STATE_KEY = "corps_honors_ledger";
const HONORS_LEDGER_THREAD_NAME = "Corps Honors Record";

export interface HonorsLedgerSetupResult {
  thread: PublicThreadChannel;
  created: boolean;
  medalsBackfilled: number;
  promotionsBackfilled: number;
}

export async function setupHonorsLedger(
  guild: Guild,
  parentChannel: TextChannel
): Promise<HonorsLedgerSetupResult> {
  let thread = await getHonorsLedgerThread(guild);
  let created = false;

  if (!thread) {
    const starter = await parentChannel.send({
      embeds: [honorsLedgerIntroEmbed(guild)]
    });
    thread = await starter.startThread({
      name: HONORS_LEDGER_THREAD_NAME,
      autoArchiveDuration: 10080,
      reason: "Set up the Ranger Corps honors record"
    });
    await saveBotMessageState(HONORS_LEDGER_STATE_KEY, thread.id, [starter.id]);
    created = true;
  }

  await refreshHonorsLedgerIntro(guild, thread);
  const backfill = await backfillHonorsLedger(guild, thread);
  return {
    thread,
    created,
    medalsBackfilled: backfill.medals,
    promotionsBackfilled: backfill.promotions
  };
}

export async function appendMedalAwardToHonorsLedger(params: {
  guild: Guild;
  ranger: RangerRow;
  medal: CorpsMedalRow;
  award: RangerMedalAwardRow;
}): Promise<boolean> {
  const thread = await getHonorsLedgerThread(params.guild);
  if (!thread) {
    return false;
  }
  return postHonorsLedgerEntry({
    thread,
    sourceType: "medal_award",
    sourceId: params.award.id,
    embed: medalAwardEmbed(params.guild, params.ranger, params.medal, params.award)
  });
}

export async function appendPromotionToHonorsLedger(params: {
  guild: Guild;
  ranger: RangerRow;
  history: RankHistoryRow;
}): Promise<boolean> {
  const thread = await getHonorsLedgerThread(params.guild);
  if (!thread) {
    return false;
  }
  return postHonorsLedgerEntry({
    thread,
    sourceType: "promotion",
    sourceId: params.history.id,
    embed: promotionEmbed(params.guild, params.ranger, params.history)
  });
}

export async function removeMedalAwardFromHonorsLedger(guild: Guild, awardId: string): Promise<boolean> {
  const { data: entry, error } = await supabase
    .from("honors_ledger_entries")
    .select("id, discord_thread_id, discord_message_id")
    .eq("source_type", "medal_award")
    .eq("source_id", awardId)
    .maybeSingle();
  assertNoDbError(error, "get revoked medal honors entry");
  if (!entry) {
    return false;
  }

  const thread = await guild.channels.fetch(entry.discord_thread_id).catch(() => null);
  if (thread?.isThread()) {
    const message = await thread.messages.fetch(entry.discord_message_id).catch(() => null);
    await message?.delete().catch((deleteError) => {
      console.warn(`Could not delete revoked medal honors message ${entry.discord_message_id}:`, deleteError);
    });
  }
  const { error: deleteError } = await supabase.from("honors_ledger_entries").delete().eq("id", entry.id);
  assertNoDbError(deleteError, "remove revoked medal honors entry");
  return true;
}

async function backfillHonorsLedger(
  guild: Guild,
  thread: PublicThreadChannel
): Promise<{ medals: number; promotions: number }> {
  const [awardsResult, medalsResult, rangersResult, historyResult] = await Promise.all([
    supabase.from("ranger_medal_awards").select("*"),
    supabase.from("corps_medals").select("*"),
    supabase.from("rangers").select("*"),
    supabase.from("rank_history").select("*")
  ]);
  assertNoDbError(awardsResult.error, "load medal awards for honors ledger");
  assertNoDbError(medalsResult.error, "load medals for honors ledger");
  assertNoDbError(rangersResult.error, "load Rangers for honors ledger");
  assertNoDbError(historyResult.error, "load promotion history for honors ledger");

  const medalsById = new Map((medalsResult.data ?? []).map((medal) => [medal.id, medal]));
  const rangersById = new Map((rangersResult.data ?? []).map((ranger) => [ranger.id, ranger]));
  const events: Array<{
    sourceType: "medal_award" | "promotion";
    sourceId: string;
    occurredAt: string;
    embed: EmbedBuilder;
  }> = [];

  for (const award of awardsResult.data ?? []) {
    const medal = medalsById.get(award.medal_id);
    const ranger = rangersById.get(award.ranger_id);
    if (medal && ranger) {
      events.push({
        sourceType: "medal_award",
        sourceId: award.id,
        occurredAt: award.awarded_at,
        embed: medalAwardEmbed(guild, ranger, medal, award)
      });
    }
  }

  for (const history of historyResult.data ?? []) {
    const ranger = rangersById.get(history.ranger_id);
    if (ranger) {
      events.push({
        sourceType: "promotion",
        sourceId: history.id,
        occurredAt: history.created_at,
        embed: promotionEmbed(guild, ranger, history)
      });
    }
  }

  events.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  let medals = 0;
  let promotions = 0;
  for (const event of events) {
    try {
      const posted = await postHonorsLedgerEntry({
        thread,
        sourceType: event.sourceType,
        sourceId: event.sourceId,
        embed: event.embed
      });
      if (posted) {
        if (event.sourceType === "medal_award") {
          medals += 1;
        } else {
          promotions += 1;
        }
      }
    } catch (error) {
      console.warn(`Could not backfill ${event.sourceType} ${event.sourceId} to the honors ledger:`, error);
    }
  }
  return { medals, promotions };
}

async function getHonorsLedgerThread(guild: Guild): Promise<PublicThreadChannel | null> {
  const state = await getBotMessageState(HONORS_LEDGER_STATE_KEY);
  if (!state) {
    return null;
  }
  const channel = await guild.channels.fetch(state.discord_channel_id).catch(() => null);
  if (channel?.type !== ChannelType.PublicThread) {
    return null;
  }
  if (channel.archived) {
    await channel.setArchived(false, "Add an entry to the Ranger Corps honors record");
  }
  return channel;
}

async function postHonorsLedgerEntry(params: {
  thread: PublicThreadChannel;
  sourceType: "medal_award" | "promotion";
  sourceId: string;
  embed: EmbedBuilder;
}): Promise<boolean> {
  const { data: existing, error: existingError } = await supabase
    .from("honors_ledger_entries")
    .select("id, discord_message_id")
    .eq("source_type", params.sourceType)
    .eq("source_id", params.sourceId)
    .maybeSingle();
  assertNoDbError(existingError, "check honors ledger entry");
  if (existing) {
    const existingMessage = await params.thread.messages.fetch(existing.discord_message_id).catch(() => null);
    if (existingMessage) {
      await existingMessage.edit({ embeds: [params.embed] });
      return false;
    }

    const message = await params.thread.send({ embeds: [params.embed] });
    const { error } = await supabase
      .from("honors_ledger_entries")
      .update({
        discord_thread_id: params.thread.id,
        discord_message_id: message.id
      })
      .eq("id", existing.id);
    assertNoDbError(error, "restore honors ledger entry");
    return true;
  }

  const message = await params.thread.send({ embeds: [params.embed] });
  const { error } = await supabase.from("honors_ledger_entries").insert({
    source_type: params.sourceType,
    source_id: params.sourceId,
    discord_thread_id: params.thread.id,
    discord_message_id: message.id
  });
  assertNoDbError(error, "record honors ledger entry");
  return true;
}

async function refreshHonorsLedgerIntro(guild: Guild, thread: PublicThreadChannel): Promise<void> {
  const state = await getBotMessageState(HONORS_LEDGER_STATE_KEY);
  const starterMessageId = state?.discord_message_ids[0];
  const parent = thread.parent;
  if (!starterMessageId || parent?.type !== ChannelType.GuildText) {
    return;
  }

  const starter = await parent.messages.fetch(starterMessageId).catch(() => null);
  if (starter) {
    await starter.edit({ embeds: [honorsLedgerIntroEmbed(guild)] });
  }
}

function honorsLedgerIntroEmbed(guild: Guild): EmbedBuilder {
  const emoji = guildEmoji(guild, "corps");
  return new EmbedBuilder()
    .setColor(0x587c4a)
    .setTitle(`${emoji ? `${emoji} - ` : ""}Corps Honors Record`)
    .setDescription("A permanent record of Ranger promotions and Corps medals. Wayfinder adds new entries here without mentioning members.");
}

function medalAwardEmbed(guild: Guild, ranger: RangerRow, medal: CorpsMedalRow, award: RangerMedalAwardRow): EmbedBuilder {
  const emoji = medalEmoji(guild, medal);
  return new EmbedBuilder()
    .setColor(0x6d8f5b)
    .setTitle(`${emoji ? `${emoji} - ` : ""}Medal Awarded: ${medal.name}`)
    .setDescription(`**Recipient**\n${rangerLabel(guild, ranger, ranger.current_rank)}`)
    .addFields(
      { name: "What it recognizes", value: medal.description.slice(0, 1024) },
      { name: "Reason", value: award.reason?.trim().slice(0, 1024) || "No reason recorded." }
    )
    .setTimestamp(new Date(award.awarded_at));
}

function promotionEmbed(guild: Guild, ranger: RangerRow, history: RankHistoryRow): EmbedBuilder {
  const previousRank = history.old_rank ?? "Unrecorded rank";
  const targetBadge = rankBadge(guild, history.new_rank);
  const priorBadge = history.old_rank ? rankBadge(guild, history.old_rank) : "";
  return new EmbedBuilder()
    .setColor(0x7189b1)
    .setTitle(`${targetBadge ? `${targetBadge} - ` : ""}Promotion Recorded: ${rangerLabel(guild, ranger, history.new_rank)}`)
    .setDescription(`Advanced from ${priorBadge ? `${priorBadge} ` : ""}**${previousRank}** to ${targetBadge ? `${targetBadge} ` : ""}**${history.new_rank}**.`)
    .addFields({ name: "Reason", value: history.reason?.trim().slice(0, 1024) || "No reason recorded." })
    .setTimestamp(new Date(history.created_at));
}

function rangerLabel(guild: Guild, ranger: RangerRow, rank: RangerRow["current_rank"]): string {
  const name = ranger.discord_display_name ?? ranger.in_game_name ?? ranger.discord_username ?? "Unknown Ranger";
  const badge = rankBadge(guild, rank);
  const prefix = badge ? `${badge} ` : "";
  switch (rank) {
    case "Ranger Commander":
      return `${prefix}Commander ${name}`;
    case "Ranger Captain":
      return `${prefix}Captain ${name}`;
    case "Ranger Marshal":
      return `${prefix}Marshal ${name}`;
    default:
      return `${prefix}${rank} ${name}`;
  }
}

function rankBadge(guild: Guild, rank: string): string {
  const emojiName = rankEmojiName(rank);
  return emojiName ? guildEmoji(guild, emojiName) : "";
}

function medalEmoji(guild: Guild, medal: CorpsMedalRow): string {
  const value = medal.emoji?.trim();
  if (!value) {
    return "";
  }
  const emojiName = value.match(/^<a?:([A-Za-z0-9_]+):\d+>$/u)?.[1]
    ?? value.replace(/^:+|:+$/gu, "").trim();
  return guild.emojis.cache.find((emoji) => emoji.name === emojiName)?.toString() ?? value;
}
