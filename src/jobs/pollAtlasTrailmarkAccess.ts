import type { Client } from "discord.js";
import { env } from "../config/env.js";
import {
  claimPendingAtlasTrailmarkAccessRequests,
  processAtlasTrailmarkAccessRequest
} from "../services/atlasTrailmarkAccessService.js";

const POLL_INTERVAL_MS = 5_000;

export function startAtlasTrailmarkAccessPollingJob(client: Client): NodeJS.Timeout {
  let running = false;

  const poll = async (): Promise<void> => {
    if (running) {
      return;
    }

    running = true;
    try {
      const guild = await client.guilds.fetch(env.DISCORD_GUILD_ID);
      const requests = await claimPendingAtlasTrailmarkAccessRequests(10);
      for (const request of requests) {
        const result = await processAtlasTrailmarkAccessRequest(guild, request);
        if (result.status === "failed") {
          console.warn(`Atlas Trailmark access request ${request.id} failed: ${result.errorMessage}`);
        }
      }
    } catch (error) {
      console.error("Atlas Trailmark access polling failed:", error);
    } finally {
      running = false;
    }
  };

  void poll();
  return setInterval(() => {
    void poll();
  }, POLL_INTERVAL_MS);
}
