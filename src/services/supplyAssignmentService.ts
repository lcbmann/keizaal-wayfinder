import { ChannelType, EmbedBuilder, type Guild, type Message, type TextChannel } from "discord.js";
import {
  assertNoDbError,
  supabase,
  type SupplyAssignmentItemRow,
  type SupplyAssignmentRow,
  type SupplyAssignmentStatus,
  type SupplyContributionRow
} from "../db/supabase.js";
import { UserFacingError } from "../utils/errors.js";

interface SupplySnapshot {
  assignment: SupplyAssignmentRow;
  items: SupplyAssignmentItemRow[];
  contributions: SupplyContributionRow[];
}

export async function createSupplyAssignment(params: {
  channel: TextChannel;
  name: string;
  clientName: string;
  salePricePerItem: number;
  rangerRatePerItem: number;
  organizerDiscordUserId?: string | null;
  notes?: string | null;
  createdByDiscordUserId: string;
  items: Array<{ name: string; targetQuantity: number }>;
}): Promise<SupplyAssignmentRow> {
  const { data: assignment, error } = await supabase.from("supply_assignments").insert({
    name: params.name,
    client_name: params.clientName,
    status: "Active",
    sale_price_per_item: params.salePricePerItem,
    ranger_rate_per_item: params.rangerRatePerItem,
    organizer_discord_user_id: params.organizerDiscordUserId ?? null,
    notes: params.notes ?? null,
    created_by_discord_user_id: params.createdByDiscordUserId,
    discord_channel_id: null,
    discord_message_id: null
  }).select("*").single();
  assertNoDbError(error, "create supply assignment");

  const { error: itemsError } = await supabase.from("supply_assignment_items").insert(
    params.items.map((item, sortOrder) => ({
      assignment_id: assignment.id,
      item_name: item.name,
      target_quantity: item.targetQuantity,
      sort_order: sortOrder
    }))
  );
  if (itemsError) {
    await supabase.from("supply_assignments").delete().eq("id", assignment.id);
    assertNoDbError(itemsError, "create supply assignment items");
  }

  try {
    return await publishSupplyBoard(params.channel.guild, assignment.id, params.channel);
  } catch (publishError) {
    await supabase.from("supply_assignments").delete().eq("id", assignment.id);
    throw publishError;
  }
}

export async function logSupplyContribution(params: {
  guild: Guild;
  assignmentCode: string;
  itemName: string;
  quantity: number;
  memberDiscordUserId: string;
  loggedByDiscordUserId: string;
  note?: string | null;
}): Promise<{ assignment: SupplyAssignmentRow; item: SupplyAssignmentItemRow }> {
  const snapshot = await requireSupplySnapshot(params.assignmentCode);
  if (snapshot.assignment.status !== "Active") {
    throw new UserFacingError(`Supply assignment ${snapshot.assignment.code} is ${snapshot.assignment.status.toLowerCase()}.`);
  }
  const item = findItem(snapshot.items, params.itemName);
  if (!item) {
    throw new UserFacingError(`Item not found. Available items: ${snapshot.items.map((entry) => entry.item_name).join(", ")}.`);
  }

  const { error } = await supabase.from("supply_contributions").insert({
    assignment_id: snapshot.assignment.id,
    item_id: item.id,
    member_discord_user_id: params.memberDiscordUserId,
    quantity: params.quantity,
    note: params.note ?? null,
    logged_by_discord_user_id: params.loggedByDiscordUserId
  });
  if (error) {
    if (error.message.includes("exceeds the remaining item quota")) {
      throw new UserFacingError(error.message.replace(/^.*?:\s*/u, ""));
    }
    if (error.message.includes("not active")) {
      throw new UserFacingError("That supply assignment is no longer active.");
    }
    assertNoDbError(error, "log supply contribution");
  }

  await completeIfQuotaReached(snapshot.assignment.id);
  return { assignment: await publishSupplyBoard(params.guild, snapshot.assignment.id), item };
}

export async function undoLatestSupplyContribution(params: {
  guild: Guild;
  assignmentCode: string;
  memberDiscordUserId: string;
}): Promise<{ contribution: SupplyContributionRow; item: SupplyAssignmentItemRow } | null> {
  const snapshot = await requireSupplySnapshot(params.assignmentCode);
  const { data: contribution, error } = await supabase.from("supply_contributions")
    .select("*")
    .eq("assignment_id", snapshot.assignment.id)
    .eq("member_discord_user_id", params.memberDiscordUserId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  assertNoDbError(error, "get latest supply contribution");
  if (!contribution) {
    return null;
  }

  const { error: deleteError } = await supabase.from("supply_contributions").delete().eq("id", contribution.id);
  assertNoDbError(deleteError, "undo supply contribution");
  if (snapshot.assignment.status === "Completed") {
    const { error: reopenError } = await supabase.from("supply_assignments").update({
      status: "Active",
      completed_at: null
    }).eq("id", snapshot.assignment.id);
    assertNoDbError(reopenError, "reopen supply assignment after undo");
  }
  await publishSupplyBoard(params.guild, snapshot.assignment.id);
  return { contribution, item: snapshot.items.find((item) => item.id === contribution.item_id)! };
}

export async function setSupplyAssignmentStatus(params: {
  guild: Guild;
  assignmentCode: string;
  status: SupplyAssignmentStatus;
}): Promise<SupplyAssignmentRow> {
  const assignment = await requireSupplyAssignment(params.assignmentCode);
  const { error } = await supabase.from("supply_assignments").update({
    status: params.status,
    completed_at: params.status === "Completed" ? new Date().toISOString() : null
  }).eq("id", assignment.id);
  assertNoDbError(error, "update supply assignment status");
  return publishSupplyBoard(params.guild, assignment.id);
}

export async function refreshSupplyAssignmentBoard(guild: Guild, assignmentCode: string): Promise<SupplyAssignmentRow> {
  const assignment = await requireSupplyAssignment(assignmentCode);
  return publishSupplyBoard(guild, assignment.id);
}

export async function supplyAssignmentEmbed(assignmentCode: string): Promise<EmbedBuilder> {
  return buildSupplyBoardEmbed(await requireSupplySnapshot(assignmentCode));
}

export async function supplyContributorsEmbed(assignmentCode: string): Promise<EmbedBuilder> {
  const snapshot = await requireSupplySnapshot(assignmentCode);
  const totals = contributorTotals(snapshot.contributions, snapshot.assignment.ranger_rate_per_item);
  return new EmbedBuilder()
    .setTitle(`${snapshot.assignment.name} Contributors`)
    .setDescription(totals.length
      ? totals.slice(0, 40).map((entry, index) =>
          `${index + 1}. <@${entry.memberId}> - ${formatNumber(entry.quantity)} items - ${formatSeptims(entry.owed)}`
        ).join("\n").slice(0, 4096)
      : "No contributions logged yet.")
    .setColor(0x587c4a)
    .setFooter({ text: snapshot.assignment.code })
    .setTimestamp(new Date());
}

export async function listSupplyAssignments(search = "", limit = 25): Promise<SupplyAssignmentRow[]> {
  const { data, error } = await supabase.from("supply_assignments").select("*").order("created_at", { ascending: false }).limit(100);
  assertNoDbError(error, "list supply assignments");
  const query = search.trim().toLocaleLowerCase();
  return (data ?? []).filter((assignment) => !query
    || assignment.code.toLocaleLowerCase().includes(query)
    || assignment.name.toLocaleLowerCase().includes(query)).slice(0, limit);
}

export async function listSupplyAssignmentItems(assignmentCode: string): Promise<SupplyAssignmentItemRow[]> {
  const assignment = await requireSupplyAssignment(assignmentCode);
  const { data, error } = await supabase.from("supply_assignment_items")
    .select("*").eq("assignment_id", assignment.id).order("sort_order");
  assertNoDbError(error, "list supply assignment items");
  return data ?? [];
}

async function publishSupplyBoard(guild: Guild, assignmentId: string, fallbackChannel?: TextChannel): Promise<SupplyAssignmentRow> {
  const snapshot = await getSupplySnapshotById(assignmentId);
  if (!snapshot) {
    throw new UserFacingError("Supply assignment not found.");
  }
  const channel = fallbackChannel ?? await storedSupplyChannel(guild, snapshot.assignment);
  if (!channel) {
    throw new UserFacingError("The supply assignment channel could not be found.");
  }

  let message: Message | null = null;
  if (snapshot.assignment.discord_message_id) {
    message = await channel.messages.fetch(snapshot.assignment.discord_message_id).catch(() => null);
  }
  message = message
    ? await message.edit({ embeds: [buildSupplyBoardEmbed(snapshot)] })
    : await channel.send({ embeds: [buildSupplyBoardEmbed(snapshot)] });

  const { data, error } = await supabase.from("supply_assignments").update({
    discord_channel_id: channel.id,
    discord_message_id: message.id
  }).eq("id", assignmentId).select("*").single();
  assertNoDbError(error, "store supply assignment board");
  return data;
}

async function completeIfQuotaReached(assignmentId: string): Promise<void> {
  const snapshot = await getSupplySnapshotById(assignmentId);
  if (!snapshot || snapshot.assignment.status !== "Active") {
    return;
  }
  const totals = itemTotals(snapshot.contributions);
  if (!snapshot.items.every((item) => (totals.get(item.id) ?? 0) >= item.target_quantity)) {
    return;
  }
  const { error } = await supabase.from("supply_assignments").update({
    status: "Completed",
    completed_at: new Date().toISOString()
  }).eq("id", assignmentId);
  assertNoDbError(error, "complete supply assignment");
}

async function requireSupplyAssignment(code: string): Promise<SupplyAssignmentRow> {
  const normalized = code.trim().toLocaleUpperCase();
  const { data, error } = await supabase.from("supply_assignments").select("*").eq("code", normalized).maybeSingle();
  assertNoDbError(error, "get supply assignment");
  if (!data) {
    throw new UserFacingError(`Supply assignment ${normalized} was not found.`);
  }
  return data;
}

async function requireSupplySnapshot(code: string): Promise<SupplySnapshot> {
  const assignment = await requireSupplyAssignment(code);
  const snapshot = await getSupplySnapshotById(assignment.id);
  if (!snapshot) {
    throw new UserFacingError(`Supply assignment ${assignment.code} was not found.`);
  }
  return snapshot;
}

async function getSupplySnapshotById(assignmentId: string): Promise<SupplySnapshot | null> {
  const [assignmentResult, itemsResult, contributionsResult] = await Promise.all([
    supabase.from("supply_assignments").select("*").eq("id", assignmentId).maybeSingle(),
    supabase.from("supply_assignment_items").select("*").eq("assignment_id", assignmentId).order("sort_order"),
    supabase.from("supply_contributions").select("*").eq("assignment_id", assignmentId).order("created_at")
  ]);
  assertNoDbError(assignmentResult.error, "get supply assignment");
  assertNoDbError(itemsResult.error, "get supply assignment items");
  assertNoDbError(contributionsResult.error, "get supply contributions");
  return assignmentResult.data ? {
    assignment: assignmentResult.data,
    items: itemsResult.data ?? [],
    contributions: contributionsResult.data ?? []
  } : null;
}

function buildSupplyBoardEmbed(snapshot: SupplySnapshot): EmbedBuilder {
  const { assignment, items, contributions } = snapshot;
  const totals = itemTotals(contributions);
  const targetTotal = items.reduce((sum, item) => sum + item.target_quantity, 0);
  const collectedTotal = items.reduce((sum, item) => sum + Math.min(totals.get(item.id) ?? 0, item.target_quantity), 0);
  const contractValue = targetTotal * assignment.sale_price_per_item;
  const rangerPayout = targetTotal * assignment.ranger_rate_per_item;
  const currentOwed = collectedTotal * assignment.ranger_rate_per_item;
  const contributors = contributorTotals(contributions, assignment.ranger_rate_per_item);

  const embed = new EmbedBuilder()
    .setTitle(assignment.name)
    .setDescription([
      `**Client:** ${assignment.client_name}`,
      `**Status:** ${assignment.status}`,
      assignment.organizer_discord_user_id ? `**Organizer:** <@${assignment.organizer_discord_user_id}>` : null,
      assignment.notes
    ].filter(Boolean).join("\n"))
    .addFields(
      {
        name: "Overall Progress",
        value: `${progressBar(collectedTotal, targetTotal)} **${formatNumber(collectedTotal)} / ${formatNumber(targetTotal)}** (${percent(collectedTotal, targetTotal)}%)`
      },
      {
        name: "Contract",
        value: [
          `Client rate: ${formatSeptims(assignment.sale_price_per_item)} per item`,
          `Ranger rate: ${formatSeptims(assignment.ranger_rate_per_item)} per item`,
          `Contract value: **${formatSeptims(contractValue)}**`,
          `Ranger payout at quota: **${formatSeptims(rangerPayout)}**`,
          `Corps margin at quota: **${formatSeptims(contractValue - rangerPayout)}**`,
          `Currently owed: **${formatSeptims(currentOwed)}**`
        ].join("\n")
      }
    )
    .setColor(assignment.status === "Active" ? 0x587c4a : assignment.status === "Completed" ? 0xd5a84f : 0xa64d3f)
    .setFooter({ text: `${assignment.code} | Updates automatically when contributions are logged` })
    .setTimestamp(new Date());

  for (const item of items) {
    const collected = totals.get(item.id) ?? 0;
    embed.addFields({
      name: item.item_name,
      value: `${progressBar(collected, item.target_quantity)} **${formatNumber(collected)} / ${formatNumber(item.target_quantity)}** (${percent(collected, item.target_quantity)}%)`
    });
  }
  if (contributors.length) {
    embed.addFields({
      name: "Contributors",
      value: contributors.slice(0, 10).map((entry) =>
        `<@${entry.memberId}> - ${formatNumber(entry.quantity)} items - ${formatSeptims(entry.owed)}`
      ).join("\n").slice(0, 1024)
    });
  }
  return embed;
}

function itemTotals(contributions: SupplyContributionRow[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of contributions) {
    totals.set(row.item_id, (totals.get(row.item_id) ?? 0) + row.quantity);
  }
  return totals;
}

function contributorTotals(contributions: SupplyContributionRow[], rate: number): Array<{
  memberId: string;
  quantity: number;
  owed: number;
}> {
  const totals = new Map<string, number>();
  for (const row of contributions) {
    totals.set(row.member_discord_user_id, (totals.get(row.member_discord_user_id) ?? 0) + row.quantity);
  }
  return [...totals.entries()].map(([memberId, quantity]) => ({ memberId, quantity, owed: quantity * rate }))
    .sort((a, b) => b.quantity - a.quantity || a.memberId.localeCompare(b.memberId));
}

function findItem(items: SupplyAssignmentItemRow[], value: string): SupplyAssignmentItemRow | undefined {
  const normalized = value.trim().toLocaleLowerCase();
  return items.find((item) => item.id === value || item.item_name.toLocaleLowerCase() === normalized);
}

async function storedSupplyChannel(guild: Guild, assignment: SupplyAssignmentRow): Promise<TextChannel | null> {
  if (!assignment.discord_channel_id) {
    return null;
  }
  const channel = await guild.channels.fetch(assignment.discord_channel_id).catch(() => null);
  return channel?.type === ChannelType.GuildText ? channel : null;
}

function progressBar(value: number, target: number): string {
  const filled = Math.min(10, Math.max(0, Math.round((value / target) * 10)));
  return `[${"#".repeat(filled)}${"-".repeat(10 - filled)}]`;
}

function percent(value: number, target: number): number {
  return Math.min(100, Math.round((value / target) * 100));
}

function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

function formatSeptims(value: number): string {
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} Septims`;
}
