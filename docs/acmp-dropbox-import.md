# AcMP Dropbox Import

## Dropbox Upload Rules

Upload AcMP Excel exports in Dropbox to:

`/Apps/Aircraft & Component/import`

Because the Dropbox app uses App Folder access, API paths are relative to the app folder. The code calls Dropbox with `/import` and `/failed`, while users should upload through the Dropbox UI via `Apps` -> `Aircraft & Component` -> `import`.

Automatic import runs every 5 minutes from GitHub Actions, and Office users can also trigger the same check immediately from the Dashboard refresh icon or the `/import` page.

Excel files are never saved in Supabase Storage. The importer downloads each Excel file into memory, parses the first worksheet, imports the parsed rows, and discards the file buffer.

## Filename Rules

Accepted filenames:

- `werkorders_ddmmjj.xlsx`
- `werkorders_ddmmjj (1).xlsx`
- `werkorders_ddmmjj (2).xlsx`

Examples:

- `werkorders_040526.xlsx` means export date `2026-05-04`, sequence `0`.
- `werkorders_040526 (1).xlsx` means export date `2026-05-04`, sequence `1`.

Rejected files include temporary Office files starting with `~$`, non-`.xlsx` files, unrelated names, `werkorders_04-05-26.xlsx`, and `werkorders_04052026.xlsx`.

## Dashboard Refresh

The Dashboard header has a refresh action labeled `Check AcMP export`. It checks Dropbox immediately. If files are found, Office can import them from the Dashboard or open the full `/import` page. After a successful Dashboard import, Dashboard data refreshes so updated work orders are visible without a manual reload.

## `/import` Page

The `/import` page has full Dropbox import controls before the manual upload section. Office can check Dropbox, review the found export filenames, confirm import, and see a compact summary.

Manual file upload remains available as an emergency fallback. It uses the same shared import runner as Dropbox imports.

## Storage Policy

Excel files are never saved in Supabase Storage.

Manual uploads are read in the browser, converted to parsed rows, and then imported through the server API. Dropbox files are downloaded into memory by the server or worker, parsed, and discarded.

## Success And Failure Behavior

Successful Dropbox Excel files are deleted from Dropbox after import.

Failed Dropbox Excel files are moved to:

`/Apps/Aircraft & Component/failed`

The API path for that folder is `/failed`. Failed metadata rows are retained and are not automatically cleaned up.

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

Individual bad files are recorded and moved to `/failed`; the workflow exits successfully for no files, duplicate files, and per-file import failures. It exits non-zero only when infrastructure or runtime setup prevents the worker from operating.

## Required Secrets

Set these as GitHub Actions secrets:

- `DROPBOX_APP_KEY`
- `DROPBOX_APP_SECRET`
- `DROPBOX_REFRESH_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Set the same values as hosting/server environment variables in the deployed app:

- `DROPBOX_APP_KEY`
- `DROPBOX_APP_SECRET`
- `DROPBOX_REFRESH_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional local-only fallback:

- `DROPBOX_ACCESS_TOKEN`

The production default is refresh-token auth. Do not use `DROPBOX_ACCESS_TOKEN` as the GitHub Actions or hosting default.

Do not use `NEXT_PUBLIC_` variables for Dropbox or the Supabase service role key.
