import { REST, Routes } from "discord.js";
import { env } from "./config/env.js";
import { pingCommand } from "./commands/ping.js";
import { rangerCommand } from "./commands/ranger.js";
import { promotionCommand } from "./commands/promotion.js";
import { trailmarkCommand } from "./commands/trailmark.js";
import { rosterCommand } from "./commands/roster.js";
import { recruitCommand } from "./commands/recruit.js";
import { fundsCommand } from "./commands/funds.js";
import { intelCommand } from "./commands/intel.js";
import { strongboxCommand } from "./commands/strongbox.js";

const commands = [
  pingCommand,
  rangerCommand,
  promotionCommand,
  trailmarkCommand,
  rosterCommand,
  recruitCommand,
  fundsCommand,
  intelCommand,
  strongboxCommand
].map((command) => command.data.toJSON());

const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);

await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID), { body: commands });

console.log(`Registered ${commands.length} guild slash commands.`);
