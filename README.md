# A&C Planning Tool

Interne planning- en opvolgapp voor Aircraft & Component MRO. De app helpt office en shop om open work orders uit AcMP te importeren, prioriteren, plannen en opvolgen op de werkvloer.

## Wat doet de app? 

- Dashboard met KPI's voor open, overdue, AOG/priority, blocked en ready-to-close work orders.
- Shared Planning voor de volgorde van actieve work orders, inclusief drag-and-drop planning, snelle edits en blokkade-inzicht.
- Capacity Management voor weekbelasting, beschikbare shopcapaciteit, afwezigheden en restrictiewaarschuwingen.
- Office Update en Shop Update om work orders, processtappen, acties, RFQ-statussen en blokkades bij te werken.
- Shop Wall Screen voor de werkvloer, met open work orders, blocked work orders, aanvullende taken en optioneel luchtvaartnieuws.
- AcMP Import voor handmatige Excel-import en Dropbox-import van AcMP exports.
- Staff Management, Inactive Work Orders, Work Order Data en Completed Tasks voor beheer en rapportage.

## Rollen

De app gebruikt Supabase Auth met profielen in de database.

- `office`: volledige planning, admin, import en dashboard.
- `developer`: toegang tot de manuals-pagina voor beheer en documentatiecontrole.
- `shop`: shop-form/update flow.
- `wall`: shop-wall scherm zonder office-navigatie.

## Tech stack

- Next.js `16.2.6` met App Router
- React `19`
- TypeScript
- Supabase
- Tailwind CSS `4`
- `@supabase/supabase-js`
- `xlsx` voor AcMP Excel parsing
- GitHub Actions voor de geplande Dropbox-import

## Lokaal draaien

Installeer dependencies:

```bash
npm install
```

Maak een `.env.local` met minimaal:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Voor Dropbox-import zijn ook deze variabelen nodig:

```bash
DROPBOX_APP_KEY=
DROPBOX_APP_SECRET=
DROPBOX_REFRESH_TOKEN=
ACMP_DROPBOX_IMPORT_PATH=/Work Order Planning App/import
ACMP_DROPBOX_FAILED_PATH=/Work Order Planning App/failed
```

Start de development server:

```bash
npm run dev
```

Open daarna:

```text
http://localhost:3000
```

## Scripts

```bash
npm run dev              # Next.js development server
npm run build            # Productiebuild
npm run start            # Productieserver na build
npm run lint             # ESLint
npm run import:dropbox   # Dropbox AcMP import worker
npm run test:acmp-import # AcMP import tests
```

## Database en migraties

De database wordt beheerd via Supabase SQL migrations in `supabase/migrations`. Nieuwe schemawijzigingen horen als aparte migration in die map.

Er staan ook handmatige reset-scripts in `supabase/`; gebruik die alleen bewust, omdat ze work-order en completion data kunnen verwijderen.

## AcMP import

AcMP exports zijn Excel-bestanden (`.xlsx`). Office users kunnen ze handmatig uploaden via `/import`, of ze kunnen via Dropbox worden opgepakt. De Dropbox worker importeert de nieuwste export, detecteert duplicaten via een rows-signature, verwijdert succesvolle exports en verplaatst mislukte exports naar de failed folder.

Meer details staan in `docs/acmp-dropbox-import.md`.

## Office development

Voor wijzigingen maken en pushen vanaf de office PC staat een aparte handleiding in `docs/instructions-for-code-changes.md`.

## Belangrijke routes

- `/login`
- `/dashboard`
- `/capacity`
- `/planning`
- `/office-update`
- `/shop-update`
- `/shop-form`
- `/shop`
- `/import`
- `/staff`
- `/backlog`
- `/work-order-data`
- `/completed-tasks`
- `/acmp-review`
- `/manuals`
