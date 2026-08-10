import assert from "node:assert/strict";
import test from "node:test";
import { isAssignmentsBoardEmbedTitle } from "./assignmentBoardService.js";

test("recognizes only assignment board embed titles for duplicate cleanup", () => {
  assert.equal(isAssignmentsBoardEmbedTitle("<:warden:123> - Ranger Corps Wardens"), true);
  assert.equal(isAssignmentsBoardEmbedTitle("<:agent:456> - Ranger Corps Agents"), true);
  assert.equal(isAssignmentsBoardEmbedTitle("Ranger Corps Apprenticeships"), true);
  assert.equal(isAssignmentsBoardEmbedTitle("Corps Honors Record"), false);
  assert.equal(isAssignmentsBoardEmbedTitle("Ranger Corps Wardens discussion"), false);
  assert.equal(isAssignmentsBoardEmbedTitle(null), false);
});
