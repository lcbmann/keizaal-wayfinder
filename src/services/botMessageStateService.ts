import { ChannelType, type Guild, type GuildBasedChannel, type NewsChannel, type TextChannel } from "discord.js";
import { assertNoDbError, supabase, type BotMessageStateRow } from "../db/supabase.js";

export async function getBotMessageState(stateKey: string): Promise<BotMessageStateRow | null> {
  const { data, error } = await supabase
    .from("bot_message_state")
    .select("*")
    .eq("state_key", stateKey)
    .maybeSingle();

  assertNoDbError(error, "get bot message state");
  return data;
}

export async function saveBotMessageState(stateKey: string, channelId: string, messageIds: string[]): Promise<void> {
  const { error } = await supabase.from("bot_message_state").upsert({
    state_key: stateKey,
    discord_channel_id: channelId,
    discord_message_ids: messageIds,
    updated_at: new Date().toISOString()
  });

  assertNoDbError(error, "save bot message state");
}

export async function deleteStoredMessages(guild: Guild, stateKey: string): Promise<void> {
  const state = await getBotMessageState(stateKey);
  if (!state) {
    return;
  }

  const channel = await guild.channels.fetch(state.discord_channel_id).catch(() => null);
  if (!isStoredMessageChannel(channel)) {
    return;
  }

  for (const messageId of state.discord_message_ids) {
    try {
      const message = await channel.messages.fetch(messageId);
      await message.delete();
    } catch (error) {
      console.warn(`Could not delete stored message ${messageId} for ${stateKey}:`, error);
    }
  }
}

export async function getStoredTextChannel(guild: Guild, stateKey: string): Promise<TextChannel | null> {
  const state = await getBotMessageState(stateKey);
  if (!state) {
    return null;
  }

  const channel = await guild.channels.fetch(state.discord_channel_id).catch(() => null);
  return channel?.type === ChannelType.GuildText ? channel : null;
}

function isStoredMessageChannel(channel: GuildBasedChannel | null): channel is TextChannel | NewsChannel {
  return channel?.type === ChannelType.GuildText || channel?.type === ChannelType.GuildAnnouncement;
}
