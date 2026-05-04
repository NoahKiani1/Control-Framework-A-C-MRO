import { getSupabaseServiceClient } from "@/lib/supabase-service";
import {
  analyzeImportRows,
} from "@/lib/acmp-import/analyze";
import {
  applyDeletions,
  applyExistingOrderUpdates,
  finalizeClosedWorkOrderReports,
  recordImportRun,
} from "@/lib/acmp-import/apply";
import {
  type PendingAcmpInsertRow,
  upsertPendingAcmpWorkOrders,
} from "@/lib/acmp-import/pending";
import type {
  ParsedRow,
  RfqActivationCandidate,
} from "@/lib/acmp-import/types";
import {
  createProcessingImportRecord,
  hasProcessedRowsSignature,
  markImportFailed,
  markImportIgnored,
  markImportProcessed,
} from "@/lib/acmp-import/import-files";
import { createRowsSignature } from "@/lib/acmp-import/signature";
import type {
  AcmpImportResult,
  RunAcmpImportFromRowsArgs,
} from "@/lib/acmp-import/run";

function buildNewOrderPendingRows(
  newOrders: ParsedRow[],
  rawByWorkOrderId: Record<string, Record<string, unknown>>,
  filename: string,
): PendingAcmpInsertRow[] {
  return newOrders.map((order) => ({
    work_order_id: order.work_order_id,
    customer: order.customer,
    rfq_state: order.rfq_state,
    last_system_update: order.last_system_update,
    is_open: order.is_open,
    work_order_type: order.work_order_type,
    part_number: order.part_number,
    source_filename: filename || null,
    raw_payload:
      (rawByWorkOrderId[order.work_order_id] as
        | Record<string, unknown>
        | undefined) || null,
    review_type: "new_work_order",
    previous_rfq_state: null,
    current_process_step: null,
    assigned_person_team: null,
  }));
}

function buildRfqApprovedInactivePendingRows(
  candidates: RfqActivationCandidate[],
  rawByWorkOrderId: Record<string, Record<string, unknown>>,
  filename: string,
): PendingAcmpInsertRow[] {
  return candidates.map((order) => ({
    work_order_id: order.work_order_id,
    customer: order.customer,
    rfq_state: order.rfq_state,
    last_system_update: order.last_system_update,
    is_open: order.is_open,
    work_order_type: order.work_order_type,
    part_number: order.part_number,
    source_filename: filename || null,
    raw_payload:
      (rawByWorkOrderId[order.work_order_id] as
        | Record<string, unknown>
        | undefined) || null,
    review_type: "rfq_approved_inactive",
    previous_rfq_state: order.previous_rfq_state,
    current_process_step: order.current_process_step,
    assigned_person_team: order.assigned_person_team,
  }));
}

function rowsProcessed(result: {
  newOrders: unknown[];
  existingOrders: unknown[];
  tooOld: number;
  skipped: number;
  closedSkipped: number;
}): number {
  return (
    result.newOrders.length +
    result.existingOrders.length +
    result.tooOld +
    result.skipped +
    result.closedSkipped
  );
}

export async function runAcmpImportFromRowsOnServer({
  rows,
  filename,
  sourceType,
  importTimestamp = new Date().toISOString(),
  fileSha256 = null,
  dropboxMetadata = null,
}: RunAcmpImportFromRowsArgs): Promise<{
  result: AcmpImportResult | null;
  error: { message: string } | null;
  duplicate?: boolean;
}> {
  const client = getSupabaseServiceClient();
  const rowsSignature = await createRowsSignature(rows);

  async function createMetadataRecord() {
    return createProcessingImportRecord({
      sourceType,
      originalFilename: filename,
      rowsSignature,
      fileSha256,
      dropboxPathLower: dropboxMetadata?.pathLower ?? null,
      dropboxRev: dropboxMetadata?.rev ?? null,
      dropboxContentHash: dropboxMetadata?.contentHash ?? null,
      exportDate: dropboxMetadata?.exportDate ?? null,
      exportSequence: dropboxMetadata?.exportSequence ?? 0,
      serverModified: dropboxMetadata?.serverModified ?? null,
      startedAt: importTimestamp,
    });
  }

  try {
    if (await hasProcessedRowsSignature(rowsSignature)) {
      const duplicateRecord = await createMetadataRecord();
      if (duplicateRecord.record) {
        await markImportIgnored({
          id: duplicateRecord.record.id,
          ignoreReason: "duplicate_rows_signature",
        });
      }
      return { result: null, error: null, duplicate: true };
    }

    const processingRecord = await createMetadataRecord();
    if (processingRecord.conflict) {
      return {
        result: null,
        error: {
          message: "An import with the same parsed rows is already processing.",
        },
      };
    }
    if (processingRecord.error || !processingRecord.record) {
      return {
        result: null,
        error: processingRecord.error ?? {
          message: "Failed to create import metadata record.",
        },
      };
    }

    try {
      const analysis = await analyzeImportRows(rows, client);

      const { updated, error: updateError } = await applyExistingOrderUpdates({
        existingOrders: analysis.existingOrders,
        importTimestamp,
        client,
      });

      if (updateError) {
        throw new Error(updateError.message);
      }

      const pendingRows: PendingAcmpInsertRow[] = [
        ...buildNewOrderPendingRows(
          analysis.newOrders,
          analysis.rawByWorkOrderId,
          filename,
        ),
        ...buildRfqApprovedInactivePendingRows(
          analysis.rfqActivationCandidates,
          analysis.rawByWorkOrderId,
          filename,
        ),
      ];

      if (pendingRows.length > 0) {
        const { error: pendingError } = await upsertPendingAcmpWorkOrders(
          pendingRows,
          client,
        );

        if (pendingError) {
          throw new Error(
            `Error saving pending AcMP review rows: ${pendingError.message}`,
          );
        }
      }

      await finalizeClosedWorkOrderReports({
        closedWorkOrders: analysis.closedWorkOrders,
        client,
      });

      const { deleted, closedRemoved } = await applyDeletions({
        oldIds: analysis.oldIds,
        closedIds: analysis.closedIds,
        client,
      });

      const processed = rowsProcessed(analysis);
      const pendingNewWorkOrders = analysis.newOrders.length;
      const pendingRfqApprovedInactive =
        analysis.rfqActivationCandidates.length;

      await recordImportRun({
        filename,
        rowsProcessed: processed,
        rowsInserted: 0,
        rowsUpdated: updated,
        client,
      });

      const result: AcmpImportResult = {
        processed,
        updated,
        deleted,
        closedRemoved,
        closedSkipped: analysis.closedSkipped,
        tooOld: analysis.tooOld,
        skipped: analysis.skipped,
        pendingNewWorkOrders,
        pendingRfqApprovedInactive,
      };

      const processedUpdate = await markImportProcessed({
        id: processingRecord.record.id,
        rowsProcessed: processed,
        rowsUpdated: updated,
        pendingNewWorkOrders,
        pendingRfqApprovedInactive,
        closedRemoved,
        skipped: analysis.skipped,
      });

      if (processedUpdate.error) {
        throw new Error(processedUpdate.error.message);
      }

      return { result, error: null };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown import error.";
      await markImportFailed({
        id: processingRecord.record.id,
        errorMessage: message,
      });
      return { result: null, error: { message } };
    }
  } catch (error) {
    return {
      result: null,
      error: {
        message: error instanceof Error ? error.message : "Unknown import error.",
      },
    };
  }
}
