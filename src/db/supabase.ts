import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";
import type { MainRank } from "../config/ranks.js";

export type RangerStatus = "Active" | "Inactive" | "On Leave" | "Retired";
export type PromotionProgress = "In Field Trial" | "On Hold" | null;
export type PromotionVoteStatus = "Open" | "Closed" | "Approved" | "Denied";
export type BallotVote = "promote" | "hold" | "abstain";
export type GeneralVoteStatus = "Open" | "Closed";
export type GeneralVoteType = "binary" | "choice";
export type GeneralBallotVote = "yes" | "no" | "abstain";
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
export type BriefingKind = "ic" | "ooc";
export type BriefingAudience = "everyone" | "apprentice_plus" | "ranger_plus" | "marshal_plus" | "captain_plus" | "individual";
export type ManagedAssignmentStatus = "Open" | "Completed" | "Cancelled";
export type RunecloakProgramState = "Organizing" | "Registration Pending" | "Registered" | "Paused";
export type RunecloakApplicationStatus = "Submitted" | "Survey Requested" | "Survey Submitted" | "Revision Requested" | "Approved" | "Denied" | "Withdrawn";
export type RunecloakApplicationEntryPath = "standard" | "marshal_direct";
export type RunecloakRegionalSlot = "EU" | "NA" | "Flexible";
export type RunecloakResearchSiteStatus = "Draft" | "Proposed" | "Revision Requested" | "Approved" | "Rejected" | "Retired";
export type RunecloakCycleStatus = "Draft" | "Awaiting Moonshadow Start" | "Active" | "Awaiting GM Approval" | "Completed" | "Cancelled";
export type RunecloakCycleMemberStatus = "Selected" | "Active" | "Withdrawn" | "Ineligible" | "Eligible for Delivery" | "Completed" | "Study Incomplete";
export type RunecloakMembershipStatus = "Learner" | "Qualified" | "Withdrawn" | "Ineligible";
export type RunecloakStageStatus = "Draft" | "Open" | "Ready for Review" | "Valid" | "Invalid";
export type RunecloakSessionStatus = "Planned" | "Submitted" | "Verified" | "Cancelled";
export type RunecloakParticipationKind = "learner" | "support" | "observer";
export type RunecloakParticipationStatus = "provisional" | "verified" | "rejected";
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
  patrol_anchor_trailmark_id: string | null;
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

export interface GeneralVoteRow {
  id: string;
  guild_id: string;
  channel_id: string;
  message_id: string | null;
  thread_id: string | null;
  question: string;
  context: string | null;
  vote_type: GeneralVoteType;
  status: GeneralVoteStatus;
  opened_by_discord_user_id: string;
  closed_by_discord_user_id: string | null;
  created_at: string;
  closed_at: string | null;
}

export interface GeneralVoteBallotRow {
  id: string;
  general_vote_id: string;
  voter_discord_user_id: string;
  vote: GeneralBallotVote | null;
  option_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface GeneralVoteOptionRow {
  id: string;
  general_vote_id: string;
  label: string;
  description: string | null;
  position: number;
  created_at: string;
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
  source_type: "medal_award" | "promotion" | "qualification";
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

export interface ContactGroupMembershipRow {
  group_contact_id: string;
  member_contact_id: string;
  created_by_discord_user_id: string;
  created_at: string;
}

export interface BriefingDispatchRow {
  id: string;
  guild_id: string;
  kind: BriefingKind;
  audience: BriefingAudience;
  target_discord_user_id: string | null;
  title: string;
  body: string;
  source_kind: string | null;
  source_id: string | null;
  source_url: string | null;
  author_discord_user_id: string | null;
  created_at: string;
}

export interface BriefingUserSettingsRow {
  guild_id: string;
  discord_user_id: string;
  dm_enabled: boolean;
  last_collected_at: string | null;
  updated_at: string;
}

export interface ManagedAssignmentRow {
  id: string;
  guild_id: string;
  forum_channel_id: string;
  thread_id: string | null;
  starter_message_id: string | null;
  title: string;
  objective: string;
  details: string | null;
  location: string;
  hold: string | null;
  timing: string | null;
  minimum_rank: "Apprentice" | "Ranger";
  organizer_discord_user_id: string;
  status: ManagedAssignmentStatus;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface ManagedAssignmentParticipantRow {
  assignment_id: string;
  discord_user_id: string;
  joined_at: string;
}

export interface CorpsQualificationRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  emoji: string | null;
  discord_role_id: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RunecloakSettingsRow {
  guild_id: string;
  category_id: string;
  desk_channel_id: string;
  application_review_channel_id: string;
  runecloak_channel_id: string;
  learner_channel_id: string;
  expedition_forum_id: string;
  dashboard_message_id: string | null;
  guide_role_id: string;
  learner_role_id: string;
  qualification_role_id: string;
  admissions_open: boolean;
  program_state: RunecloakProgramState;
  registration_reference: string | null;
  registration_confirmed_by_discord_user_id: string | null;
  registration_confirmed_at: string | null;
  minimum_roster_size: number;
  quorum_percent: number;
  point_target: number;
  personal_point_requirement: number;
  personal_stage_requirement: number;
  regional_cooldown_hours: number;
  configured_by_discord_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface RunecloakTeamAssignmentRow {
  id: string;
  ranger_id: string;
  assignment_kind: "guide";
  active: boolean;
  assigned_by_discord_user_id: string;
  assigned_at: string;
  ended_by_discord_user_id: string | null;
  ended_at: string | null;
  end_reason: string | null;
}

export interface RunecloakApplicationRow {
  id: string;
  applicant_ranger_id: string;
  rank_snapshot: MainRank;
  entry_path: RunecloakApplicationEntryPath;
  initial_screening_skipped: boolean;
  preferred_regional_slot: RunecloakRegionalSlot | null;
  status: RunecloakApplicationStatus;
  reason: string | null;
  experience: string | null;
  availability: string | null;
  loyalties_conflicts: string | null;
  review_note: string | null;
  reviewed_by_discord_user_id: string | null;
  reviewed_at: string | null;
  review_channel_id: string | null;
  review_message_id: string | null;
  review_thread_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RunecloakResearchSiteRow {
  id: string;
  application_id: string;
  ranger_id: string;
  name: string;
  hold_region: string;
  atlas_reference: string;
  structured_report_id: string | null;
  research_rationale: string;
  screenshot_url: string | null;
  status: RunecloakResearchSiteStatus;
  review_note: string | null;
  reviewed_by_discord_user_id: string | null;
  reviewed_at: string | null;
  forum_thread_id: string | null;
  forum_message_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RunecloakSpellRow {
  id: string;
  slug: string;
  name: string;
  sequence: number;
  prerequisite_spell_id: string | null;
  study_summary: string;
  default_target_points: number;
  active: boolean;
  external_approval_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface RunecloakCycleRow {
  id: string;
  guild_id: string;
  spell_id: string;
  label: string;
  sequence: number;
  status: RunecloakCycleStatus;
  minimum_roster_size: number;
  quorum_percent: number;
  point_target: number;
  start_reference: string | null;
  started_by_discord_user_id: string | null;
  started_at: string | null;
  gm_approval_reference: string | null;
  gm_approval_recorded_by_discord_user_id: string | null;
  gm_approval_recorded_at: string | null;
  verified_points: number;
  enrollment_remains_open: boolean;
  created_by_discord_user_id: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface RunecloakCycleMemberRow {
  id: string;
  cycle_id: string;
  ranger_id: string;
  application_id: string | null;
  membership_id: string | null;
  rank_snapshot: MainRank | null;
  status_snapshot: RangerStatus | null;
  participation_status: RunecloakCycleMemberStatus;
  selected_by_discord_user_id: string;
  selected_at: string;
  status_reason: string | null;
  status_changed_by_discord_user_id: string | null;
  status_changed_at: string | null;
  final_valid_stages_attended: number | null;
  final_required_attendance: number | null;
  final_contributed_points: number;
  final_result: string | null;
  spell_delivered_at: string | null;
}

export interface RunecloakSpellProgressRow {
  ranger_id: string;
  spell_id: string;
  required_points: number;
  required_valid_stages: number;
  verified_points: number;
  verified_valid_stages: number;
  status: "in_progress" | "eligible" | "completed";
  completion_cycle_id: string | null;
  unlock_id: string | null;
  delivery_reference: string | null;
  delivery_recorded_by_discord_user_id: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RunecloakStageRow {
  id: string;
  cycle_id: string;
  sequence: number;
  title: string;
  theme: string;
  notes: string | null;
  status: RunecloakStageStatus;
  eligible_learner_count: number;
  required_unique_attendance: number;
  actual_unique_attendance: number;
  verified_points: number;
  validated_by_discord_user_id: string | null;
  validated_at: string | null;
  validation_reason: string | null;
  forum_thread_id: string | null;
  forum_message_id: string | null;
  created_by_discord_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface RunecloakSessionRow {
  id: string;
  stage_id: string;
  regional_slot: "EU" | "NA";
  planned_at: string | null;
  actual_at: string | null;
  regional_cooldown_ends_at: string | null;
  research_site_id: string | null;
  leader_discord_user_id: string | null;
  lesson_summary: string | null;
  study_method: string | null;
  recording_url: string | null;
  moonshadow_reference: string | null;
  status: RunecloakSessionStatus;
  logged_by_discord_user_id: string | null;
  verified_by_discord_user_id: string | null;
  verification_basis: "present" | "recording_review" | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RunecloakSessionParticipationRow {
  id: string;
  stage_id: string;
  session_id: string;
  ranger_id: string;
  study_spell_id: string | null;
  participation_kind: RunecloakParticipationKind;
  status: RunecloakParticipationStatus;
  roll_value: number | null;
  evidence_url: string | null;
  submitted_by_discord_user_id: string;
  submitted_at: string;
  verified_by_discord_user_id: string | null;
  verified_at: string | null;
  correction_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface RunecloakMembershipRow {
  id: string;
  guild_id: string;
  ranger_id: string;
  application_id: string | null;
  status: RunecloakMembershipStatus;
  preferred_regional_slot: RunecloakRegionalSlot | null;
  admitted_by_discord_user_id: string;
  admitted_at: string;
  status_reason: string | null;
  status_changed_by_discord_user_id: string | null;
  status_changed_at: string | null;
  first_qualified_spell_id: string | null;
  first_qualified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RunecloakStageEligibleLearnerRow {
  stage_id: string;
  ranger_id: string;
  membership_id: string;
  rank_snapshot: MainRank;
  ranger_status_snapshot: RangerStatus;
  membership_status_snapshot: "Learner" | "Qualified";
  captured_at: string;
}

export interface RunecloakSpellUnlockRow {
  id: string;
  guild_id: string;
  spell_id: string;
  source_cycle_id: string;
  unlock_reference: string;
  unlocked_by_discord_user_id: string;
  unlocked_at: string;
  notes: string | null;
  created_at: string;
}

export interface RunecloakPersonalStudyCreditRow {
  id: string;
  ranger_id: string;
  spell_id: string;
  stage_id: string;
  participation_id: string;
  verified_points: number;
  verified_by_discord_user_id: string;
  verified_at: string;
  created_at: string;
}

export interface RangerQualificationRow {
  id: string;
  qualification_id: string;
  ranger_id: string;
  source_cycle_id: string | null;
  awarded_by_discord_user_id: string;
  awarded_at: string;
  revoked_by_discord_user_id: string | null;
  revoked_at: string | null;
  revocation_reason: string | null;
}

export interface RunecloakAuditEventRow {
  id: string;
  guild_id: string;
  entity_type: string;
  entity_id: string | null;
  action: string;
  actor_discord_user_id: string;
  reason: string | null;
  before_snapshot: Json;
  after_snapshot: Json;
  source_url: string | null;
  created_at: string;
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
        Insert: Omit<TrailmarkRow, "id" | "created_at" | "updated_at" | "patrol_anchor_trailmark_id">
          & { patrol_anchor_trailmark_id?: string | null };
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
      general_votes: {
        Row: GeneralVoteRow;
        Insert: Omit<GeneralVoteRow, "id" | "created_at" | "closed_at"> & {
          closed_at?: string | null;
        };
        Update: Partial<GeneralVoteRow>;
      };
      general_vote_ballots: {
        Row: GeneralVoteBallotRow;
        Insert: Omit<GeneralVoteBallotRow, "id" | "created_at" | "updated_at">;
        Update: Partial<GeneralVoteBallotRow>;
      };
      general_vote_options: {
        Row: GeneralVoteOptionRow;
        Insert: Omit<GeneralVoteOptionRow, "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<GeneralVoteOptionRow>;
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
      contact_group_memberships: {
        Row: ContactGroupMembershipRow;
        Insert: Omit<ContactGroupMembershipRow, "created_at"> & {
          created_at?: string;
        };
        Update: never;
      };
      briefing_dispatches: {
        Row: BriefingDispatchRow;
        Insert: Omit<BriefingDispatchRow, "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<BriefingDispatchRow>;
      };
      briefing_user_settings: {
        Row: BriefingUserSettingsRow;
        Insert: Omit<BriefingUserSettingsRow, "updated_at"> & { updated_at?: string };
        Update: Partial<BriefingUserSettingsRow>;
      };
      managed_assignments: {
        Row: ManagedAssignmentRow;
        Insert: Omit<ManagedAssignmentRow, "id" | "created_at" | "updated_at" | "completed_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
          completed_at?: string | null;
        };
        Update: Partial<ManagedAssignmentRow>;
      };
      managed_assignment_participants: {
        Row: ManagedAssignmentParticipantRow;
        Insert: Omit<ManagedAssignmentParticipantRow, "joined_at"> & { joined_at?: string };
        Update: never;
      };
      corps_qualifications: {
        Row: CorpsQualificationRow;
        Insert: Omit<CorpsQualificationRow, "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<CorpsQualificationRow>;
      };
      runecloak_settings: {
        Row: RunecloakSettingsRow;
        Insert: Omit<RunecloakSettingsRow, "dashboard_message_id" | "admissions_open" | "program_state" | "registration_reference" | "registration_confirmed_by_discord_user_id" | "registration_confirmed_at" | "minimum_roster_size" | "quorum_percent" | "point_target" | "personal_point_requirement" | "personal_stage_requirement" | "regional_cooldown_hours" | "created_at" | "updated_at"> & Partial<Pick<RunecloakSettingsRow, "dashboard_message_id" | "admissions_open" | "program_state" | "registration_reference" | "registration_confirmed_by_discord_user_id" | "registration_confirmed_at" | "minimum_roster_size" | "quorum_percent" | "point_target" | "personal_point_requirement" | "personal_stage_requirement" | "regional_cooldown_hours" | "created_at" | "updated_at">>;
        Update: Partial<RunecloakSettingsRow>;
      };
      runecloak_team_assignments: {
        Row: RunecloakTeamAssignmentRow;
        Insert: Omit<RunecloakTeamAssignmentRow, "id" | "active" | "assigned_at" | "ended_by_discord_user_id" | "ended_at" | "end_reason"> & Partial<Pick<RunecloakTeamAssignmentRow, "id" | "active" | "assigned_at" | "ended_by_discord_user_id" | "ended_at" | "end_reason">>;
        Update: Partial<RunecloakTeamAssignmentRow>;
      };
      runecloak_applications: {
        Row: RunecloakApplicationRow;
        Insert: Omit<RunecloakApplicationRow, "id" | "entry_path" | "initial_screening_skipped" | "preferred_regional_slot" | "status" | "review_note" | "reviewed_by_discord_user_id" | "reviewed_at" | "review_channel_id" | "review_message_id" | "review_thread_id" | "created_at" | "updated_at"> & Partial<Pick<RunecloakApplicationRow, "id" | "entry_path" | "initial_screening_skipped" | "preferred_regional_slot" | "status" | "review_note" | "reviewed_by_discord_user_id" | "reviewed_at" | "review_channel_id" | "review_message_id" | "review_thread_id" | "created_at" | "updated_at">>;
        Update: Partial<RunecloakApplicationRow>;
      };
      runecloak_research_sites: {
        Row: RunecloakResearchSiteRow;
        Insert: Omit<RunecloakResearchSiteRow, "id" | "structured_report_id" | "screenshot_url" | "status" | "review_note" | "reviewed_by_discord_user_id" | "reviewed_at" | "forum_thread_id" | "forum_message_id" | "created_at" | "updated_at"> & Partial<Pick<RunecloakResearchSiteRow, "id" | "structured_report_id" | "screenshot_url" | "status" | "review_note" | "reviewed_by_discord_user_id" | "reviewed_at" | "forum_thread_id" | "forum_message_id" | "created_at" | "updated_at">>;
        Update: Partial<RunecloakResearchSiteRow>;
      };
      runecloak_spells: {
        Row: RunecloakSpellRow;
        Insert: Omit<RunecloakSpellRow, "id" | "prerequisite_spell_id" | "default_target_points" | "active" | "external_approval_note" | "created_at" | "updated_at"> & Partial<Pick<RunecloakSpellRow, "id" | "prerequisite_spell_id" | "default_target_points" | "active" | "external_approval_note" | "created_at" | "updated_at">>;
        Update: Partial<RunecloakSpellRow>;
      };
      runecloak_cycles: {
        Row: RunecloakCycleRow;
        Insert: Omit<RunecloakCycleRow, "id" | "status" | "start_reference" | "started_by_discord_user_id" | "started_at" | "gm_approval_reference" | "gm_approval_recorded_by_discord_user_id" | "gm_approval_recorded_at" | "verified_points" | "enrollment_remains_open" | "created_at" | "updated_at" | "completed_at"> & Partial<Pick<RunecloakCycleRow, "id" | "status" | "start_reference" | "started_by_discord_user_id" | "started_at" | "gm_approval_reference" | "gm_approval_recorded_by_discord_user_id" | "gm_approval_recorded_at" | "verified_points" | "enrollment_remains_open" | "created_at" | "updated_at" | "completed_at">>;
        Update: Partial<RunecloakCycleRow>;
      };
      runecloak_memberships: {
        Row: RunecloakMembershipRow;
        Insert: Omit<RunecloakMembershipRow, "id" | "status" | "preferred_regional_slot" | "admitted_at" | "status_reason" | "status_changed_by_discord_user_id" | "status_changed_at" | "first_qualified_spell_id" | "first_qualified_at" | "created_at" | "updated_at"> & Partial<Pick<RunecloakMembershipRow, "id" | "status" | "preferred_regional_slot" | "admitted_at" | "status_reason" | "status_changed_by_discord_user_id" | "status_changed_at" | "first_qualified_spell_id" | "first_qualified_at" | "created_at" | "updated_at">>;
        Update: Partial<RunecloakMembershipRow>;
      };
      runecloak_cycle_members: {
        Row: RunecloakCycleMemberRow;
        Insert: Omit<RunecloakCycleMemberRow, "id" | "rank_snapshot" | "status_snapshot" | "participation_status" | "selected_at" | "status_reason" | "status_changed_by_discord_user_id" | "status_changed_at" | "final_valid_stages_attended" | "final_required_attendance" | "final_contributed_points" | "final_result" | "spell_delivered_at"> & Partial<Pick<RunecloakCycleMemberRow, "id" | "rank_snapshot" | "status_snapshot" | "participation_status" | "selected_at" | "status_reason" | "status_changed_by_discord_user_id" | "status_changed_at" | "final_valid_stages_attended" | "final_required_attendance" | "final_contributed_points" | "final_result" | "spell_delivered_at">>;
        Update: Partial<RunecloakCycleMemberRow>;
      };
      runecloak_spell_progress: {
        Row: RunecloakSpellProgressRow;
        Insert: Omit<RunecloakSpellProgressRow, "required_points" | "required_valid_stages" | "verified_points" | "verified_valid_stages" | "status" | "completion_cycle_id" | "unlock_id" | "delivery_reference" | "delivery_recorded_by_discord_user_id" | "delivered_at" | "created_at" | "updated_at"> & Partial<Pick<RunecloakSpellProgressRow, "required_points" | "required_valid_stages" | "verified_points" | "verified_valid_stages" | "status" | "completion_cycle_id" | "unlock_id" | "delivery_reference" | "delivery_recorded_by_discord_user_id" | "delivered_at" | "created_at" | "updated_at">>;
        Update: Partial<RunecloakSpellProgressRow>;
      };
      runecloak_stages: {
        Row: RunecloakStageRow;
        Insert: Omit<RunecloakStageRow, "id" | "notes" | "status" | "eligible_learner_count" | "required_unique_attendance" | "actual_unique_attendance" | "verified_points" | "validated_by_discord_user_id" | "validated_at" | "validation_reason" | "forum_thread_id" | "forum_message_id" | "created_at" | "updated_at"> & Partial<Pick<RunecloakStageRow, "id" | "notes" | "status" | "eligible_learner_count" | "required_unique_attendance" | "actual_unique_attendance" | "verified_points" | "validated_by_discord_user_id" | "validated_at" | "validation_reason" | "forum_thread_id" | "forum_message_id" | "created_at" | "updated_at">>;
        Update: Partial<RunecloakStageRow>;
      };
      runecloak_sessions: {
        Row: RunecloakSessionRow;
        Insert: Omit<RunecloakSessionRow, "id" | "planned_at" | "actual_at" | "regional_cooldown_ends_at" | "research_site_id" | "leader_discord_user_id" | "lesson_summary" | "study_method" | "recording_url" | "moonshadow_reference" | "status" | "logged_by_discord_user_id" | "verified_by_discord_user_id" | "verification_basis" | "verified_at" | "created_at" | "updated_at"> & Partial<Pick<RunecloakSessionRow, "id" | "planned_at" | "actual_at" | "regional_cooldown_ends_at" | "research_site_id" | "leader_discord_user_id" | "lesson_summary" | "study_method" | "recording_url" | "moonshadow_reference" | "status" | "logged_by_discord_user_id" | "verified_by_discord_user_id" | "verification_basis" | "verified_at" | "created_at" | "updated_at">>;
        Update: Partial<RunecloakSessionRow>;
      };
      runecloak_session_participation: {
        Row: RunecloakSessionParticipationRow;
        Insert: Omit<RunecloakSessionParticipationRow, "id" | "study_spell_id" | "participation_kind" | "status" | "roll_value" | "evidence_url" | "submitted_at" | "verified_by_discord_user_id" | "verified_at" | "correction_note" | "created_at" | "updated_at"> & Partial<Pick<RunecloakSessionParticipationRow, "id" | "study_spell_id" | "participation_kind" | "status" | "roll_value" | "evidence_url" | "submitted_at" | "verified_by_discord_user_id" | "verified_at" | "correction_note" | "created_at" | "updated_at">>;
        Update: Partial<RunecloakSessionParticipationRow>;
      };
      runecloak_stage_eligible_learners: {
        Row: RunecloakStageEligibleLearnerRow;
        Insert: Omit<RunecloakStageEligibleLearnerRow, "captured_at"> & { captured_at?: string };
        Update: never;
      };
      runecloak_spell_unlocks: {
        Row: RunecloakSpellUnlockRow;
        Insert: Omit<RunecloakSpellUnlockRow, "id" | "unlocked_at" | "notes" | "created_at"> & Partial<Pick<RunecloakSpellUnlockRow, "id" | "unlocked_at" | "notes" | "created_at">>;
        Update: Partial<RunecloakSpellUnlockRow>;
      };
      runecloak_personal_study_credits: {
        Row: RunecloakPersonalStudyCreditRow;
        Insert: Omit<RunecloakPersonalStudyCreditRow, "id" | "verified_at" | "created_at"> & Partial<Pick<RunecloakPersonalStudyCreditRow, "id" | "verified_at" | "created_at">>;
        Update: never;
      };
      ranger_qualifications: {
        Row: RangerQualificationRow;
        Insert: Omit<RangerQualificationRow, "id" | "awarded_at" | "revoked_by_discord_user_id" | "revoked_at" | "revocation_reason"> & Partial<Pick<RangerQualificationRow, "id" | "awarded_at" | "revoked_by_discord_user_id" | "revoked_at" | "revocation_reason">>;
        Update: Partial<RangerQualificationRow>;
      };
      runecloak_audit_events: {
        Row: RunecloakAuditEventRow;
        Insert: Omit<RunecloakAuditEventRow, "id" | "reason" | "before_snapshot" | "after_snapshot" | "source_url" | "created_at"> & Partial<Pick<RunecloakAuditEventRow, "id" | "reason" | "before_snapshot" | "after_snapshot" | "source_url" | "created_at">>;
        Update: never;
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
      set_atlas_discord_presence_summary: {
        Args: {
          online_count_input: number;
          playing_skyrim_count_input: number;
        };
        Returns: undefined;
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
      prepare_runecloak_cycle: {
        Args: {
          cycle_id_input: string;
          actor_discord_user_id_input: string;
        };
        Returns: Json;
      };
      approve_runecloak_admission: {
        Args: {
          guild_id_input: string;
          application_id_input: string;
          actor_discord_user_id_input: string;
          note_input?: string | null;
        };
        Returns: Json;
      };
      open_runecloak_stage: {
        Args: {
          stage_id_input: string;
          actor_discord_user_id_input: string;
        };
        Returns: Json;
      };
      create_runecloak_stage: {
        Args: {
          cycle_id_input: string;
          title_input: string;
          theme_input: string;
          eu_planned_at_input: string | null;
          na_planned_at_input: string | null;
          notes_input: string | null;
          actor_discord_user_id_input: string;
        };
        Returns: Json;
      };
      submit_runecloak_session: {
        Args: {
          guild_id_input: string;
          session_id_input: string;
          actual_at_input: string;
          research_site_id_input: string;
          leader_discord_user_id_input: string;
          lesson_summary_input: string;
          study_method_input: string;
          recording_url_input: string;
          moonshadow_reference_input: string | null;
          actor_discord_user_id_input: string;
        };
        Returns: Json;
      };
      verify_runecloak_session: {
        Args: {
          session_id_input: string;
          actor_discord_user_id_input: string;
          verification_basis_input: "present" | "recording_review";
        };
        Returns: Json;
      };
      verify_runecloak_stage: {
        Args: {
          stage_id_input: string;
          actor_discord_user_id_input: string;
          reason_input?: string | null;
        };
        Returns: Json;
      };
      complete_runecloak_cycle: {
        Args: {
          cycle_id_input: string;
          actor_discord_user_id_input: string;
          gm_approval_reference_input: string;
        };
        Returns: Json;
      };
      record_runecloak_spell_delivery: {
        Args: {
          guild_id_input: string;
          ranger_id_input: string;
          spell_id_input: string;
          delivery_reference_input: string;
          actor_discord_user_id_input: string;
        };
        Returns: Json;
      };
      set_runecloak_cycle_member_status: {
        Args: {
          guild_id_input: string;
          cycle_id_input: string;
          ranger_id_input: string;
          status_input: "Withdrawn" | "Ineligible";
          reason_input: string;
          actor_discord_user_id_input: string;
        };
        Returns: Json;
      };
      runecloak_regional_slot_available_at: {
        Args: {
          guild_id_input: string;
          regional_slot_input: "EU" | "NA";
          exclude_session_id_input?: string | null;
        };
        Returns: string | null;
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
