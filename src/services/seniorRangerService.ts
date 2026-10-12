import type { Guild, GuildMember } from "discord.js";
import { env } from "../config/env.js";
import { rankAtLeast } from "../config/ranks.js";
import { assertNoDbError, supabase, type RangerRow } from "../db/supabase.js";
import { memberRankAtLeast } from "../utils/permissions.js";
import { earnedLongWatchSlugs } from "./longWatchMedalService.js";

export function eligibleForSeniorRanger(
  ranger: Pick<RangerRow, "current_rank" | "status" | "joined_at" | "join_date">,
  asOf = new Date()
): boolean {
  return (ranger.status === "Active" || ranger.status === "On Leave")
    && rankAtLeast(ranger.current_rank, "Ranger")
    && earnedLongWatchSlugs(ranger.joined_at ?? `${ranger.join_date}T00:00:00.000Z`, asOf)
      .includes("long-watch-silver");
}

export async function synchronizeSeniorRangerRole(member: GuildMember, ranger: RangerRow): Promise<boolean> {
  if (member.user.bot || !eligibleForSeniorRanger(ranger) || !memberRankAtLeast(member, "Ranger")
    || member.roles.cache.has(env.ROLE_SENIOR_RANGER_ID)) {
    return false;
  }
  await member.roles.add(env.ROLE_SENIOR_RANGER_ID, "Automatic Senior Ranger recognition after 90 days in the Corps");
  return true;
}

export async function synchronizeSeniorRangers(guild: Guild): Promise<number> {
  const { data: rangers, error } = await supabase.from("rangers").select("*")
    .in("status", ["Active", "On Leave"]);
  assertNoDbError(error, "load Rangers for automatic Senior Ranger recognition");
  const eligible = (rangers ?? []).filter((ranger) => eligibleForSeniorRanger(ranger));
  if (!eligible.length) {
    return 0;
  }
  const role = await guild.roles.fetch(env.ROLE_SENIOR_RANGER_ID);
  if (!role?.editable) {
    throw new Error("Wayfinder needs Manage Roles and a role above Senior Ranger to grant automatic recognition.");
  }
  let granted = 0;
  for (const ranger of eligible) {
    try {
      const member = await guild.members.fetch({ user: ranger.discord_user_id, force: true });
      if (await synchronizeSeniorRangerRole(member, ranger)) {
        granted += 1;
      }
    } catch (memberError) {
      if (typeof memberError === "object" && memberError !== null && "code" in memberError && memberError.code === 10007) {
        continue;
      }
      console.warn(`Could not grant Senior Ranger to ${ranger.discord_user_id}:`, memberError);
    }
  }
  return granted;
}

export function startSeniorRangerJob(guild: Guild): NodeJS.Timeout {
  let running = false;
  const synchronize = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      const granted = await synchronizeSeniorRangers(guild);
      if (granted > 0) {
        console.log(`Granted Senior Ranger recognition to ${granted} eligible members.`);
      }
    } catch (error) {
      console.warn("Failed to synchronize Senior Ranger recognition:", error);
    } finally {
      running = false;
    }
  };
  void synchronize();
  const timer = setInterval(() => void synchronize(), 24 * 60 * 60 * 1000);
  timer.unref();
  return timer;
}
