import type { GuildMember, PartialGuildMember } from "discord.js";
import { endActiveDutyAssignmentsForRanger } from "../services/dutyService.js";
import { deactivateAtlasRangerAccess, syncAtlasDiscordProfile } from "../services/atlasDiscordProfileService.js";
import { dmNewApprentice, retireDepartedRanger, syncMemberToRoster } from "../services/rangerService.js";
import { reconcileRunecloakMemberRoles } from "../services/runecloakDiscordService.js";

export async function handleMemberJoin(member: GuildMember): Promise<void> {
  await dmNewApprentice(member);
  await syncMemberToRoster(member);
}

export async function handleMemberUpdate(oldMember: GuildMember | PartialGuildMember, newMember: GuildMember): Promise<void> {
  void oldMember;
  await dmNewApprentice(newMember);
  await syncMemberToRoster(newMember);
  await reconcileRunecloakMemberRoles(newMember).catch((error) => {
    console.warn(`Could not refresh Runecloak roles for ${newMember.id}:`, error);
  });
  await syncAtlasDiscordProfile(newMember).catch((error) => {
    console.warn(`Could not refresh Atlas profile for ${newMember.id}:`, error);
  });
}

export async function handleMemberRemove(member: GuildMember | PartialGuildMember): Promise<boolean> {
  await deactivateAtlasRangerAccess({
    discordUserId: member.id,
    displayName: member.displayName
  }).catch((error) => {
    console.warn(`Could not deactivate Atlas access for departed member ${member.id}:`, error);
  });
  const retired = await retireDepartedRanger(member.id);
  if (retired) {
    await endActiveDutyAssignmentsForRanger({
      guild: member.guild,
      rangerDiscordUserId: member.id,
      endedByDiscordUserId: "system",
      reason: "Ranger left the Discord and was retired"
    });
  }
  return Boolean(retired);
}
