import { ChannelType, EmbedBuilder, type Guild, type PublicThreadChannel, type TextChannel } from "discord.js";
import {
  assertNoDbError,
  supabase,
  type CorpsMedalRow,
  type RangerMedalAwardRow,
  type RangerRow,
  type RankHistoryRow
} from "../db/supabase.js";
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
      embeds: [honorsLedgerIntroEmbed()]
    });
    thread = await starter.startThread({
      name: HONORS_LEDGER_THREAD_NAME,
      autoArchiveDuration: 10080,
      reason: "Set up the Ranger Corps honors record"
    });
    await saveBotMessageState(HONORS_LEDGER_STATE_KEY, thread.id, [starter.id]);
    created = true;
  }

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
    embed: medalAwardEmbed(params.ranger, params.medal, params.award)
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
    embed: promotionEmbed(params.ranger, params.history)
  });
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
        embed: medalAwardEmbed(ranger, medal, award)
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
        embed: promotionEmbed(ranger, history)
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
    .select("id")
    .eq("source_type", params.sourceType)
    .eq("source_id", params.sourceId)
    .maybeSingle();
  assertNoDbError(existingError, "check honors ledger entry");
  if (existing) {
    return false;
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

function honorsLedgerIntroEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x587c4a)
    .setTitle("Corps Honors Record")
    .setDescription("A permanent record of Ranger promotions and Corps medals. Wayfinder adds new entries here without mentioning members.");
}

function medalAwardEmbed(ranger: RangerRow, medal: CorpsMedalRow, award: RangerMedalAwardRow): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x6d8f5b)
    .setTitle(`Medal Awarded - ${medal.name}`)
    .setDescription(`**Recipient**\n${rangerLabel(ranger, ranger.current_rank)}`)
    .addFields(
      { name: "What it recognizes", value: medal.description.slice(0, 1024) },
      { name: "Reason", value: award.reason?.trim().slice(0, 1024) || "No reason recorded." }
    )
    .setTimestamp(new Date(award.awarded_at));
}

function promotionEmbed(ranger: RangerRow, history: RankHistoryRow): EmbedBuilder {
  const previousRank = history.old_rank ?? "Unrecorded rank";
  return new EmbedBuilder()
    .setColor(0x7189b1)
    .setTitle(`Promotion Recorded - ${rangerLabel(ranger, history.new_rank)}`)
    .setDescription(`Advanced from **${previousRank}** to **${history.new_rank}**.`)
    .addFields({ name: "Reason", value: history.reason?.trim().slice(0, 1024) || "No reason recorded." })
    .setTimestamp(new Date(history.created_at));
}

function rangerLabel(ranger: RangerRow, rank: RangerRow["current_rank"]): string {
  const name = ranger.discord_display_name ?? ranger.in_game_name ?? ranger.discord_username ?? "Unknown Ranger";
  switch (rank) {
    case "Ranger Commander":
      return `Commander ${name}`;
    case "Ranger Captain":
      return `Captain ${name}`;
    case "Ranger Marshal":
      return `Marshal ${name}`;
    default:
      return `${rank} ${name}`;
  }
}
