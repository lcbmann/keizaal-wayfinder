import type { Client } from "discord.js";
import { env } from "../config/env.js";
import { resolveDueFieldNameProposals } from "../services/fieldNameService.js";

export async function runFieldNameResolution(client: Client): Promise<void> {
  const guild = await client.guilds.fetch(env.DISCORD_GUILD_ID);
  await resolveDueFieldNameProposals(guild);
}

export function startFieldNameResolutionJob(client: Client): NodeJS.Timeout {
  void runFieldNameResolution(client).catch((error) => {
    console.error("Initial Field Name resolution failed:", error);
  });

  return setInterval(() => {
    void runFieldNameResolution(client).catch((error) => {
      console.error("Field Name resolution failed:", error);
    });
  }, 60_000);
}
