import { PermissionFlagsBits, type GuildMember } from "discord.js";
import { env } from "../config/env.js";
import { isAllianceAdmin, isAllianceGuildId } from "../services/allianceIntelService.js";
import { canOpenPromotionVotes } from "./permissions.js";

export function canManageGeneralVotes(member: GuildMember, guildId: string, channelId: string): boolean {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) {
    return true;
  }
  const channel = member.guild.channels.cache.get(channelId);
  if (channel && member.permissionsIn(channel).has(PermissionFlagsBits.ManageMessages)) {
    return true;
  }
  if (guildId === env.DISCORD_GUILD_ID) {
    return canOpenPromotionVotes(member);
  }
  return isAllianceGuildId(guildId) && isAllianceAdmin(member);
}
