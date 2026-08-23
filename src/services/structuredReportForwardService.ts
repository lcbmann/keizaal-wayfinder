import type { Guild } from "discord.js";
import {
  assertNoDbError,
  supabase,
  type StructuredReportContactForwardRow,
  type StructuredTrailmarkReportRow
} from "../db/supabase.js";
import { postLinkedReportToContact } from "./contactService.js";

export async function forwardDeliveredStructuredReports(params: {
  guild: Guild;
  discordMessageIds?: string[];
}): Promise<number> {
  let query = supabase
    .from("structured_trailmark_reports")
    .select("*")
    .eq("status", "Submitted")
    .order("submitted_at", { ascending: true });
  if (params.discordMessageIds?.length) {
    query = query.in("discord_message_id", params.discordMessageIds);
  }

  const { data, error } = await query.limit(500);
  assertNoDbError(error, "list structured reports awaiting contact forwarding");
  let forwarded = 0;

  for (const report of data ?? []) {
    if (!report.discord_channel_id || !report.discord_message_id || report.contact_ids.length === 0) {
      continue;
    }
    if (!await reportHasReachedCorpsHeadquarters(report)) {
      continue;
    }

    const { data: existing, error: existingError } = await supabase
      .from("structured_report_contact_forwards")
      .select("*")
      .eq("report_id", report.id);
    assertNoDbError(existingError, "list structured report contact forwards");
    const alreadyForwarded = new Set((existing ?? []).map((entry) => entry.contact_id));

    for (const contactId of report.contact_ids) {
      if (alreadyForwarded.has(contactId)) {
        continue;
      }
      try {
        const posted = await postLinkedReportToContact({
          guild: params.guild,
          contactId,
          reportTitle: report.subject ?? `${report.report_type} Report`,
          reportSummary: contactForwardSummary(report),
          sourceChannelId: report.discord_channel_id,
          sourceMessageId: report.discord_message_id,
          reporterDisplayName: report.reporter_display_name,
          submittedAt: report.submitted_at ?? report.created_at
        });
        if (!posted) {
          console.warn(`Structured report ${report.id} could not be forwarded: contact ${contactId} has no active Forum thread.`);
          continue;
        }

        const forward: StructuredReportContactForwardRow = {
          report_id: report.id,
          contact_id: contactId,
          discord_thread_id: posted.thread.id,
          discord_message_id: posted.message.id,
          forwarded_at: new Date().toISOString()
        };
        const { error: insertError } = await supabase.from("structured_report_contact_forwards").insert(forward);
        assertNoDbError(insertError, "record structured report contact forward");
        forwarded += 1;
      } catch (error) {
        console.error(`Failed to forward structured report ${report.id} to contact ${contactId}:`, error);
      }
    }
  }

  return forwarded;
}

function contactForwardSummary(report: StructuredTrailmarkReportRow): string {
  return [
    report.location ? `**Location:** ${report.location}` : null,
    report.summary,
    report.details,
    report.follow_up
  ].filter((value): value is string => Boolean(value)).join("\n\n") || "No report summary was recorded.";
}

async function reportHasReachedCorpsHeadquarters(report: StructuredTrailmarkReportRow): Promise<boolean> {
  if (!report.discord_channel_id || !report.discord_message_id) {
    return false;
  }
  const { data, error } = await supabase
    .from("intel_reports")
    .select("id")
    .eq("discord_channel_id", report.discord_channel_id)
    .eq("discord_message_id", report.discord_message_id)
    .not("delivered_at", "is", null)
    .limit(1);
  assertNoDbError(error, "check structured report HQ delivery");
  return Boolean(data?.length);
}
