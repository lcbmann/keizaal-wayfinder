import { PermissionFlagsBits, type Guild, type GuildMember, type Role } from "discord.js";
import { HOLDS, isHold, type Hold } from "../config/holds.js";
import type { RangerRow } from "../db/supabase.js";
import { UserFacingError } from "../utils/errors.js";

const HOLD_ROLE_PREFIX = "Hold: ";

export async function setMemberHoldRole(member: GuildMember, hold: string): Promise<Role> {
  if (!isHold(hold)) {
    throw new UserFacingError(`Unknown hold: ${hold}`);
  }

  const role = await ensureHoldRole(member.guild, hold);
  const staleHoldRoleIds = member.roles.cache
    .filter((memberRole) => isManagedHoldRole(memberRole) && memberRole.id !== role.id)
    .map((memberRole) => memberRole.id);

  if (staleHoldRoleIds.length > 0) {
    await member.roles.remove(staleHoldRoleIds, `Sync assigned hold to ${hold}`);
  }

  if (!member.roles.cache.has(role.id)) {
    await member.roles.add(role, `Sync assigned hold to ${hold}`);
  }

  return role;
}

export async function syncAssignedHoldRoles(guild: Guild, rangers: RangerRow[]): Promise<{ synced: number; skipped: number }> {
  let synced = 0;
  let skipped = 0;

  for (const ranger of rangers) {
    if (!ranger.assigned_hold || !isHold(ranger.assigned_hold)) {
      skipped += 1;
      continue;
    }

    try {
      const member = await guild.members.fetch(ranger.discord_user_id);
      await setMemberHoldRole(member, ranger.assigned_hold);
      synced += 1;
    } catch (error) {
      skipped += 1;
      console.warn(`Could not sync hold role for ${ranger.discord_user_id}:`, error);
    }
  }

  return { synced, skipped };
}

async function ensureHoldRole(guild: Guild, hold: Hold): Promise<Role> {
  const roleName = holdRoleName(hold);
  const existing = guild.roles.cache.find((role) => role.name === roleName);
  if (existing) {
    return existing;
  }

  const botMember = await guild.members.fetchMe();
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new UserFacingError("I need Manage Roles permission to create assigned hold roles.");
  }

  return guild.roles.create({
    name: roleName,
    mentionable: false,
    reason: "Create Ranger assigned hold role"
  });
}

function holdRoleName(hold: Hold): string {
  return `${HOLD_ROLE_PREFIX}${hold}`;
}

function isManagedHoldRole(role: Role): boolean {
  const hold = role.name.slice(HOLD_ROLE_PREFIX.length);
  return role.name.startsWith(HOLD_ROLE_PREFIX) && isHold(hold);
}
