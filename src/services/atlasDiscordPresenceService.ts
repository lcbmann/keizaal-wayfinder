import type { Guild, GuildMember } from "discord.js";
import { env } from "../config/env.js";
import { assertNoDbError, supabase } from "../db/supabase.js";
import { mainRankFromMember } from "../utils/permissions.js";

const PRESENCE_SYNC_INTERVAL_MS = 30_000;

function isOnline(member: GuildMember): boolean {
  return Boolean(member.presence?.status && member.presence.status !== "offline");
}

function isPlayingSkyrim(member: GuildMember): boolean {
  return member.presence?.activities.some((activity) => /\b(skyrim|keizaal)\b/i.test(activity.name)) ?? false;
}

async function publishAtlasDiscordPresence(guild: Guild): Promise<void> {
  const rangers = guild.members.cache.filter(
    (member) => !member.user.bot && mainRankFromMember(member) !== null
  );
  const onlineCount = rangers.filter(isOnline).size;
  const playingSkyrimCount = rangers.filter(
    (member) => isOnline(member) && isPlayingSkyrim(member)
  ).size;

  const { error } = await supabase.rpc("set_atlas_discord_presence_summary", {
    online_count_input: onlineCount,
    playing_skyrim_count_input: playingSkyrimCount
  });
  assertNoDbError(error, "publish Atlas Discord presence summary");
}

export function startAtlasDiscordPresenceJob(guild: Guild): void {
  if (!env.ATLAS_DISCORD_PRESENCE_ENABLED) {
    console.log("Atlas Discord presence summary is disabled.");
    return;
  }

  let syncInFlight = false;
  const synchronize = async (): Promise<void> => {
    if (syncInFlight) {
      return;
    }
    syncInFlight = true;
    try {
      await publishAtlasDiscordPresence(guild);
    } catch (error) {
      console.warn("Failed to publish Atlas Discord presence summary:", error);
    } finally {
      syncInFlight = false;
    }
  };

  void guild.members.fetch({ withPresences: true })
    .then(() => synchronize())
    .catch((error) => console.warn("Failed to fetch Ranger Discord presences:", error));

  const timer = setInterval(() => void synchronize(), PRESENCE_SYNC_INTERVAL_MS);
  timer.unref();
}
