import type { Guild, GuildMember } from "discord.js";
import { env } from "../config/env.js";
import {
  assertNoDbError,
  supabase,
  type Json,
  type TrailmarkRow,
  type TrailmarkSessionRow
} from "../db/supabase.js";
import { canUseTrailmarks } from "../utils/permissions.js";
import { captureRecentTrailmarkMessagesForIntel, recordTrailmarkVisitAndDeliver } from "./intelService.js";
import { getActiveTrailmarkByAtlasLocationId, grantTrailmarkAccess } from "./trailmarkService.js";

export interface AtlasTrailmarkAccessRequest {
  id: string;
  discord_user_id: string;
  atlas_location_id: string;
  ranger_name: string;
  requested_at: string;
}

interface RpcError {
  message: string;
}

interface AtlasLinkCodeRpcResult {
  data: string | null;
  error: RpcError | null;
}

export type AtlasLinkCodeRpc = (args: {
  discord_user_id_input: string;
  discord_display_name_input: string;
}) => Promise<AtlasLinkCodeRpcResult>;

export interface AtlasAccessRequestCompletion {
  access_request_id: string;
  request_status: "granted" | "failed";
  request_discord_guild_id: string | null;
  request_discord_channel_id: string | null;
  request_access_expires_at: string | null;
  request_error_message: string | null;
}

export type CompleteAtlasAccessRequest = (params: AtlasAccessRequestCompletion) => Promise<boolean>;

export interface AtlasTrailmarkAccessDependencies {
  findTrailmark: (atlasLocationId: string) => Promise<TrailmarkRow | null>;
  fetchMember: (guild: Guild, discordUserId: string) => Promise<GuildMember | null>;
  canUseTrailmarks: (member: GuildMember) => boolean;
  grantAccess: (params: { guild: Guild; member: GuildMember; trailmark: TrailmarkRow; minutes: number }) => Promise<TrailmarkSessionRow>;
  captureIntel: (params: { guild: Guild; trailmark: TrailmarkRow }) => Promise<number>;
  recordVisit: (params: { guild: Guild; discordUserId: string; trailmark: TrailmarkRow }) => Promise<unknown>;
  completeRequest: CompleteAtlasAccessRequest;
}

export async function createAtlasDiscordLinkCode(
  params: { discordUserId: string; discordDisplayName: string },
  rpc: AtlasLinkCodeRpc = createAtlasLinkCodeRpc
): Promise<string> {
  const { data, error } = await rpc({
    discord_user_id_input: params.discordUserId,
    discord_display_name_input: params.discordDisplayName
  });
  assertNoDbError(error, "create Atlas Discord link code");
  if (!data?.trim()) {
    throw new Error("Atlas did not return a link code.");
  }

  return data;
}

export async function claimPendingAtlasTrailmarkAccessRequests(requestLimit = 10): Promise<AtlasTrailmarkAccessRequest[]> {
  const { data, error } = await supabase.rpc("claim_pending_atlas_trailmark_access_requests", {
    request_limit: requestLimit
  });
  assertNoDbError(error, "claim pending Atlas Trailmark access requests");
  return parseAtlasAccessRequests(data);
}

export async function completeAtlasTrailmarkAccessRequest(params: AtlasAccessRequestCompletion): Promise<boolean> {
  const { data, error } = await supabase.rpc("complete_atlas_trailmark_access_request", {
    access_request_id: params.access_request_id,
    request_status: params.request_status,
    request_discord_guild_id: params.request_discord_guild_id,
    request_discord_channel_id: params.request_discord_channel_id,
    request_access_expires_at: params.request_access_expires_at,
    request_error_message: params.request_error_message
  });
  assertNoDbError(error, "complete Atlas Trailmark access request");
  return data === true;
}

export async function processAtlasTrailmarkAccessRequest(
  guild: Guild,
  request: AtlasTrailmarkAccessRequest,
  dependencies: AtlasTrailmarkAccessDependencies = defaultDependencies()
): Promise<{ status: "granted" | "failed"; errorMessage?: string }> {
  try {
    const trailmark = await dependencies.findTrailmark(request.atlas_location_id);
    if (!trailmark) {
      throw new AtlasAccessRequestFailure("No active Trailmark is linked to this Atlas location.");
    }

    const member = await dependencies.fetchMember(guild, request.discord_user_id);
    if (!member) {
      throw new AtlasAccessRequestFailure("The linked Discord member could not be found in the Ranger Corps server.");
    }
    if (!dependencies.canUseTrailmarks(member)) {
      throw new AtlasAccessRequestFailure("The linked Discord member is not eligible to use Trailmarks.");
    }

    const session = await dependencies.grantAccess({
      guild,
      member,
      trailmark,
      minutes: env.DEFAULT_TRAILMARK_ACCESS_MINUTES
    });
    await dependencies.captureIntel({ guild, trailmark });
    await dependencies.recordVisit({
      guild,
      discordUserId: request.discord_user_id,
      trailmark
    });

    const completed = await dependencies.completeRequest({
      access_request_id: request.id,
      request_status: "granted",
      request_discord_guild_id: env.DISCORD_GUILD_ID,
      request_discord_channel_id: session.discord_channel_id,
      request_access_expires_at: session.expires_at,
      request_error_message: null
    });
    if (!completed) {
      throw new Error("Atlas grant completion returned false.");
    }

    return { status: "granted" };
  } catch (error) {
    const errorMessage = error instanceof AtlasAccessRequestFailure
      ? error.message
      : "Trailmark access could not be granted.";
    if (!(error instanceof AtlasAccessRequestFailure)) {
      console.error(`Failed to process Atlas Trailmark access request ${request.id}:`, error);
    }

    try {
      const completed = await dependencies.completeRequest({
        access_request_id: request.id,
        request_status: "failed",
        request_discord_guild_id: null,
        request_discord_channel_id: null,
        request_access_expires_at: null,
        request_error_message: errorMessage
      });
      if (!completed) {
        console.error(`Atlas failed completion returned false for request ${request.id}.`);
      }
    } catch (completionError) {
      console.error(`Could not complete failed Atlas access request ${request.id}:`, completionError);
    }

    return { status: "failed", errorMessage };
  }
}

async function createAtlasLinkCodeRpc(args: {
  discord_user_id_input: string;
  discord_display_name_input: string;
}): Promise<AtlasLinkCodeRpcResult> {
  return await supabase.rpc("create_atlas_discord_link_code", args);
}

function defaultDependencies(): AtlasTrailmarkAccessDependencies {
  return {
    findTrailmark: getActiveTrailmarkByAtlasLocationId,
    fetchMember: async (guild, discordUserId) => guild.members.fetch(discordUserId).catch(() => null),
    canUseTrailmarks,
    grantAccess: grantTrailmarkAccess,
    captureIntel: captureRecentTrailmarkMessagesForIntel,
    recordVisit: recordTrailmarkVisitAndDeliver,
    completeRequest: completeAtlasTrailmarkAccessRequest
  };
}

function parseAtlasAccessRequests(value: Json | null): AtlasTrailmarkAccessRequest[] {
  if (!Array.isArray(value)) {
    throw new Error("Atlas returned an invalid access request queue.");
  }

  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`Atlas returned an invalid access request at index ${index}.`);
    }

    const request = {
      id: stringValue(item.id),
      discord_user_id: stringValue(item.discord_user_id),
      atlas_location_id: stringValue(item.atlas_location_id),
      ranger_name: stringValue(item.ranger_name),
      requested_at: stringValue(item.requested_at)
    };
    if (!request.id || !request.discord_user_id || !request.atlas_location_id || !request.requested_at) {
      throw new Error(`Atlas returned an incomplete access request at index ${index}.`);
    }
    return request;
  });
}

function isRecord(value: Json): value is { [key: string]: Json | undefined } {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: Json | undefined): string {
  return typeof value === "string" ? value : "";
}

class AtlasAccessRequestFailure extends Error {}
