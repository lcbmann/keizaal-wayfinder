import assert from "node:assert/strict";
import test from "node:test";
import { isAssignmentsBoardEmbedTitle } from "./assignmentBoardService.js";

test("recognizes only assignment board embed titles for duplicate cleanup", () => {
  assert.equal(isAssignmentsBoardEmbedTitle("<:rangercommander:123> - Leadership"), true);
  assert.equal(isAssignmentsBoardEmbedTitle("<:quartermaster:123> - Quartermasters"), true);
  assert.equal(isAssignmentsBoardEmbedTitle("<:warden:123> - Hold Wardens"), true);
  assert.equal(isAssignmentsBoardEmbedTitle("<:ambassador:123> - Ambassadors"), true);
  assert.equal(isAssignmentsBoardEmbedTitle("<:agent:456> - Agents"), true);
  assert.equal(isAssignmentsBoardEmbedTitle("<:apprentice:123> - Apprenticeships"), true);
  assert.equal(isAssignmentsBoardEmbedTitle("<:warden:123> - Ranger Corps Wardens"), true);
  assert.equal(isAssignmentsBoardEmbedTitle("<:warden:123> - Rangers of the Holds"), true);
  assert.equal(isAssignmentsBoardEmbedTitle("<:warden:123> - Local Wardens"), true);
  assert.equal(isAssignmentsBoardEmbedTitle("<:instructor:123> - Instructors"), true);
  assert.equal(isAssignmentsBoardEmbedTitle("<:agent:456> - Ranger Corps Agents"), true);
  assert.equal(isAssignmentsBoardEmbedTitle("Ranger Corps Apprenticeships"), true);
  assert.equal(isAssignmentsBoardEmbedTitle("Corps Honors Record"), false);
  assert.equal(isAssignmentsBoardEmbedTitle("Ranger Corps Wardens discussion"), false);
  assert.equal(isAssignmentsBoardEmbedTitle("Leadership discussion"), false);
  assert.equal(isAssignmentsBoardEmbedTitle("Senior Leadership"), false);
  assert.equal(isAssignmentsBoardEmbedTitle(null), false);
});
