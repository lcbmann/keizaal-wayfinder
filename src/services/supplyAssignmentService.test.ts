import assert from "node:assert/strict";
import test from "node:test";
import { allocateRedistributionQuantities } from "./supplyAssignmentService.js";

test("weighted redistribution preserves quantity and follows contribution weights", () => {
  const allocations = allocateRedistributionQuantities(100, [
    { memberId: "one", weight: 1 },
    { memberId: "two", weight: 2 },
    { memberId: "three", weight: 1 }
  ], "weighted");

  assert.deepEqual(allocations, [
    { memberId: "one", quantity: 25 },
    { memberId: "two", quantity: 50 },
    { memberId: "three", quantity: 25 }
  ]);
});

test("even redistribution preserves quantity with deterministic remainder handling", () => {
  const allocations = allocateRedistributionQuantities(5, [
    { memberId: "one", weight: 100 },
    { memberId: "two", weight: 1 }
  ], "even");

  assert.deepEqual(allocations, [
    { memberId: "one", quantity: 3 },
    { memberId: "two", quantity: 2 }
  ]);
});
