import type { Guild } from "discord.js";
import {
  assertNoDbError,
  supabase,
  type CorpsMedalRow,
  type RangerMedalAwardRow,
  type RangerRow
} from "../db/supabase.js";
import { removeMedalAwardFromHonorsLedger } from "./honorsLedgerService.js";
import { awardMedal, revokeMedal } from "./medalService.js";

const LONG_WATCH_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const LONG_WATCH_TIERS = [
  { slug: "long-watch-bronze", days: 30, reason: "Completed 30 days of Ranger Corps service." },
  { slug: "long-watch-silver", days: 90, reason: "Completed 90 days of Ranger Corps service." },
  { slug: "long-watch-gold", days: 180, reason: "Completed 180 days of Ranger Corps service." }
] as const;

export interface LongWatchSyncResult {
  awarded: number;
  revoked: number;
  rolesAdded: number;
  rolesRemoved: number;
}

export function earnedLongWatchSlugs(joinedAt: string, asOf = new Date()): string[] {
  const joinedAtMs = new Date(joinedAt).getTime();
  if (!Number.isFinite(joinedAtMs)) {
    return [];
  }
  const elapsedDays = (asOf.getTime() - joinedAtMs) / 86_400_000;
  return LONG_WATCH_TIERS.filter((tier) => elapsedDays >= tier.days).map((tier) => tier.slug);
}

export async function synchronizeLongWatchMedals(
  guild: Guild,
  notifyNewAwards = true
): Promise<LongWatchSyncResult> {
  const slugs = LONG_WATCH_TIERS.map((tier) => tier.slug);
  const [medalsResult, rangersResult] = await Promise.all([
    supabase.from("corps_medals").select("*").in("slug", slugs).eq("active", true),
    supabase.from("rangers").select("*")
  ]);
  assertNoDbError(medalsResult.error, "load Long Watch medals");
  assertNoDbError(rangersResult.error, "load Rangers for Long Watch synchronization");
  const medals = medalsResult.data ?? [];
  const rangers = rangersResult.data ?? [];
  if (medals.length !== LONG_WATCH_TIERS.length) {
    throw new Error("All three Long Watch medals must be configured before they can be synchronized.");
  }

  const medalBySlug = new Map(medals.map((medal) => [medal.slug, medal]));
  const medalSlugById = new Map(medals.map((medal) => [medal.id, medal.slug]));
  const { data: awards, error: awardsError } = await supabase
    .from("ranger_medal_awards")
    .select("*")
    .in("medal_id", medals.map((medal) => medal.id));
  assertNoDbError(awardsError, "load Long Watch awards");

  const awardsByRanger = new Map<string, Map<string, RangerMedalAwardRow>>();
  for (const award of awards ?? []) {
    const slug = medalSlugById.get(award.medal_id);
    if (slug) {
      const rangerAwards = awardsByRanger.get(award.ranger_id) ?? new Map<string, RangerMedalAwardRow>();
      rangerAwards.set(slug, award);
      awardsByRanger.set(award.ranger_id, rangerAwards);
    }
  }

  const result: LongWatchSyncResult = { awarded: 0, revoked: 0, rolesAdded: 0, rolesRemoved: 0 };
  await guild.members.fetch().catch((error) => {
    console.warn("Could not prefetch every member before synchronizing Long Watch roles:", error);
  });
  const now = new Date();
  for (const ranger of rangers) {
    const expected = new Set(earnedLongWatchSlugs(rangerJoinedAt(ranger), now));
    const existing = awardsByRanger.get(ranger.id) ?? new Map<string, RangerMedalAwardRow>();
    for (const tier of LONG_WATCH_TIERS) {
      const medal = medalBySlug.get(tier.slug)!;
      const award = existing.get(tier.slug);
      try {
        if (expected.has(tier.slug) && !award) {
          const awarded = await awardMedal({
            guild,
            rangerDiscordUserId: ranger.discord_user_id,
            medalId: medal.id,
            awardedByDiscordUserId: "system",
            reason: tier.reason,
            notifyRecipient: notifyNewAwards,
            recordInHonorsLedger: notifyNewAwards
          });
          if (awarded.newlyAwarded) {
            result.awarded += 1;
          }
        } else if (!expected.has(tier.slug) && award) {
          await removeMedalAwardFromHonorsLedger(guild, award.id);
          if (await revokeMedal({ guild, rangerDiscordUserId: ranger.discord_user_id, medalId: medal.id })) {
            result.revoked += 1;
          }
        }
      } catch (error) {
        console.warn(`Could not synchronize ${medal.name} for ${ranger.discord_user_id}:`, error);
      }
    }
    await synchronizeLongWatchRoles(guild, ranger, expected, medals, result);
  }
  return result;
}

export function startLongWatchMedalJob(guild: Guild): void {
  const timer = setInterval(() => {
    void synchronizeLongWatchMedals(guild, true)
      .then((result) => {
        if (result.awarded || result.revoked || result.rolesAdded || result.rolesRemoved) {
          console.log(
            `Synchronized Long Watch medals: ${result.awarded} awarded, ${result.revoked} revoked, `
            + `${result.rolesAdded} roles added, and ${result.rolesRemoved} roles removed.`
          );
        }
      })
      .catch((error) => console.warn("Failed to synchronize Long Watch medals:", error));
  }, LONG_WATCH_SYNC_INTERVAL_MS);
  timer.unref();
}

function rangerJoinedAt(ranger: RangerRow): string {
  return ranger.joined_at ?? `${ranger.join_date}T00:00:00.000Z`;
}

async function synchronizeLongWatchRoles(
  guild: Guild,
  ranger: RangerRow,
  expected: ReadonlySet<string>,
  medals: CorpsMedalRow[],
  result: LongWatchSyncResult
): Promise<void> {
  const member = guild.members.cache.get(ranger.discord_user_id);
  if (!member) {
    return;
  }
  for (const medal of medals) {
    if (!medal.discord_role_id) {
      continue;
    }
    const hasRole = member.roles.cache.has(medal.discord_role_id);
    if (expected.has(medal.slug) && !hasRole) {
      await member.roles.add(medal.discord_role_id, `Synchronize automatic ${medal.name} service award`)
        .then(() => { result.rolesAdded += 1; })
        .catch((error) => console.warn(`Could not add ${medal.name} to ${ranger.discord_user_id}:`, error));
    } else if (!expected.has(medal.slug) && hasRole) {
      await member.roles.remove(medal.discord_role_id, `Remove ineligible automatic ${medal.name} service award`)
        .then(() => { result.rolesRemoved += 1; })
        .catch((error) => console.warn(`Could not remove ${medal.name} from ${ranger.discord_user_id}:`, error));
    }
  }
}
