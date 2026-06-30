import { assertNoDbError, supabase } from "../db/supabase.js";

export interface MessageActivityResult {
  reactivated: boolean;
}

export async function recordBotInteraction(discordUserId: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("rangers")
    .update({ last_bot_interaction_at: now, updated_at: now })
    .eq("discord_user_id", discordUserId);

  assertNoDbError(error, "record bot interaction");
}

export async function recordMessageActivity(discordUserId: string, channelId: string): Promise<MessageActivityResult> {
  const now = new Date().toISOString();
  const { data: reactivatedRanger, error: reactivationError } = await supabase
    .from("rangers")
    .update({ status: "Active", last_discord_activity_at: now, updated_at: now })
    .eq("discord_user_id", discordUserId)
    .eq("status", "Inactive")
    .select("id")
    .maybeSingle();

  assertNoDbError(reactivationError, "reactivate inactive ranger from message activity");

  if (!reactivatedRanger) {
    const { error: updateError } = await supabase
      .from("rangers")
      .update({ last_discord_activity_at: now, updated_at: now })
      .eq("discord_user_id", discordUserId);

    assertNoDbError(updateError, "record message activity");
  }

  const { error: insertError } = await supabase
    .from("member_activity_events")
    .insert({ discord_user_id: discordUserId, event_type: "message", channel_id: channelId });

  assertNoDbError(insertError, "insert activity event");
  return { reactivated: Boolean(reactivatedRanger) };
}
