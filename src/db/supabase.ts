import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";
import type { MainRank } from "../config/ranks.js";

export type RangerStatus = "Active" | "Inactive" | "On Leave" | "Retired";
export type PromotionProgress = "In Field Trial" | "On Hold" | null;
export type PromotionVoteStatus = "Open" | "Closed" | "Approved" | "Denied";
export type BallotVote = "promote" | "hold" | "abstain";
export type CorpsFundTransactionType = "Donation" | "Expense" | "Adjustment";
export type SupplyAssignmentStatus = "Active" | "Completed" | "Cancelled";
export type DutyApplicationStatus = "Pending" | "Approved" | "Denied" | "Withdrawn";
export type DutyAssignmentStatus = "Active" | "Ended";
export type CorpsApplicationKind = "Duty" | "Marshal" | "Captain";
export type WardenScope = "hold_primary" | "local_range";
export type StructuredTrailmarkReportType = "General" | "Incident";
export type StructuredTrailmarkReportStatus = "Draft" | "Submitted" | "Cancelled";
export type ApprenticeshipSeekingType = "Mentor" | "Apprentice";
export type ApprenticeshipStatus = "Proposed" | "Pending Marshal" | "Active" | "Declined" | "Ended";
export type FieldNameProposalStatus = "Open" | "Approved" | "Denied" | "Cancelled";
export type FieldNameBallotVote = "yes" | "no" | "abstain";
export type FieldNameContestStatus = "Open" | "Approved" | "Denied" | "Cancelled";
export type ContactAssessment = "good" | "cold" | "not_found" | "mia" | "archive";
export type RangerContactRecordType = "Person" | "Group";
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface RangerRow {
  id: string;
  discord_user_id: string;
  discord_username: string | null;
  discord_display_name: string | null;
  in_game_name: string | null;
  current_rank: MainRank;
  status: RangerStatus;
  promotion_progress: PromotionProgress;
  promotion_progress_started_at: string | null;
  join_date: string;
  joined_at: string | null;
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
  thread_id: string | null;
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
  author_display_name: string | null;
  source_order: string | null;
  source_alliance_report_id: string | null;
  created_at: string;
}

export interface IntelTrailmarkVisitRow {
  id: string;
  discord_user_id: string;
  trailmark_id: string;
  visited_at: string;
}

export interface CorpsDutyRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  discord_role_id: string | null;
  max_active_holders: number | null;
  requires_detail: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RankHistoryRow {
  id: string;
  ranger_id: string;
  old_rank: MainRank | null;
  new_rank: MainRank;
  changed_by_discord_user_id: string;
  reason: string | null;
  created_at: string;
}

export interface DutyApplicationRow {
  id: string;
  duty_id: string | null;
  applicant_ranger_id: string;
  application_kind: CorpsApplicationKind;
  target_rank: MainRank | null;
  status: DutyApplicationStatus;
  reason: string;
  experience: string | null;
  application_responses: Json;
  assignment_detail: string | null;
  warden_scope: WardenScope | null;
  parent_hold: string | null;
  resulting_promotion_vote_id: string | null;
  reviewed_by_discord_user_id: string | null;
  reviewed_at: string | null;
  strongbox_channel_id: string | null;
  strongbox_message_id: string | null;
  strongbox_thread_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RangerDutyAssignmentRow {
  id: string;
  duty_id: string;
  ranger_id: string;
  application_id: string | null;
  status: DutyAssignmentStatus;
  assignment_detail: string | null;
  warden_scope: WardenScope | null;
  parent_hold: string | null;
  assigned_by_discord_user_id: string;
  started_at: string;
  ended_at: string | null;
  end_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface StructuredTrailmarkReportRow {
  id: string;
  trailmark_id: string;
  reporter_discord_user_id: string;
  reporter_display_name: string;
  report_type: StructuredTrailmarkReportType;
  status: StructuredTrailmarkReportStatus;
  subject: string | null;
  location: string | null;
  summary: string | null;
  details: string | null;
  follow_up: string | null;
  commendation: string | null;
  contact_ids: string[];
  participant_discord_user_ids: string[];
  discord_channel_id: string | null;
  discord_message_id: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StructuredReportContactForwardRow {
  report_id: string;
  contact_id: string;
  discord_thread_id: string;
  discord_message_id: string;
  forwarded_at: string;
}

export interface CorpsMedalRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  emoji: string | null;
  discord_role_id: string | null;
  active: boolean;
  created_by_discord_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface RangerMedalAwardRow {
  id: string;
  medal_id: string;
  ranger_id: string;
  awarded_by_discord_user_id: string;
  reason: string | null;
  awarded_at: string;
}

export interface HonorsLedgerEntryRow {
  id: string;
  source_type: "medal_award" | "promotion";
  source_id: string;
  discord_thread_id: string;
  discord_message_id: string;
  created_at: string;
}

export interface HistoricalCorpsMemberRow {
  id: string;
  display_name: string;
  discord_username: string | null;
  join_date: string;
  joined_at: string | null;
  source: string;
  created_at: string;
}

export interface ApprenticeshipPreferenceRow {
  discord_user_id: string;
  seeking: ApprenticeshipSeekingType;
  note: string | null;
  notice_channel_id: string | null;
  notice_message_id: string | null;
  strongbox_channel_id: string | null;
  strongbox_message_id: string | null;
  strongbox_thread_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApprenticeshipRow {
  id: string;
  mentor_discord_user_id: string;
  apprentice_discord_user_id: string;
  status: ApprenticeshipStatus;
  proposed_by_discord_user_id: string;
  sponsor_reason: string | null;
  reviewed_by_discord_user_id: string | null;
  reviewed_at: string | null;
  accepted_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  end_reason: string | null;
  strongbox_channel_id: string | null;
  strongbox_message_id: string | null;
  strongbox_thread_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface FieldNameProposalRow {
  id: string;
  target_discord_user_id: string;
  proposed_name: string;
  reason: string;
  nominated_by_discord_user_id: string;
  status: FieldNameProposalStatus;
  opened_at: string;
  closes_at: string;
  decided_at: string | null;
  decision_reason: string | null;
  discord_channel_id: string | null;
  discord_message_id: string | null;
  discord_thread_id: string | null;
  nominee_veto_notified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FieldNameBallotRow {
  id: string;
  proposal_id: string;
  voter_discord_user_id: string;
  vote: FieldNameBallotVote;
  created_at: string;
  updated_at: string;
}

export interface FieldNameContestRow {
  id: string;
  target_discord_user_id: string;
  opened_by_discord_user_id: string;
  status: FieldNameContestStatus;
  reason: string | null;
  opened_at: string;
  closes_at: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  discord_channel_id: string | null;
  discord_message_id: string | null;
  discord_thread_id: string | null;
  nominee_veto_notified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FieldNameOptionRow {
  id: string;
  contest_id: string;
  proposed_name: string;
  reason: string;
  nominated_by_discord_user_id: string;
  created_at: string;
}

export interface FieldNameContestVoteRow {
  id: string;
  contest_id: string;
  option_id: string;
  voter_discord_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface RangerFieldNameRow {
  id: string;
  discord_user_id: string;
  field_name: string;
  assigned_by_proposal_id: string | null;
  assigned_by_contest_id: string | null;
  assigned_at: string;
  active: boolean;
  removed_at: string | null;
  removed_reason: string | null;
}

export interface RangerContactRow {
  id: string;
  record_type: RangerContactRecordType;
  name: string;
  race: string | null;
  sex: string | null;
  occupation: string | null;
  faction: string | null;
  hold: string;
  usual_locations: string | null;
  commentary: string | null;
  group_category: string | null;
  estimated_size: string | null;
  identifying_features: string | null;
  weapons_capabilities: string | null;
  tactics: string | null;
  high_priority: boolean;
  active: boolean;
  created_by_discord_user_id: string;
  forum_channel_id: string | null;
  forum_thread_id: string | null;
  forum_message_id: string | null;
  archived_by_discord_user_id: string | null;
  archived_at: string | null;
  archive_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContactAssessmentRow {
  id: string;
  contact_id: string;
  voter_discord_user_id: string;
  assessment: ContactAssessment;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupplyAssignmentRow {
  id: string;
  code: string;
  name: string;
  client_name: string;
  status: SupplyAssignmentStatus;
  sale_price_per_item: number;
  ranger_rate_per_item: number;
  organizer_discord_user_id: string | null;
  notes: string | null;
  created_by_discord_user_id: string;
  discord_channel_id: string | null;
  discord_message_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface SupplyAssignmentItemRow {
  id: string;
  assignment_id: string;
  item_name: string;
  target_quantity: number;
  sort_order: number;
  created_at: string;
}

export interface SupplyContributionRow {
  id: string;
  assignment_id: string;
  item_id: string;
  member_discord_user_id: string;
  quantity: number;
  note: string | null;
  logged_by_discord_user_id: string;
  created_at: string;
}

export interface SupplyContributionRedistributionRow {
  id: string;
  operation_id: string;
  assignment_id: string;
  source_contribution_id: string;
  source_member_discord_user_id: string;
  allocations: Json;
  distribution_method: "weighted" | "even";
  source_cutoff: string;
  reason: string | null;
  created_by_discord_user_id: string;
  created_at: string;
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
  headquarters_id: string | null;
  trailmark_message_channel_id: string | null;
  trailmark_message_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AllianceHeadquartersRow {
  id: string;
  headquarters_key: string;
  name: string;
  source_order: string;
  trailmark_id: string;
  alliance_guild_id: string;
  viewer_role_id: string;
  reports_category_id: string;
  intake_channel_id: string;
  intake_emoji: string;
  active: boolean;
  all_topics: boolean;
  report_delivery_start_at: string;
  created_at: string;
  updated_at: string;
}

export interface AllianceHeadquartersTopicChannelRow {
  headquarters_id: string;
  topic_id: string;
  discord_channel_id: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AllianceHeadquartersDeliveryRow {
  report_id: string;
  headquarters_id: string;
  delivered_by_discord_user_id: string;
  delivered_at: string;
}

export interface AllianceHeadquartersPublicationRow {
  report_id: string;
  headquarters_id: string;
  discord_channel_id: string;
  discord_message_id: string;
  published_at: string;
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
      atlas_ranger_directory: {
        Row: {
          discord_user_id: string;
          display_name: string;
          active: boolean;
          permissions: string[];
          roles: Json;
          discord_profile: Json;
          updated_at: string;
        };
        Insert: {
          discord_user_id: string;
          display_name?: string;
          active?: boolean;
          permissions?: string[];
          roles?: Json;
          discord_profile?: Json;
          updated_at?: string;
        };
        Update: {
          display_name?: string;
          active?: boolean;
          permissions?: string[];
          roles?: Json;
          discord_profile?: Json;
          updated_at?: string;
        };
      };
      rangers: {
        Row: RangerRow;
        Insert: Partial<RangerRow> & Pick<RangerRow, "discord_user_id" | "current_rank" | "join_date">;
        Update: Partial<RangerRow>;
      };
      rank_history: {
        Row: RankHistoryRow;
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
        Insert: Omit<PromotionVoteRow, "id" | "created_at" | "closed_at" | "thread_id"> & {
          closed_at?: string | null;
          thread_id?: string | null;
        };
        Update: Partial<PromotionVoteRow>;
      };
      promotion_vote_ballots: {
        Row: PromotionBallotRow;
        Insert: Omit<PromotionBallotRow, "id" | "created_at" | "updated_at">;
        Update: Partial<PromotionBallotRow>;
      };
      corps_duties: {
        Row: CorpsDutyRow;
        Insert: Omit<CorpsDutyRow, "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<CorpsDutyRow>;
      };
      duty_applications: {
        Row: DutyApplicationRow;
        Insert: Omit<
          DutyApplicationRow,
          "id" | "created_at" | "updated_at" | "application_kind" | "target_rank" | "experience"
          | "application_responses" | "warden_scope" | "parent_hold" | "resulting_promotion_vote_id"
        > & {
          id?: string;
          created_at?: string;
          updated_at?: string;
          application_kind?: CorpsApplicationKind;
          target_rank?: MainRank | null;
          experience?: string | null;
          application_responses?: Json;
          warden_scope?: WardenScope | null;
          parent_hold?: string | null;
          resulting_promotion_vote_id?: string | null;
        };
        Update: Partial<DutyApplicationRow>;
      };
      ranger_duty_assignments: {
        Row: RangerDutyAssignmentRow;
        Insert: Omit<RangerDutyAssignmentRow, "id" | "created_at" | "updated_at" | "warden_scope" | "parent_hold"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
          warden_scope?: WardenScope | null;
          parent_hold?: string | null;
        };
        Update: Partial<RangerDutyAssignmentRow>;
      };
      structured_trailmark_reports: {
        Row: StructuredTrailmarkReportRow;
        Insert: Omit<StructuredTrailmarkReportRow, "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<StructuredTrailmarkReportRow>;
      };
      structured_report_contact_forwards: {
        Row: StructuredReportContactForwardRow;
        Insert: Omit<StructuredReportContactForwardRow, "forwarded_at"> & { forwarded_at?: string };
        Update: never;
      };
      corps_medals: {
        Row: CorpsMedalRow;
        Insert: Omit<CorpsMedalRow, "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<CorpsMedalRow>;
      };
      ranger_medal_awards: {
        Row: RangerMedalAwardRow;
        Insert: Omit<RangerMedalAwardRow, "id" | "awarded_at"> & {
          id?: string;
          awarded_at?: string;
        };
        Update: Partial<RangerMedalAwardRow>;
      };
      honors_ledger_entries: {
        Row: HonorsLedgerEntryRow;
        Insert: Omit<HonorsLedgerEntryRow, "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<HonorsLedgerEntryRow>;
      };
      historical_corps_members: {
        Row: HistoricalCorpsMemberRow;
        Insert: Omit<HistoricalCorpsMemberRow, "id" | "source" | "created_at"> & {
          id?: string;
          source?: string;
          created_at?: string;
        };
        Update: Partial<HistoricalCorpsMemberRow>;
      };
      apprenticeship_preferences: {
        Row: ApprenticeshipPreferenceRow;
        Insert: Omit<ApprenticeshipPreferenceRow, "created_at" | "updated_at"> & {
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<ApprenticeshipPreferenceRow>;
      };
      apprenticeships: {
        Row: ApprenticeshipRow;
        Insert: Omit<ApprenticeshipRow, "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<ApprenticeshipRow>;
      };
      field_name_proposals: {
        Row: FieldNameProposalRow;
        Insert: Omit<FieldNameProposalRow, "id" | "created_at" | "updated_at" | "decided_at" | "discord_channel_id" | "discord_message_id" | "discord_thread_id" | "nominee_veto_notified_at"> & {
          id?: string;
          decided_at?: string | null;
          discord_channel_id?: string | null;
          discord_message_id?: string | null;
          discord_thread_id?: string | null;
          nominee_veto_notified_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<FieldNameProposalRow>;
      };
      field_name_ballots: {
        Row: FieldNameBallotRow;
        Insert: Omit<FieldNameBallotRow, "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<FieldNameBallotRow>;
      };
      field_name_contests: {
        Row: FieldNameContestRow;
        Insert: Omit<FieldNameContestRow, "id" | "created_at" | "updated_at" | "decided_at" | "discord_channel_id" | "discord_message_id" | "discord_thread_id" | "nominee_veto_notified_at" | "closes_at"> & {
          id?: string;
          closes_at?: string | null;
          decided_at?: string | null;
          discord_channel_id?: string | null;
          discord_message_id?: string | null;
          discord_thread_id?: string | null;
          nominee_veto_notified_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<FieldNameContestRow>;
      };
      field_name_options: {
        Row: FieldNameOptionRow;
        Insert: Omit<FieldNameOptionRow, "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<FieldNameOptionRow>;
      };
      field_name_contest_votes: {
        Row: FieldNameContestVoteRow;
        Insert: Omit<FieldNameContestVoteRow, "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<FieldNameContestVoteRow>;
      };
      ranger_field_names: {
        Row: RangerFieldNameRow;
        Insert: Omit<RangerFieldNameRow, "id" | "assigned_at"> & {
          id?: string;
          assigned_at?: string;
        };
        Update: Partial<RangerFieldNameRow>;
      };
      ranger_contacts: {
        Row: RangerContactRow;
        Insert: Omit<RangerContactRow, "id" | "created_at" | "updated_at" | "archived_by_discord_user_id" | "archived_at" | "archive_reason"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
          archived_by_discord_user_id?: string | null;
          archived_at?: string | null;
          archive_reason?: string | null;
        };
        Update: Partial<RangerContactRow>;
      };
      contact_assessments: {
        Row: ContactAssessmentRow;
        Insert: Omit<ContactAssessmentRow, "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<ContactAssessmentRow>;
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
          "id" | "bulletin_channel_id" | "bulletin_message_id" | "bulletin_posted_at"
          | "author_display_name" | "source_order" | "source_alliance_report_id"
        > & {
          id?: string;
          bulletin_channel_id?: string | null;
          bulletin_message_id?: string | null;
          bulletin_posted_at?: string | null;
          author_display_name?: string | null;
          source_order?: string | null;
          source_alliance_report_id?: string | null;
        };
        Update: Partial<IntelReportRow>;
      };
      intel_trailmark_visits: {
        Row: IntelTrailmarkVisitRow;
        Insert: Omit<IntelTrailmarkVisitRow, "id"> & { id?: string };
        Update: Partial<IntelTrailmarkVisitRow>;
      };
      supply_assignments: {
        Row: SupplyAssignmentRow;
        Insert: Omit<SupplyAssignmentRow, "id" | "code" | "created_at" | "updated_at" | "completed_at"> & {
          id?: string;
          code?: string;
          created_at?: string;
          updated_at?: string;
          completed_at?: string | null;
        };
        Update: Partial<SupplyAssignmentRow>;
      };
      supply_assignment_items: {
        Row: SupplyAssignmentItemRow;
        Insert: Omit<SupplyAssignmentItemRow, "id" | "created_at"> & { id?: string; created_at?: string };
        Update: Partial<SupplyAssignmentItemRow>;
      };
      supply_contributions: {
        Row: SupplyContributionRow;
        Insert: Omit<SupplyContributionRow, "id" | "created_at"> & { id?: string; created_at?: string };
        Update: never;
      };
      supply_contribution_redistributions: {
        Row: SupplyContributionRedistributionRow;
        Insert: Omit<SupplyContributionRedistributionRow, "id" | "created_at"> & { id?: string; created_at?: string };
        Update: never;
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
        Insert: Omit<
          AllianceReportRow,
          "id" | "updated_at" | "headquarters_id" | "trailmark_message_channel_id" | "trailmark_message_id"
        > & {
          id?: string;
          updated_at?: string;
          headquarters_id?: string | null;
          trailmark_message_channel_id?: string | null;
          trailmark_message_id?: string | null;
        };
        Update: Partial<AllianceReportRow>;
      };
      alliance_report_topic_publications: {
        Row: AllianceReportTopicPublicationRow;
        Insert: Omit<AllianceReportTopicPublicationRow, "created_at" | "updated_at">;
        Update: Partial<AllianceReportTopicPublicationRow>;
      };
      alliance_headquarters: {
        Row: AllianceHeadquartersRow;
        Insert: Omit<AllianceHeadquartersRow, "id" | "created_at" | "updated_at" | "report_delivery_start_at">
          & { id?: string; report_delivery_start_at?: string };
        Update: Partial<AllianceHeadquartersRow>;
      };
      alliance_headquarters_topic_channels: {
        Row: AllianceHeadquartersTopicChannelRow;
        Insert: Omit<AllianceHeadquartersTopicChannelRow, "created_at" | "updated_at" | "active">
          & { active?: boolean; created_at?: string; updated_at?: string };
        Update: Partial<AllianceHeadquartersTopicChannelRow>;
      };
      alliance_headquarters_deliveries: {
        Row: AllianceHeadquartersDeliveryRow;
        Insert: Omit<AllianceHeadquartersDeliveryRow, "delivered_at"> & { delivered_at?: string };
        Update: Partial<AllianceHeadquartersDeliveryRow>;
      };
      alliance_headquarters_publications: {
        Row: AllianceHeadquartersPublicationRow;
        Insert: Omit<AllianceHeadquartersPublicationRow, "published_at"> & { published_at?: string };
        Update: Partial<AllianceHeadquartersPublicationRow>;
      };
    };
    Functions: {
      create_atlas_discord_link_code: {
        Args: {
          discord_user_id_input: string;
          discord_display_name_input: string;
          discord_profile_input: Json;
        };
        Returns: string;
      };
      update_atlas_discord_profile: {
        Args: {
          discord_user_id_input: string;
          discord_display_name_input: string;
          discord_profile_input: Json;
        };
        Returns: number;
      };
      set_atlas_ranger_access: {
        Args: {
          discord_user_id_input: string;
          display_name_input: string;
          active_input: boolean;
          permissions_input: string[];
          roles_input: Json;
          discord_profile_input: Json;
        };
        Returns: number;
      };
      claim_pending_atlas_trailmark_access_requests: {
        Args: { request_limit: number };
        Returns: Json;
      };
      complete_atlas_trailmark_access_request: {
        Args: {
          access_request_id: string;
          request_status: string;
          request_discord_guild_id: string | null;
          request_discord_channel_id: string | null;
          request_access_expires_at: string | null;
          request_error_message: string | null;
        };
        Returns: boolean;
      };
      claim_pending_atlas_trailmark_drops: {
        Args: { request_limit: number };
        Returns: Json;
      };
      complete_atlas_trailmark_drop: {
        Args: {
          drop_id_input: string;
          drop_status_input: string;
          discord_channel_id_input: string | null;
          discord_message_id_input: string | null;
          error_message_input: string | null;
        };
        Returns: boolean;
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
