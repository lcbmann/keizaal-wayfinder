import "dotenv/config";
import { z } from "zod";

const optionalId = z.string().optional().default("");

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  TRAILMARK_CATEGORY_ID: z.string().min(1),
  TRAILMARK_ACCESS_CHANNEL_ID: z.string().min(1),

  ROLE_RANGER_COMMANDER_ID: z.string().min(1),
  ROLE_RANGER_CAPTAIN_ID: z.string().min(1),
  ROLE_RANGER_MARSHAL_ID: z.string().min(1),
  ROLE_RANGER_ID: z.string().min(1),
  ROLE_APPRENTICE_ID: z.string().min(1),
  ROLE_SENIOR_RANGER_ID: z.string().min(1),

  GUEST_ROLE_ID: z.string().min(1),
  CAREER_TAILOR_ROLE_ID: z.string().min(1),
  CAREER_COOK_ROLE_ID: z.string().min(1),
  CAREER_HUNTER_ROLE_ID: z.string().min(1),
  CAREER_WARRIOR_ROLE_ID: z.string().min(1),
  CAREER_ALCHEMIST_ROLE_ID: z.string().min(1),
  CAREER_BLACKSMITH_ROLE_ID: z.string().min(1),
  CAREER_MINER_ROLE_ID: z.string().min(1),
  CAREER_WOODWORKER_ROLE_ID: z.string().min(1),

  DEFAULT_TRAILMARK_ACCESS_MINUTES: z.coerce.number().int().positive().default(30),
  PROMOTION_MIN_DAYS_APPRENTICE_TO_RANGER: z.coerce.number().int().nonnegative().default(7),
  INVITE_CHANNEL_ID: optionalId,
  CORPS_FUNDS_CHANNEL_ID: optionalId,
  RANK_ROLE_SYNC_EXEMPT_USER_IDS: optionalId,

  CORPS_INTEL_CATEGORY_ID: optionalId,
  RANGER_ALLIANCE_GUILD_ID: optionalId,
  RANGER_ALLIANCE_REPORTS_CATEGORY_ID: optionalId,
  RANGER_ALLIANCE_INTAKE_CHANNEL_ID: optionalId,
  RANGER_ALLIANCE_ADMIN_CHANNEL_ID: optionalId,
  RANGER_ALLIANCE_ROLE_LEADERS_ID: optionalId,
  RANGER_ALLIANCE_ROLE_UNDAUNTED_ID: optionalId,
  RANGER_ALLIANCE_ROLE_NORTH_STAR_ID: optionalId,
  RANGER_ALLIANCE_ROLE_RANGER_CORPS_ID: optionalId,
  RANGER_ALLIANCE_PRIVATE_MARKER: z.string().trim().min(1).default("[CORPS ONLY]")
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${details}`);
}

export const env = parsed.data;
