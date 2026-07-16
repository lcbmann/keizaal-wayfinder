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
import { allianceCommand } from "./commands/alliance.js";
import { supplyCommand } from "./commands/supply.js";
import { dutyCommand } from "./commands/duty.js";
import { apprenticeshipCommand } from "./commands/apprenticeship.js";

const corpsCommands = [
  pingCommand,
  rangerCommand,
  promotionCommand,
  trailmarkCommand,
  rosterCommand,
  recruitCommand,
  fundsCommand,
  intelCommand,
  strongboxCommand,
  supplyCommand,
  dutyCommand,
  apprenticeshipCommand
].map((command) => command.data.toJSON());

const allianceCommands = [pingCommand, allianceCommand].map((command) => command.data.toJSON());

const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);

await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID), { body: corpsCommands });

if (env.RANGER_ALLIANCE_GUILD_ID) {
  try {
    await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.RANGER_ALLIANCE_GUILD_ID), {
      body: allianceCommands
    });
  } catch (error) {
    console.warn("Could not register Ranger Alliance commands yet. Invite Wayfinder, then run deploy-commands again.", error);
  }
}

console.log(
  `Registered ${corpsCommands.length} Corps commands${
    env.RANGER_ALLIANCE_GUILD_ID ? ` and ${allianceCommands.length} Ranger Alliance commands` : ""
  }.`
);
