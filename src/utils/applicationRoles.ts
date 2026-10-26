import { PermissionsBitField, type Role } from "discord.js";
import { env } from "../config/env.js";
import { MAIN_RANKS } from "../config/ranks.js";
import { mainRankRoleIds } from "../config/roles.js";
import { UserFacingError } from "./errors.js";

export function assertSafeApplicationRole(role: Role): void {
  const forbidden = [PermissionsBitField.Flags.Administrator, PermissionsBitField.Flags.ManageRoles,
    PermissionsBitField.Flags.ManageGuild, PermissionsBitField.Flags.ManageChannels,
    PermissionsBitField.Flags.ManageWebhooks, PermissionsBitField.Flags.KickMembers,
    PermissionsBitField.Flags.BanMembers, PermissionsBitField.Flags.ModerateMembers];
  if (role.id === role.guild.id || role.managed || mainRankRoleIds().includes(role.id) || role.id === env.ROLE_SENIOR_RANGER_ID
    || ["Retired Ranger", "Senior Ranger"].some((name) => name.toLowerCase() === role.name.toLowerCase())
    || MAIN_RANKS.some((rank) => rank.toLowerCase() === role.name.toLowerCase())
    || forbidden.some((permission) => role.permissions.has(permission))) {
    throw new UserFacingError("Choose a regular duty role, not a rank, managed role, or moderation role.");
  }
  if (!role.editable) throw new UserFacingError("Place the duty role below Wayfinder and give Wayfinder Manage Roles.");
}


