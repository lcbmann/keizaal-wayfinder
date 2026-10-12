import type { Guild } from "discord.js";
import { cleanupApprenticeshipRecords } from "../services/apprenticeshipService.js";
import { refreshStoredAssignmentsBoard } from "../services/assignmentBoardService.js";

export function startApprenticeshipCleanupJob(guild: Guild): NodeJS.Timeout {
  let running = false;
  const cleanup = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      const removed = await cleanupApprenticeshipRecords(guild);
      if (removed > 0) {
        await refreshStoredAssignmentsBoard(guild);
        console.log(`Removed ${removed} stale apprenticeship records.`);
      }
    } catch (error) {
      console.warn("Failed to clean up apprenticeship records:", error);
    } finally {
      running = false;
    }
  };
  void cleanup();
  return setInterval(() => void cleanup(), 60 * 60 * 1000);
}
