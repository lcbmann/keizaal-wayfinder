import type { GuildMember, PartialGuildMember } from "discord.js";
import { dmNewApprentice, retireDepartedRanger, syncMemberToRoster } from "../services/rangerService.js";

export async function handleMemberJoin(member: GuildMember): Promise<void> {
  await dmNewApprentice(member);
  await syncMemberToRoster(member);
}

export async function handleMemberUpdate(oldMember: GuildMember | PartialGuildMember, newMember: GuildMember): Promise<void> {
  void oldMember;
  await dmNewApprentice(newMember);
  await syncMemberToRoster(newMember);
}

export async function handleMemberRemove(member: GuildMember | PartialGuildMember): Promise<boolean> {
  const retired = await retireDepartedRanger(member.id);
  return Boolean(retired);
}
