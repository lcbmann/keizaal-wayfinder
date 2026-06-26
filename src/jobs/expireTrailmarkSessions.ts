import type { Client } from "discord.js";
import { env } from "../config/env.js";
import { expireTrailmarkSessions } from "../services/trailmarkService.js";

export async function runTrailmarkSessionCleanup(client: Client): Promise<void> {
  const guild = await client.guilds.fetch(env.DISCORD_GUILD_ID);
  await expireTrailmarkSessions(guild);
}

export function startTrailmarkSessionExpirationJob(client: Client): NodeJS.Timeout {
  void runTrailmarkSessionCleanup(client).catch((error) => {
    console.error("Initial Trailmark cleanup failed:", error);
  });

  return setInterval(() => {
    void runTrailmarkSessionCleanup(client).catch((error) => {
      console.error("Trailmark cleanup failed:", error);
    });
  }, 60_000);
}
