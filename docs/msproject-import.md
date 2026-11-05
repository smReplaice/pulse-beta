# Microsoft Project Import — Supported Fields & Limitations

Formats: **MS Project XML (`.xml`, MSPDI)** — first-party parser in `apps/api/src/modules/msproject/` · **Binary (`.mpp`)** — via the optional mpxj converter service (`converter/mpxj-service/`, set `MSPROJECT_CONVERTER_URL`). Encrypted/password-protected and not-yet-supported-version MPP files are rejected with a readable error. Upload cap: `MSPROJECT_MAX_UPLOAD_BYTES` (26 MB default). XXE-safe: DOCTYPE/ENTITY rejected, entity processing disabled, well-formedness validated.

## Import flow
`POST /api/msproject/import/analyze` (multipart) → validation + preview + one-time token (30-min expiry, nothing persisted) → `POST /api/msproject/import/commit` (token) → single database transaction (project, calendars, tasks, dependencies, resources, assignments, baselines, traceability job) with rollback on any failure. Duplicate confirmations → 409; expired/unknown tokens → 410; options differing from the analyzed preview → 400.

## Field mapping

| Source (MSPDI) | Pulse | Notes |
|---|---|---|
| Project Name/StartDate/HoursPerDay/HoursPerWeek/DaysPerMonth | project | currency symbol → GBP/EUR/USD (else USD) |
| Tasks: UID, ID, Name, WBS, OutlineLevel, Summary, Milestone | tasks | source UID kept in `external_reference_id`; ordering by source ID |
| Duration (ISO-8601), Start/Finish, ManualStart/Finish | durations/dates | dates pinned as UTC wall-clock — no timezone shift |
| PredecessorLink (UID-based), types FS/SS/FF/SF, LinkLag | dependencies | LinkLag is tenths-of-minutes per the MSPDI spec |
| ConstraintType 0–7, ConstraintDate, Deadline | constraints | full set incl. MSO/MFO |
| PercentComplete, ActualStart/Finish/Work, RemainingWork | progress | |
| Type (0/1/2), EffortDriven, Priority, Notes, FixedCost | task fields | Fixed Units / Fixed Duration / Fixed Work |
| Calendars: base + derived, WeekDays, WorkingTimes, Exceptions | calendars | multi-day exception ranges expanded per day |
| Resources: Name/Type/MaxUnits/StandardRate/CostPerUse | resources | rates are hundredths in MSPDI; source UID kept |
| Assignments: TaskUID/ResourceUID/Units/Work/ActualWork/Cost | assignments | |
| Baseline + Baseline1–9 (nested or flattened) | named baselines | task level |

**Scheduling semantics.** Imported tasks default to **manual scheduling with their source dates** (a "preserve dates" option recorded on the job). Recalculation by Pulse's CPM engine is an explicit operation (`Schedule → Recalculate`). Differences from MS Project: Pulse does not re-derive task dates from resource-levelling decisions made in MS Project, negative-float computation differs (warnings rather than negative slack), and elapsed-duration lags are treated as working-time.

## Not represented (surfaced as preview warnings — never silently dropped)
Extended attributes/custom fields · outline codes & WBS masks · assignment-level baselines (AB start/finish/work) · recurring task definitions (expanded occurrences import as plain tasks) · task splits · percentage-based lags (imported as 0) · deliverable/enterprise links · scheduling from project finish (warning; logic imported) · cost resource rate tables (cost imported) · multiple rate pay scales/effective-dated rates.

## Validation (blocking errors)
Duplicate task UIDs · missing predecessor/resource references · self-dependencies · dependency cycles (detected by the same engine that runs the live schedule) · outline-level gaps · invalid assignment units · wrong file signature · malformed XML · non-Project XML.

## Traceability
`msproject_import_jobs` stores filename, format, size, SHA-256, options, counts and warnings per import; tasks and resources carry `external_reference_id` (`msp:task-uid:…`, `msp:resource-uid:…`) with per-project indexes. Migration: `1700000001000-MsProjectImport.ts`.

## Security & tenancy
Uploads bounded (multer + explicit check), previews held in memory only (never on disk) with TTL cleanup, all writes scoped to the organization resolved at request time (swap `ensureDefaultOrg()` for the authed user when authentication lands). The converter service should run on a private network only.

## Testing
`apps/api/test/msproject-import.e2e-spec.ts` (15 tests) + `scripts/smoke-msimport.cjs` (browser flow). Fixture: `apps/api/test/fixtures/msproject-sample.xml` — hand-authored from the public MSPDI schema (lawful; contains no Microsoft proprietary content). Real `.mpp` fixtures could not be lawfully produced without MS Project; rejection paths are tested with synthetic binaries, and converter round-trips should be added when a licensed fixture is available.
