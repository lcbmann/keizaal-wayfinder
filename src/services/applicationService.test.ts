import assert from "node:assert/strict";
import test from "node:test";
import type { CorpsDutyRow, DutyApplicationRow, RangerRow } from "../db/supabase.js";
import {
  applicationMinimumRank,
  applicationReviewMinimumRank,
  type CorpsApplicationDetails
} from "./applicationService.js";

test("application targets enforce the intended member rank", () => {
  assert.equal(applicationMinimumRank("Craftsman"), "Apprentice");
  assert.equal(applicationMinimumRank("Courier"), "Apprentice");
  assert.equal(applicationMinimumRank("Ranger of a Hold"), "Ranger");
  assert.equal(applicationMinimumRank("Local Warden"), "Ranger");
  assert.equal(applicationMinimumRank("Ranger Marshal"), "Ranger");
  assert.equal(applicationMinimumRank("Ranger Captain"), "Ranger Marshal");
});

test("application review rank scales with appointment authority", () => {
  assert.equal(applicationReviewMinimumRank(details({ application_kind: "Duty", warden_scope: null })), "Ranger Marshal");
  assert.equal(applicationReviewMinimumRank(details({ application_kind: "Duty", warden_scope: "hold_primary" })), "Ranger Captain");
  assert.equal(applicationReviewMinimumRank(details({ application_kind: "Marshal", warden_scope: null })), "Ranger Captain");
  assert.equal(applicationReviewMinimumRank(details({ application_kind: "Captain", warden_scope: null })), "Ranger Commander");
});

function details(application: Pick<DutyApplicationRow, "application_kind" | "warden_scope">): CorpsApplicationDetails {
  return {
    application: application as DutyApplicationRow,
    applicant: {} as RangerRow,
    duty: {} as CorpsDutyRow
  };
}
