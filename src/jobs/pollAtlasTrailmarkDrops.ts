import type { Client } from "discord.js";
import { env } from "../config/env.js";
import {
  claimPendingAtlasTrailmarkDrops,
  processAtlasTrailmarkDrop
} from "../services/atlasTrailmarkDropService.js";

const POLL_INTERVAL_MS = 5_000;

export function startAtlasTrailmarkDropPollingJob(client: Client): NodeJS.Timeout {
  let running = false;

  const poll = async (): Promise<void> => {
    if (running) {
      return;
    }
    running = true;
    try {
      const guild = await client.guilds.fetch(env.DISCORD_GUILD_ID);
      const drops = await claimPendingAtlasTrailmarkDrops(10);
      for (const drop of drops) {
        const result = await processAtlasTrailmarkDrop(guild, drop);
        if (result.status === "failed") {
          console.warn(`Atlas Trailmark drop ${drop.id} failed: ${result.errorMessage}`);
        }
      }
    } catch (error) {
      console.error("Atlas Trailmark drop polling failed:", error);
    } finally {
      running = false;
    }
  };

  void poll();
  return setInterval(() => {
    void poll();
  }, POLL_INTERVAL_MS);
}
