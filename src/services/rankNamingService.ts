import type { Guild } from "discord.js";
import { roleIdForRank } from "../config/roles.js";

const rankNames = ["First Captain", "Captain", "Marshal"] as const;
const emojiRenames = [
  ["rangercommander", "firstcaptain"],
  ["rangercaptain", "captain"],
  ["rangermarshal", "marshal"]
] as const;

export async function synchronizeRankNames(guild: Guild): Promise<void> {
  await guild.roles.fetch();
  await guild.emojis.fetch();
  for (const name of rankNames) {
    const role = guild.roles.cache.get(roleIdForRank(name));
    if (role && role.name !== name) {
      await role.setName(name, "Corps rank naming update");
    }
  }
  for (const [oldName, name] of emojiRenames) {
    const emoji = guild.emojis.cache.find((candidate) => candidate.name === oldName);
    if (emoji && !guild.emojis.cache.some((candidate) => candidate.name === name)) {
      await emoji.setName(name, "Corps rank naming update");
    }
  }
}
