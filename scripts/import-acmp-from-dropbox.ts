import { cleanupAcmpImportFiles } from "../lib/acmp-import/import-files";
import { importDropboxExports } from "../lib/acmp-import/dropbox";

async function main() {
  const cleanup = await cleanupAcmpImportFiles();
  if (cleanup.error) {
    throw new Error(cleanup.error.message);
  }

  const summary = await importDropboxExports({ mode: "auto" });
  console.log(
    [
      `processed=${summary.processedFiles}`,
      `duplicates=${summary.ignoredDuplicateFiles}`,
      `failed=${summary.failedFiles}`,
      `candidates=${summary.candidatesFound}`,
      `deleted_superseded=${summary.deletedSuperseded}`,
      `pending_new=${summary.totals.pendingNewWorkOrders}`,
      `pending_rfq=${summary.totals.pendingRfqApprovedInactive}`,
    ].join(" "),
  );

  for (const result of summary.results) {
    console.log(
      `${result.status}: ${result.filename}${
        result.error ? ` (${result.error})` : ""
      }`,
    );
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "AcMP Dropbox import failed.",
  );
  process.exit(1);
});
