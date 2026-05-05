# AcMP Dropbox Import

## Dropbox Upload Rules

Upload AcMP Excel exports in Dropbox to:

`/Work Order Planning App/import`

This is a normal shared Dropbox folder, not an App Folder path. The Dropbox app account must have edit access to the shared folder so it can list pending exports, delete successful imports, and move failed files.

The importer reads the upload folder from `ACMP_DROPBOX_IMPORT_PATH`, defaulting to `/Work Order Planning App/import`.

Automatic import runs every 5 minutes from GitHub Actions, and Office users can also trigger the same check immediately from the Dashboard refresh icon or the `/import` page.

Excel files are never saved in Supabase Storage. The importer downloads each Excel file into memory, parses the first worksheet, imports the parsed rows, and discards the file buffer.

## Filename Rules

Users may upload any valid AcMP `.xlsx` export to:

`/Work Order Planning App/import`

The filename does not matter as long as it is a `.xlsx` AcMP export.

Accepted examples:

- `werkorders_130326.xlsx`
- `export.xlsx`
- `AcMP export.xlsx`
- `latest work orders.xlsx`

Temporary Office files starting with `~$` are ignored. Non-`.xlsx` files are ignored. Folders are ignored. `.xls` files are ignored unless explicit `.xls` support is added later.

## Dashboard Refresh

The Dashboard header has a refresh action labeled `Check AcMP export`. It checks Dropbox immediately. If files are found, Office can import them from the Dashboard or open the full `/import` page. After a successful Dashboard import, Dashboard data refreshes so updated work orders are visible without a manual reload.

## `/import` Page

The `/import` page has full Dropbox import controls before the manual upload section. Office can check Dropbox, review the found export filenames, confirm import, and see a compact summary. If multiple Excel exports are present, the page shows that only the newest file will be imported.

Manual file upload remains available as an emergency fallback. It uses the same shared import runner as Dropbox imports.

## Storage Policy

Excel files are never saved in Supabase Storage.

Manual uploads are read in the browser, converted to parsed rows, and then imported through the server API. Dropbox files are downloaded into memory by the server or worker, parsed, and discarded.

## Success And Failure Behavior

If multiple Excel exports are present in the import folder, only the newest by Dropbox modified time is imported. If two files have the same modified time, the deterministic fallback is the descending lowercase Dropbox path.

The newest AcMP export represents the latest system state. Older Excel exports are not imported one by one.

After the newest export imports successfully, all `.xlsx` exports in the import folder are deleted, including older exports. Non-`.xlsx` files and folders are not deleted.

If the newest export is a duplicate by parsed `rows_signature`, it is ignored and all `.xlsx` exports in the import folder are deleted.

If the newest export is invalid, corrupted, or fails during import, only the newest file is moved to the failed folder. Older Excel exports are kept for safety.

Failed Dropbox Excel files are moved to:

`/Work Order Planning App/failed`

The importer reads the failed folder from `ACMP_DROPBOX_FAILED_PATH`, defaulting to `/Work Order Planning App/failed`. Failed metadata rows are retained and are not automatically cleaned up.

Processed and ignored import metadata older than 30 days can be cleaned up by `public.cleanup_acmp_import_files()`.

## Duplicate Detection

Duplicate exports are detected by `rows_signature`, a SHA-256 hash of the parsed AcMP rows with deterministic JSON serialization. Binary Excel metadata and filenames do not determine duplicates.

If an export was manually imported first, the later Dropbox worker ignores the duplicate rows and deletes the Dropbox file. If Dropbox imported it first, a later manual upload with the same parsed rows is ignored with no work-order changes.

Dropbox path and revision are also recorded so the same Dropbox file revision is not imported twice.

## GitHub Action

`.github/workflows/acmp-dropbox-import.yml` runs every 5 minutes with cron `*/5 * * * *` and can also be started manually with `workflow_dispatch`.

The workflow runs:

```bash
npm run import:dropbox
```

Individual bad files are recorded and moved to `/Work Order Planning App/failed`; the workflow exits successfully for no files, duplicate files, and per-file import failures. It exits non-zero only when infrastructure or runtime setup prevents the worker from operating.

## Required Secrets

Set these as GitHub Actions secrets:

- `DROPBOX_APP_KEY`
- `DROPBOX_APP_SECRET`
- `DROPBOX_REFRESH_TOKEN`
- `ACMP_DROPBOX_IMPORT_PATH`
- `ACMP_DROPBOX_FAILED_PATH`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Set the same values as hosting/server environment variables in the deployed app:

- `DROPBOX_APP_KEY`
- `DROPBOX_APP_SECRET`
- `DROPBOX_REFRESH_TOKEN`
- `ACMP_DROPBOX_IMPORT_PATH`
- `ACMP_DROPBOX_FAILED_PATH`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional local-only fallback:

- `DROPBOX_ACCESS_TOKEN`

The production default is refresh-token auth. Do not use `DROPBOX_ACCESS_TOKEN` as the GitHub Actions or hosting default.

Do not use `NEXT_PUBLIC_` variables for Dropbox or the Supabase service role key.
