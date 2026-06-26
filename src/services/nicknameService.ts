import type { GuildMember } from "discord.js";
import { syncMemberToRoster } from "./rangerService.js";

export async function refreshMemberIdentity(member: GuildMember, actorId?: string): Promise<void> {
  await syncMemberToRoster(member, actorId);
}

// TODO: Add opt-in nickname enforcement once the Corps has settled the policy.
