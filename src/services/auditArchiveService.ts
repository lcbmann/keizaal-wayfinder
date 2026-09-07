import type { Attachment, GuildMember } from "discord.js";
import { assertNoDbError, supabase, type StrongboxSubmissionRow } from "../db/supabase.js";

export interface StrongboxArchiveInput {
  member: GuildMember;
  sourceKey: string;
  sourceChannelId?: string | null;
  sourceMessageId?: string | null;
  destination: "agents" | "marshals";
  title: string;
  content: string;
  references?: string | null;
  attachments?: Attachment[];
}

export function strongboxArchiveRecord(input: StrongboxArchiveInput, rangerId: string | null) {
  return {
    guild_id: input.member.guild.id, source_key: input.sourceKey,
    submitter_ranger_id: rangerId, submitter_discord_user_id: input.member.id,
    submitter_display_name: input.member.displayName,
    submission_type: input.destination === "agents" ? "agent_report" : "marshal_drop",
    title: input.title, content: input.content, reference_text: input.references ?? null,
    attachment_urls: (input.attachments ?? []).map((a) => a.url),
    attachment_metadata: (input.attachments ?? []).map((a) => ({ id: a.id, name: a.name, url: a.url, content_type: a.contentType, size: a.size })),
    source_channel_id: input.sourceChannelId ?? null, source_message_id: input.sourceMessageId ?? null,
    confidentiality: input.destination === "agents" ? "agents" : "marshal_plus",
    ic_or_ooc: input.destination === "agents" ? "ic" : "unspecified"
  };
}

// Archive before Discord delivery; retries must never overwrite the original evidence.
export async function beginStrongboxArchive(input: StrongboxArchiveInput): Promise<StrongboxSubmissionRow> {
  const ranger = await supabase.from("rangers").select("id").eq("discord_user_id", input.member.id).maybeSingle();
  assertNoDbError(ranger.error, "identify Strongbox submitter");
  const result = await supabase.from("strongbox_submissions").upsert(strongboxArchiveRecord(input, ranger.data?.id ?? null), {
    onConflict: "guild_id,source_key", ignoreDuplicates: true
  });
  assertNoDbError(result.error, "archive Strongbox submission before delivery");
  const saved = await supabase.from("strongbox_submissions").select("*").eq("guild_id", input.member.guild.id).eq("source_key", input.sourceKey).single();
  assertNoDbError(saved.error, "load archived Strongbox submission");
  return saved.data;
}

export async function checkpointStrongboxArchive(id: string, patch: {
  discord_channel_id: string; discord_message_id: string; discord_thread_id?: string | null; status?: "posted";
}): Promise<void> {
  const result = await supabase.from("strongbox_submissions").update(patch).eq("id", id);
  assertNoDbError(result.error, "save Strongbox Discord delivery checkpoint");
}
