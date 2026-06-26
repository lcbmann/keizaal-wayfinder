import { ChannelType, EmbedBuilder, type Guild, type TextChannel } from "discord.js";
import { env } from "../config/env.js";
import {
  assertNoDbError,
  supabase,
  type CorpsFundTransactionRow,
  type CorpsFundTransactionType
} from "../db/supabase.js";
import { UserFacingError } from "../utils/errors.js";

interface CreateFundTransactionParams {
  guild: Guild;
  transactionType: CorpsFundTransactionType;
  amount: number;
  description: string;
  recordedByDiscordUserId: string;
  memberDiscordUserId?: string | null;
}

export async function recordFundTransaction(params: CreateFundTransactionParams): Promise<CorpsFundTransactionRow> {
  const channel = await requireFundsChannel(params.guild);
  const signedAmount = signedAmountForType(params.transactionType, params.amount);
  const { data, error } = await supabase
    .from("corps_fund_transactions")
    .insert({
      transaction_type: params.transactionType,
      amount: signedAmount,
      description: params.description,
      member_discord_user_id: params.memberDiscordUserId ?? null,
      recorded_by_discord_user_id: params.recordedByDiscordUserId,
      discord_channel_id: null,
      discord_message_id: null
    })
    .select("*")
    .single();

  assertNoDbError(error, "record corps fund transaction");

  const message = await channel.send({ embeds: [transactionEmbed(data)] });
  const { data: updated, error: updateError } = await supabase
    .from("corps_fund_transactions")
    .update({ discord_channel_id: channel.id, discord_message_id: message.id })
    .eq("id", data.id)
    .select("*")
    .single();

  assertNoDbError(updateError, "attach corps fund message");
  await refreshFundSummary(channel);
  return updated;
}

export async function setFundBalance(params: {
  guild: Guild;
  targetBalance: number;
  description: string;
  recordedByDiscordUserId: string;
}): Promise<CorpsFundTransactionRow | null> {
  const currentBalance = await getFundBalance();
  const delta = params.targetBalance - currentBalance.balance;
  if (delta === 0) {
    await refreshFundSummary(await requireFundsChannel(params.guild));
    return null;
  }

  return recordFundTransaction({
    guild: params.guild,
    transactionType: "Adjustment",
    amount: delta,
    description: params.description,
    recordedByDiscordUserId: params.recordedByDiscordUserId
  });
}

export async function refreshFundSummaryForGuild(guild: Guild): Promise<void> {
  await refreshFundSummary(await requireFundsChannel(guild));
}

async function refreshFundSummary(channel: TextChannel): Promise<void> {
  const state = await getSummaryState();
  if (state?.discord_message_id) {
    try {
      const previousChannel = state.discord_channel_id
        ? await channel.guild.channels.fetch(state.discord_channel_id)
        : channel;
      if (previousChannel?.type === ChannelType.GuildText) {
        const previousMessage = await previousChannel.messages.fetch(state.discord_message_id);
        await previousMessage.delete();
      }
    } catch (error) {
      console.warn("Could not delete previous corps fund summary:", error);
    }
  }

  const message = await channel.send({ embeds: [await summaryEmbed()] });
  const { error } = await supabase
    .from("corps_fund_summary_state")
    .upsert({ id: true, discord_channel_id: channel.id, discord_message_id: message.id, updated_at: new Date().toISOString() });

  assertNoDbError(error, "update corps fund summary state");
}

async function getSummaryState(): Promise<{ discord_channel_id: string | null; discord_message_id: string | null } | null> {
  const { data, error } = await supabase
    .from("corps_fund_summary_state")
    .select("discord_channel_id, discord_message_id")
    .eq("id", true)
    .maybeSingle();

  assertNoDbError(error, "get corps fund summary state");
  return data;
}

async function getFundBalance(): Promise<{
  balance: number;
  donations: number;
  expenses: number;
  adjustments: number;
  count: number;
}> {
  const { data, error } = await supabase.from("corps_fund_transactions").select("transaction_type, amount");
  assertNoDbError(error, "get corps fund balance");

  const rows = data ?? [];
  return {
    balance: rows.reduce((total, row) => total + row.amount, 0),
    donations: rows.filter((row) => row.transaction_type === "Donation").reduce((total, row) => total + row.amount, 0),
    expenses: Math.abs(rows.filter((row) => row.transaction_type === "Expense").reduce((total, row) => total + row.amount, 0)),
    adjustments: rows.filter((row) => row.transaction_type === "Adjustment").reduce((total, row) => total + row.amount, 0),
    count: rows.length
  };
}

async function getRecentTransactions(limit = 5): Promise<CorpsFundTransactionRow[]> {
  const { data, error } = await supabase
    .from("corps_fund_transactions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  assertNoDbError(error, "get recent corps fund transactions");
  return data ?? [];
}

async function summaryEmbed(): Promise<EmbedBuilder> {
  const balance = await getFundBalance();
  const recent = await getRecentTransactions();
  const embed = new EmbedBuilder()
    .setTitle("Corps Fund")
    .setDescription(`Current total: **${formatSeptims(balance.balance)}**`)
    .addFields(
      { name: "Donations", value: formatSeptims(balance.donations), inline: true },
      { name: "Expenses", value: formatSeptims(balance.expenses), inline: true },
      { name: "Adjustments", value: formatSignedSeptims(balance.adjustments), inline: true },
      { name: "Transactions", value: String(balance.count), inline: true }
    )
    .setColor(0xd5a84f)
    .setTimestamp(new Date());

  if (recent.length > 0) {
    embed.addFields({
      name: "Recent Activity",
      value: recent.map(formatRecentTransaction).join("\n").slice(0, 1024)
    });
  }

  return embed;
}

function transactionEmbed(transaction: CorpsFundTransactionRow): EmbedBuilder {
  const member = transaction.member_discord_user_id ? `<@${transaction.member_discord_user_id}>` : null;
  const embed = new EmbedBuilder()
    .setTitle(transaction.transaction_type)
    .setDescription(transaction.description)
    .addFields(
      { name: "Amount", value: formatSignedSeptims(transaction.amount), inline: true },
      { name: "Recorded by", value: `<@${transaction.recorded_by_discord_user_id}>`, inline: true }
    )
    .setColor(transaction.amount >= 0 ? 0x587c4a : 0xa64d3f)
    .setTimestamp(new Date(transaction.created_at));

  if (member) {
    embed.addFields({ name: transaction.transaction_type === "Expense" ? "Paid to" : "Member", value: member, inline: true });
  }

  return embed;
}

function formatRecentTransaction(transaction: CorpsFundTransactionRow): string {
  const member = transaction.member_discord_user_id ? ` - <@${transaction.member_discord_user_id}>` : "";
  return `${formatSignedSeptims(transaction.amount)} - ${transaction.transaction_type}${member} - ${transaction.description}`;
}

async function requireFundsChannel(guild: Guild): Promise<TextChannel> {
  if (!env.CORPS_FUNDS_CHANNEL_ID) {
    throw new UserFacingError("CORPS_FUNDS_CHANNEL_ID is not configured.");
  }

  const channel = await guild.channels.fetch(env.CORPS_FUNDS_CHANNEL_ID);
  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new UserFacingError("CORPS_FUNDS_CHANNEL_ID must point to a text channel.");
  }

  return channel;
}

function signedAmountForType(transactionType: CorpsFundTransactionType, amount: number): number {
  if (transactionType === "Expense") {
    return -Math.abs(amount);
  }

  if (transactionType === "Donation") {
    return Math.abs(amount);
  }

  return amount;
}

function formatSeptims(amount: number): string {
  return `${amount.toLocaleString("en-US")} Septims`;
}

function formatSignedSeptims(amount: number): string {
  if (amount > 0) {
    return `+${formatSeptims(amount)}`;
  }

  if (amount < 0) {
    return `-${formatSeptims(Math.abs(amount))}`;
  }

  return formatSeptims(0);
}
