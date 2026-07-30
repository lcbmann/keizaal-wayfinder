import { ChannelType, EmbedBuilder, type Guild } from "discord.js";
import { assertNoDbError, supabase, type Json } from "../db/supabase.js";
import { canUseTrailmarks } from "../utils/permissions.js";
import { getActiveTrailmarkByAtlasLocationId } from "./trailmarkService.js";

export interface AtlasTrailmarkDrop {
  id: string;
  discord_user_id: string;
  ranger_name: string;
  atlas_location_id: string;
  message: string;
  requested_at: string;
}

export async function claimPendingAtlasTrailmarkDrops(requestLimit = 10): Promise<AtlasTrailmarkDrop[]> {
  const { data, error } = await supabase.rpc("claim_pending_atlas_trailmark_drops", {
    request_limit: requestLimit
  });
  assertNoDbError(error, "claim pending Atlas Trailmark drops");
  return parseDrops(data);
}

export async function processAtlasTrailmarkDrop(
  guild: Guild,
  drop: AtlasTrailmarkDrop
): Promise<{ status: "posted" | "failed"; errorMessage?: string }> {
  try {
    const trailmark = await getActiveTrailmarkByAtlasLocationId(drop.atlas_location_id);
    if (!trailmark) {
      throw new TrailmarkDropFailure("No active Trailmark is linked to this Atlas location.");
    }

    const member = await guild.members.fetch(drop.discord_user_id).catch(() => null);
    if (!member) {
      throw new TrailmarkDropFailure("The linked Discord member could not be found.");
    }
    if (!canUseTrailmarks(member)) {
      throw new TrailmarkDropFailure("The linked Discord member cannot use Trailmarks.");
    }

    const channel = await guild.channels.fetch(trailmark.discord_channel_id).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) {
      throw new TrailmarkDropFailure("The Trailmark channel could not be found.");
    }

    const embed = new EmbedBuilder()
      .setColor(0x2f6847)
      .setAuthor({
        name: member.displayName,
        iconURL: member.displayAvatarURL()
      })
      .setTitle(`${trailmark.name} Field Drop`)
      .setDescription(drop.message)
      .setFooter({ text: "Submitted through the Ranger Atlas" })
      .setTimestamp(new Date(drop.requested_at));
    const posted = await channel.send({
      embeds: [embed],
      allowedMentions: { parse: [] }
    });

    await completeDrop({
      id: drop.id,
      status: "posted",
      channelId: channel.id,
      messageId: posted.id,
      errorMessage: null
    });
    return { status: "posted" };
  } catch (error) {
    const errorMessage = error instanceof TrailmarkDropFailure
      ? error.message
      : "Wayfinder could not post this Trailmark drop.";
    if (!(error instanceof TrailmarkDropFailure)) {
      console.error(`Failed to process Atlas Trailmark drop ${drop.id}:`, error);
    }
    try {
      await completeDrop({
        id: drop.id,
        status: "failed",
        channelId: null,
        messageId: null,
        errorMessage
      });
    } catch (completionError) {
      console.error(`Could not complete failed Atlas Trailmark drop ${drop.id}:`, completionError);
    }
    return { status: "failed", errorMessage };
  }
}

async function completeDrop(params: {
  id: string;
  status: "posted" | "failed";
  channelId: string | null;
  messageId: string | null;
  errorMessage: string | null;
}): Promise<void> {
  const { data, error } = await supabase.rpc("complete_atlas_trailmark_drop", {
    drop_id_input: params.id,
    drop_status_input: params.status,
    discord_channel_id_input: params.channelId,
    discord_message_id_input: params.messageId,
    error_message_input: params.errorMessage
  });
  assertNoDbError(error, "complete Atlas Trailmark drop");
  if (data !== true) {
    throw new Error(`Atlas Trailmark drop ${params.id} completion returned false.`);
  }
}

function parseDrops(value: Json | null): AtlasTrailmarkDrop[] {
  if (!Array.isArray(value)) {
    throw new Error("Atlas returned an invalid Trailmark drop queue.");
  }
  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`Atlas returned an invalid Trailmark drop at index ${index}.`);
    }
    const drop = {
      id: stringValue(item.id),
      discord_user_id: stringValue(item.discord_user_id),
      ranger_name: stringValue(item.ranger_name),
      atlas_location_id: stringValue(item.atlas_location_id),
      message: stringValue(item.message),
      requested_at: stringValue(item.requested_at)
    };
    if (!drop.id || !drop.discord_user_id || !drop.atlas_location_id || !drop.message || !drop.requested_at) {
      throw new Error(`Atlas returned an incomplete Trailmark drop at index ${index}.`);
    }
    return drop;
  });
}

function isRecord(value: Json): value is { [key: string]: Json | undefined } {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: Json | undefined): string {
  return typeof value === "string" ? value : "";
}

class TrailmarkDropFailure extends Error {}
