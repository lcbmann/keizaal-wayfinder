import assert from "node:assert/strict";
import test from "node:test";
import { Collection, type GuildMember } from "discord.js";
import { env } from "../config/env.js";
import { roleIdForRank } from "../config/roles.js";
import { canApprovePromotions, canCreateTrailmarks, canManageAll, canOpenPromotionVotes, canUseTrailmarks, mainRankFromMember } from "./permissions.js";
import { RANKS } from "../config/ranks.js";
import { guildEmoji, rankEmojiName } from "./guildEmojis.js";
import type { Guild } from "discord.js";
import { synchronizeRankNames } from "../services/rankNamingService.js";
import { buildAtlasDiscordProfile } from "../services/atlasDiscordProfileService.js";

function memberWithRoles(...ids: string[]): GuildMember {
  return { roles: { cache: new Collection(ids.map((id) => [id, { id }])) } } as unknown as GuildMember;
}

test("Aedra can use Trailmarks without having a Corps rank", () => {
  const member = memberWithRoles(env.ROLE_AEDRA_ID);
  assert.equal(canUseTrailmarks(member), true);
  assert.equal(mainRankFromMember(member), null);
  assert.equal(canCreateTrailmarks(member), false);
  assert.equal(canManageAll(member), false);
});

test("all existing Corps ranks retain Trailmark access", () => {
  for (const rank of ["Apprentice", "Ranger", "Marshal", "Captain", "First Captain"] as const) {
    assert.equal(canUseTrailmarks(memberWithRoles(roleIdForRank(rank))), true, rank);
  }
});

test("unrelated roles and members without roles do not gain Trailmark access", () => {
  assert.equal(canUseTrailmarks(memberWithRoles("unrelated-role")), false);
  assert.equal(canUseTrailmarks(memberWithRoles()), false);
});

test("Captains and First Captains have identical configured management privileges", () => {
  const { sort: captainSort, envRoleKey: captainRole, ...captainPrivileges } = RANKS["Captain"];
  const { sort: commanderSort, envRoleKey: commanderRole, ...commanderPrivileges } = RANKS["First Captain"];
  assert.deepEqual(captainPrivileges, commanderPrivileges);
  assert.notEqual(captainSort, commanderSort);
  assert.notEqual(captainRole, commanderRole);
  for (const rank of ["Captain", "First Captain"] as const) {
    const member = memberWithRoles(roleIdForRank(rank));
    for (const canManage of [canManageAll, canApprovePromotions, canOpenPromotionVotes, canCreateTrailmarks]) {
      assert.equal(canManage(member), true);
    }
  }
  assert.equal(canManageAll(memberWithRoles(roleIdForRank("Marshal"))), false);
  assert.equal(canApprovePromotions(memberWithRoles(roleIdForRank("Marshal"))), false);
});

test("rank renaming preserves role IDs and is idempotent", async () => {
  const renamed: string[] = [];
  const ranks = ["First Captain", "Captain", "Marshal"] as const;
  const roles = new Collection(ranks.map((rank) => {
    const role = { id: roleIdForRank(rank), name: `Old ${rank}`, async setName(name: string) {
      renamed.push(this.id);
      this.name = name;
    } };
    return [role.id, role];
  }));
  const emojis = new Collection([[
    "original-emoji-id", { name: "rangercommander", async setName(name: string) { this.name = name; } }
  ]]);
  const guild = { roles: { cache: roles, fetch: async () => roles }, emojis: { cache: emojis, fetch: async () => emojis } } as unknown as Guild;
  await synchronizeRankNames(guild);
  await synchronizeRankNames(guild);
  assert.deepEqual(renamed, ranks.map(roleIdForRank));
  assert.deepEqual([...roles.values()].map(({ name }) => name), ranks);
  assert.equal(emojis.get("original-emoji-id")?.name, "firstcaptain");
});

test("rank emoji rendering accepts older guild emoji names", () => {
  const guild = { emojis: { cache: new Collection([
    ["old", { name: "rangercommander", toString: () => "original-badge" }],
    ["new", { name: "captain", toString: () => "captain-badge" }]
  ]) } } as unknown as Guild;
  assert.equal(rankEmojiName("First Captain"), "firstcaptain");
  assert.equal(rankEmojiName("Captain"), "captain");
  assert.equal(rankEmojiName("Marshal"), "marshal");
  assert.equal(guildEmoji(guild, "firstcaptain"), "original-badge");
  assert.equal(guildEmoji(guild, "captain"), "captain-badge");
});

test("Atlas badges use the new rank names for cumulative officer roles", () => {
  const roles = new Collection(["First Captain", "Captain", "Marshal", "Ranger", "Apprentice"].map((name, index) => {
    const id = roleIdForRank(name as keyof typeof RANKS);
    return [id, { id, name, position: 10 - index }];
  }));
  const member = { roles: { cache: roles } } as unknown as GuildMember;
  const profile = buildAtlasDiscordProfile(member) as { primary_badge: unknown; medals: { id: string; label: string }[] };
  assert.deepEqual(profile.primary_badge, { id: "first-captain", label: "First Captain" });
  assert.ok(profile.medals.some(({ id, label }) => id === "captain" && label === "Captain"));
  assert.ok(profile.medals.some(({ id, label }) => id === "marshal" && label === "Marshal"));
});
