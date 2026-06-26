import type { GuildMember, PartialGuildMember } from "discord.js";
import { dmNewApprentice, syncMemberToRoster } from "../services/rangerService.js";

export async function handleMemberJoin(member: GuildMember): Promise<void> {
  await dmNewApprentice(member);
  await syncMemberToRoster(member);
}

export async function handleMemberUpdate(oldMember: GuildMember | PartialGuildMember, newMember: GuildMember): Promise<void> {
  void oldMember;
  await dmNewApprentice(newMember);
  await syncMemberToRoster(newMember);
}
