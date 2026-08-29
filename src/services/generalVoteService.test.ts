import assert from "node:assert/strict";
import test from "node:test";
import type { GeneralVoteBallotRow } from "../db/supabase.js";
import { tallyGeneralVoteBallots } from "./generalVoteService.js";

test("tallies Yes, No, and Abstain channel ballots", () => {
  const ballots = [
    { vote: "yes" },
    { vote: "yes" },
    { vote: "no" },
    { vote: "abstain" }
  ] satisfies Array<Pick<GeneralVoteBallotRow, "vote">>;

  assert.deepEqual(tallyGeneralVoteBallots(ballots), { yes: 2, no: 1, abstain: 1 });
});

test("returns zeroes for an empty channel vote", () => {
  assert.deepEqual(tallyGeneralVoteBallots([]), { yes: 0, no: 0, abstain: 0 });
});
