import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";
import type { MainRank } from "../config/ranks.js";

export type RangerStatus = "Active" | "Inactive" | "On Leave" | "Retired";
export type PromotionVoteStatus = "Open" | "Closed" | "Approved" | "Denied";
export type BallotVote = "promote" | "hold" | "abstain";
export type CorpsFundTransactionType = "Donation" | "Expense" | "Adjustment";
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface RangerRow {
  id: string;
  discord_user_id: string;
  discord_username: string | null;
  discord_display_name: string | null;
  in_game_name: string | null;
  current_rank: MainRank;
  status: RangerStatus;
  join_date: string;
  last_promotion_date: string | null;
  assigned_hold: string | null;
  notes: string | null;
  last_discord_activity_at: string | null;
  last_bot_interaction_at: string | null;
  created_by_discord_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrailmarkRow {
  id: string;
  name: string;
  slug: string;
  hold: string;
  location_description: string;
  screenshot_url: string | null;
  discord_channel_id: string;
  atlas_location_id: string | null;
  active: boolean;
  pinned: boolean;
  created_by_discord_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface TrailmarkSessionRow {
  id: string;
  discord_user_id: string;
  trailmark_id: string;
  discord_channel_id: string;
  expires_at: string;
  active: boolean;
  created_at: string;
}

export interface PromotionVoteRow {
  id: string;
  candidate_ranger_id: string;
  target_rank: MainRank;
  status: PromotionVoteStatus;
  opened_by_discord_user_id: string;
  message_id: string | null;
  channel_id: string | null;
  final_decision: string | null;
  created_at: string;
  closed_at: string | null;
}

export interface PromotionBallotRow {
  id: string;
  promotion_vote_id: string;
  voter_discord_user_id: string;
  vote: BallotVote;
  created_at: string;
  updated_at: string;
}

export interface CorpsFundTransactionRow {
  id: string;
  transaction_type: CorpsFundTransactionType;
  amount: number;
  description: string;
  member_discord_user_id: string | null;
  recorded_by_discord_user_id: string;
  discord_channel_id: string | null;
  discord_message_id: string | null;
  created_at: string;
}

export interface CorpsFundSummaryStateRow {
  id: boolean;
  discord_channel_id: string | null;
  discord_message_id: string | null;
  updated_at: string;
}

export interface BotMessageStateRow {
  state_key: string;
  discord_channel_id: string;
  discord_message_ids: string[];
  updated_at: string;
}

export interface IntelSettingsRow {
  id: boolean;
  hq_trailmark_id: string | null;
  catchall_topic_id: string | null;
  updated_at: string;
}

export interface IntelTopicRow {
  id: string;
  name: string;
  slug: string;
  keywords: string[];
  discord_channel_id: string;
  active: boolean;
  created_by_discord_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface IntelReportRow {
  id: string;
  topic_id: string;
  trailmark_id: string;
  discord_message_id: string;
  discord_channel_id: string;
  author_discord_user_id: string;
  content: string;
  delivered_by_discord_user_id: string | null;
  delivered_to_trailmark_id: string | null;
  delivered_at: string | null;
  bulletin_channel_id: string | null;
  bulletin_message_id: string | null;
  bulletin_posted_at: string | null;
  atlas_share_code: string | null;
  atlas_summary: Json | null;
  created_at: string;
}

export interface IntelTrailmarkVisitRow {
  id: string;
  discord_user_id: string;
  trailmark_id: string;
  visited_at: string;
}

export interface AllianceIntelSettingsRow {
  id: boolean;
  alliance_guild_id: string;
  reports_category_id: string;
  intake_channel_id: string;
  admin_channel_id: string;
  corps_ally_reports_channel_id: string | null;
  active: boolean;
  updated_at: string;
}

export interface AllianceTopicMirrorRow {
  topic_id: string;
  alliance_guild_id: string;
  alliance_channel_id: string;
  created_at: string;
  updated_at: string;
}

export interface AllianceIntelPublicationRow {
  report_id: string;
  alliance_channel_id: string;
  alliance_message_id: string;
  published_at: string;
}

export interface AllianceReportRow {
  id: string;
  discord_message_id: string;
  discord_channel_id: string;
  author_discord_user_id: string;
  author_display_name: string;
  source_order: string;
  content: string;
  attachment_urls: string[];
  corps_ally_channel_id: string | null;
  corps_ally_message_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AllianceReportTopicPublicationRow {
  alliance_report_id: string;
  topic_id: string;
  corps_channel_id: string;
  corps_message_id: string;
  alliance_channel_id: string;
  alliance_message_id: string;
  created_at: string;
  updated_at: string;
}

export interface Database {
  public: {
    Tables: {
      rangers: {
        Row: RangerRow;
        Insert: Partial<RangerRow> & Pick<RangerRow, "discord_user_id" | "current_rank" | "join_date">;
        Update: Partial<RangerRow>;
      };
      rank_history: {
        Row: {
          id: string;
          ranger_id: string;
          old_rank: MainRank | null;
          new_rank: MainRank;
          changed_by_discord_user_id: string;
          reason: string | null;
          created_at: string;
        };
        Insert: {
          ranger_id: string;
          old_rank?: MainRank | null;
          new_rank: MainRank;
          changed_by_discord_user_id: string;
          reason?: string | null;
        };
        Update: never;
      };
      trailmarks: {
        Row: TrailmarkRow;
        Insert: Omit<TrailmarkRow, "id" | "created_at" | "updated_at">;
        Update: Partial<TrailmarkRow>;
      };
      trailmark_sessions: {
        Row: TrailmarkSessionRow;
        Insert: Omit<TrailmarkSessionRow, "id" | "created_at">;
        Update: Partial<TrailmarkSessionRow>;
      };
      promotion_votes: {
        Row: PromotionVoteRow;
        Insert: Omit<PromotionVoteRow, "id" | "created_at" | "closed_at"> & { closed_at?: string | null };
        Update: Partial<PromotionVoteRow>;
      };
      promotion_vote_ballots: {
        Row: PromotionBallotRow;
        Insert: Omit<PromotionBallotRow, "id" | "created_at" | "updated_at">;
        Update: Partial<PromotionBallotRow>;
      };
      member_activity_events: {
        Row: {
          id: string;
          discord_user_id: string;
          event_type: string;
          channel_id: string | null;
          created_at: string;
        };
        Insert: {
          discord_user_id: string;
          event_type: string;
          channel_id?: string | null;
        };
        Update: never;
      };
      corps_fund_transactions: {
        Row: CorpsFundTransactionRow;
        Insert: Omit<CorpsFundTransactionRow, "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<CorpsFundTransactionRow>;
      };
      corps_fund_summary_state: {
        Row: CorpsFundSummaryStateRow;
        Insert: Partial<CorpsFundSummaryStateRow>;
        Update: Partial<CorpsFundSummaryStateRow>;
      };
      bot_message_state: {
        Row: BotMessageStateRow;
        Insert: BotMessageStateRow;
        Update: Partial<BotMessageStateRow>;
      };
      intel_settings: {
        Row: IntelSettingsRow;
        Insert: Partial<IntelSettingsRow>;
        Update: Partial<IntelSettingsRow>;
      };
      intel_topics: {
        Row: IntelTopicRow;
        Insert: Omit<IntelTopicRow, "id" | "created_at" | "updated_at">;
        Update: Partial<IntelTopicRow>;
      };
      intel_reports: {
        Row: IntelReportRow;
        Insert: Omit<
          IntelReportRow,
          "id" | "bulletin_channel_id" | "bulletin_message_id" | "bulletin_posted_at" | "atlas_share_code" | "atlas_summary"
        > & {
          id?: string;
          bulletin_channel_id?: string | null;
          bulletin_message_id?: string | null;
          bulletin_posted_at?: string | null;
          atlas_share_code?: string | null;
          atlas_summary?: Json | null;
        };
        Update: Partial<IntelReportRow>;
      };
      intel_trailmark_visits: {
        Row: IntelTrailmarkVisitRow;
        Insert: Omit<IntelTrailmarkVisitRow, "id"> & { id?: string };
        Update: Partial<IntelTrailmarkVisitRow>;
      };
      alliance_intel_settings: {
        Row: AllianceIntelSettingsRow;
        Insert: Omit<AllianceIntelSettingsRow, "updated_at"> & { updated_at?: string };
        Update: Partial<AllianceIntelSettingsRow>;
      };
      alliance_topic_mirrors: {
        Row: AllianceTopicMirrorRow;
        Insert: Omit<AllianceTopicMirrorRow, "created_at" | "updated_at">;
        Update: Partial<AllianceTopicMirrorRow>;
      };
      alliance_intel_publications: {
        Row: AllianceIntelPublicationRow;
        Insert: Omit<AllianceIntelPublicationRow, "published_at"> & { published_at?: string };
        Update: Partial<AllianceIntelPublicationRow>;
      };
      alliance_reports: {
        Row: AllianceReportRow;
        Insert: Omit<AllianceReportRow, "id" | "updated_at"> & { id?: string; updated_at?: string };
        Update: Partial<AllianceReportRow>;
      };
      alliance_report_topic_publications: {
        Row: AllianceReportTopicPublicationRow;
        Insert: Omit<AllianceReportTopicPublicationRow, "created_at" | "updated_at">;
        Update: Partial<AllianceReportTopicPublicationRow>;
      };
    };
    Functions: {
      get_atlas_share: {
        Args: { share_code: string };
        Returns: Json;
      };
    };
  };
}

export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

export function assertNoDbError(error: { message: string } | null, action: string): void {
  if (error) {
    throw new Error(`${action}: ${error.message}`);
  }
}
