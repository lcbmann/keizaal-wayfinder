import assert from "node:assert/strict";
import test from "node:test";
import type { Guild, GuildMember } from "discord.js";
import { env } from "../config/env.js";
import type { TrailmarkRow, TrailmarkSessionRow } from "../db/supabase.js";
import {
  createAtlasDiscordLinkCode,
  processAtlasTrailmarkAccessRequest,
  type AtlasAccessRequestCompletion,
  type AtlasTrailmarkAccessDependencies
} from "./atlasTrailmarkAccessService.js";

const guild = {} as Guild;
const member = {} as GuildMember;
const trailmark: TrailmarkRow = {
  id: "trailmark-id",
  name: "Dawnstar",
  slug: "dawnstar",
  hold: "The Pale",
  location_description: "A cache near Dawnstar.",
  screenshot_url: null,
  discord_channel_id: "discord-channel-id",
  atlas_location_id: "atlas-dawnstar",
  active: true,
  pinned: false,
  created_by_discord_user_id: "marshal-id",
  created_at: "2026-07-30T10:00:00.000Z",
  updated_at: "2026-07-30T10:00:00.000Z"
};
const session: TrailmarkSessionRow = {
  id: "session-id",
  discord_user_id: "discord-user-id",
  trailmark_id: trailmark.id,
  discord_channel_id: trailmark.discord_channel_id,
  expires_at: "2026-07-30T10:30:00.000Z",
  active: true,
  created_at: "2026-07-30T10:00:00.000Z"
};
const request = {
  id: "request-id",
  discord_user_id: "discord-user-id",
  atlas_location_id: trailmark.atlas_location_id ?? "",
  ranger_name: "Atlas Name Only",
  requested_at: "2026-07-30T10:00:00.000Z"
};

test("creates an Atlas link code with the migration RPC contract", async () => {
  let received: Record<string, unknown> | undefined;
  const profile = { version: 1, primary_badge: { id: "ranger", label: "Ranger" }, medals: [] };
  const code = await createAtlasDiscordLinkCode(
    { discordUserId: "discord-user-id", discordDisplayName: "Current Display Name", discordProfile: profile },
    async (args) => {
      received = args;
      return { data: "5W8G46FW", error: null };
    }
  );

  assert.equal(code, "5W8G46FW");
  assert.deepEqual(received, {
    discord_user_id_input: "discord-user-id",
    discord_display_name_input: "Current Display Name",
    discord_profile_input: profile
  });
});

test("fails an unmapped Atlas location without granting access", async () => {
  const completions: AtlasAccessRequestCompletion[] = [];
  let grantCalled = false;
  const result = await processAtlasTrailmarkAccessRequest(guild, request, createDependencies({
    findTrailmark: async () => null,
    grantAccess: async () => {
      grantCalled = true;
      return session;
    },
    completeRequest: async (completion) => {
      completions.push(completion);
      return true;
    }
  }));

  assert.equal(result.status, "failed");
  assert.equal(result.errorMessage, "No active Trailmark is linked to this Atlas location.");
  assert.equal(grantCalled, false);
  assert.equal(completions[0]?.request_status, "failed");
});

test("rejects a linked Discord member without Trailmark permission", async () => {
  const completions: AtlasAccessRequestCompletion[] = [];
  let grantCalled = false;
  const result = await processAtlasTrailmarkAccessRequest(guild, request, createDependencies({
    canUseTrailmarks: () => false,
    grantAccess: async () => {
      grantCalled = true;
      return session;
    },
    completeRequest: async (completion) => {
      completions.push(completion);
      return true;
    }
  }));

  assert.equal(result.status, "failed");
  assert.equal(result.errorMessage, "The linked Discord member is not eligible to use Trailmarks.");
  assert.equal(grantCalled, false);
  assert.equal(completions[0]?.request_error_message, "The linked Discord member is not eligible to use Trailmarks.");
});

test("grants access, processes Intel, and completes the request", async () => {
  const completions: AtlasAccessRequestCompletion[] = [];
  const calls: string[] = [];
  const result = await processAtlasTrailmarkAccessRequest(guild, request, createDependencies({
    grantAccess: async (params) => {
      assert.equal(params.minutes, env.DEFAULT_TRAILMARK_ACCESS_MINUTES);
      calls.push("grant");
      return session;
    },
    captureIntel: async () => {
      calls.push("capture");
      return 1;
    },
    recordVisit: async (params) => {
      assert.equal(params.discordUserId, request.discord_user_id);
      calls.push("visit");
      return {};
    },
    completeRequest: async (completion) => {
      completions.push(completion);
      return true;
    }
  }));

  assert.deepEqual(result, { status: "granted" });
  assert.deepEqual(calls, ["grant", "capture", "visit"]);
  assert.deepEqual(completions[0], {
    access_request_id: request.id,
    request_status: "granted",
    request_discord_guild_id: env.DISCORD_GUILD_ID,
    request_discord_channel_id: session.discord_channel_id,
    request_access_expires_at: session.expires_at,
    request_error_message: null
  });
});

test("records the visit when Trailmark history capture fails", async () => {
  const completions: AtlasAccessRequestCompletion[] = [];
  const calls: string[] = [];
  const originalConsoleError = console.error;
  console.error = () => undefined;
  let result;
  try {
    result = await processAtlasTrailmarkAccessRequest(guild, request, createDependencies({
      captureIntel: async () => {
        throw new Error("history unavailable");
      },
      recordVisit: async () => {
        calls.push("visit");
      },
      completeRequest: async (completion) => {
        completions.push(completion);
        return true;
      }
    }));
  } finally {
    console.error = originalConsoleError;
  }

  assert.deepEqual(result, { status: "granted" });
  assert.deepEqual(calls, ["visit"]);
  assert.equal(completions[0]?.request_status, "granted");
});

test("records a safe failed completion when access processing fails", async () => {
  const completions: AtlasAccessRequestCompletion[] = [];
  const originalConsoleError = console.error;
  console.error = () => undefined;
  let result;
  try {
    result = await processAtlasTrailmarkAccessRequest(guild, request, createDependencies({
      grantAccess: async () => {
        throw new Error("internal access failure");
      },
      completeRequest: async (completion) => {
        completions.push(completion);
        return true;
      }
    }));
  } finally {
    console.error = originalConsoleError;
  }

  assert.deepEqual(result, { status: "failed", errorMessage: "Trailmark access could not be granted." });
  assert.equal(completions[0]?.request_status, "failed");
  assert.equal(completions[0]?.request_error_message, "Trailmark access could not be granted.");
});

function createDependencies(overrides: Partial<AtlasTrailmarkAccessDependencies> = {}): AtlasTrailmarkAccessDependencies {
  return {
    findTrailmark: async () => trailmark,
    fetchMember: async () => member,
    canUseTrailmarks: () => true,
    grantAccess: async () => session,
    captureIntel: async () => 0,
    recordVisit: async () => ({}),
    completeRequest: async () => true,
    ...overrides
  };
}
