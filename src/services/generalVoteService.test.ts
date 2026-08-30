import assert from "node:assert/strict";
import test from "node:test";
import type { GeneralVoteBallotRow, GeneralVoteOptionRow } from "../db/supabase.js";
import {
  formatGeneralChoiceResultFields,
  parseGeneralVoteChoices,
  tallyGeneralChoiceBallots,
  tallyGeneralVoteBallots
} from "./generalVoteService.js";

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

test("parses multiple-choice options with optional descriptions", () => {
  assert.deepEqual(parseGeneralVoteChoices([
    "Oak Rune | Nature-focused specialist title",
    "Rooted Stone",
    "Barkward | Emphasizes protection"
  ].join("\n")), [
    { label: "Oak Rune", description: "Nature-focused specialist title" },
    { label: "Rooted Stone", description: null },
    { label: "Barkward", description: "Emphasizes protection" }
  ]);
});

test("rejects duplicate multiple-choice options", () => {
  assert.throws(
    () => parseGeneralVoteChoices("Oak Rune\noak rune"),
    /unique name/
  );
});

test("tallies multiple-choice options and abstentions", () => {
  const options = [
    voteOption("option-a", "Oak Rune", 0),
    voteOption("option-b", "Rooted Stone", 1)
  ];
  const ballots = [
    { vote: null, option_id: "option-a" },
    { vote: null, option_id: "option-a" },
    { vote: null, option_id: "option-b" },
    { vote: "abstain", option_id: null }
  ] satisfies Array<Pick<GeneralVoteBallotRow, "vote" | "option_id">>;

  const tally = tallyGeneralChoiceBallots(options, ballots);
  assert.deepEqual(tally.options.map(({ label, count }) => ({ label, count })), [
    { label: "Oak Rune", count: 2 },
    { label: "Rooted Stone", count: 1 }
  ]);
  assert.equal(tally.abstain, 1);
});

test("formats each multiple-choice option with its description and live progress", () => {
  const options = [
    voteOption("option-a", "Oak Rune", 0, "Nature-focused specialist title"),
    voteOption("option-b", "Rooted Stone", 1, "A title centered on resilience")
  ];
  const ballots = [
    { vote: null, option_id: "option-a" },
    { vote: null, option_id: "option-a" },
    { vote: null, option_id: "option-b" },
    { vote: "abstain", option_id: null }
  ] satisfies Array<Pick<GeneralVoteBallotRow, "vote" | "option_id">>;

  const fields = formatGeneralChoiceResultFields(tallyGeneralChoiceBallots(options, ballots), "Open");
  assert.deepEqual(fields, [
    {
      name: "1. Oak Rune - Leading",
      value: "[#######---] **2 votes** (67%)\nNature-focused specialist title",
      inline: false
    },
    {
      name: "2. Rooted Stone",
      value: "[###-------] **1 vote** (33%)\nA title centered on resilience",
      inline: false
    }
  ]);
});

function voteOption(
  id: string,
  label: string,
  position: number,
  description: string | null = null
): GeneralVoteOptionRow {
  return {
    id,
    general_vote_id: "vote-id",
    label,
    description,
    position,
    created_at: "2026-08-30T00:00:00.000Z"
  };
}
