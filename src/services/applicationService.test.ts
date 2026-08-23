import assert from "node:assert/strict";
import test from "node:test";
import type { CorpsDutyRow, DutyApplicationRow, RangerRow } from "../db/supabase.js";
import {
  applicationMinimumRank,
  applicationReviewMinimumRank,
  type CorpsApplicationDetails
} from "./applicationService.js";
import { applicationFormDefinition } from "./applicationFormService.js";

test("application targets enforce the intended member rank", () => {
  assert.equal(applicationMinimumRank("Craftsman"), "Apprentice");
  assert.equal(applicationMinimumRank("Courier"), "Apprentice");
  assert.equal(applicationMinimumRank("Hold Warden"), "Ranger");
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

test("leadership applications ask about loyalties and responsibilities", () => {
  for (const target of ["Ranger Marshal", "Ranger Captain"] as const) {
    const fields = applicationFormDefinition(target).fields;
    assert.equal(fields.length, 5);
    assert.ok(fields.some((field) => field.label === "Other loyalties or responsibilities"));
    assert.ok(fields.some((field) => field.label === "Availability and potential conflicts"));
  }
});

test("Warden application forms collect the correct geography", () => {
  const holdRangerFields = applicationFormDefinition("Hold Warden").fields;
  assert.ok(holdRangerFields.some((field) => field.destination === "hold"));
  assert.equal(holdRangerFields.some((field) => field.destination === "range"), false);

  const localWardenFields = applicationFormDefinition("Local Warden").fields;
  assert.ok(localWardenFields.some((field) => field.destination === "hold"));
  assert.ok(localWardenFields.some((field) => field.destination === "range"));
});

test("duty application forms use position-specific questions", () => {
  const quartermaster = applicationFormDefinition("Quartermaster").fields.map((field) => field.label);
  const agent = applicationFormDefinition("Agent").fields.map((field) => field.label);
  assert.ok(quartermaster.includes("How would you organize Corps supplies?"));
  assert.ok(agent.includes("Approach to evidence and confidentiality"));
  assert.notDeepEqual(quartermaster, agent);
});

function details(application: Pick<DutyApplicationRow, "application_kind" | "warden_scope">): CorpsApplicationDetails {
  return {
    application: application as DutyApplicationRow,
    applicant: {} as RangerRow,
    duty: {} as CorpsDutyRow
  };
}
