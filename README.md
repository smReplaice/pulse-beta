# BiltFlow Pulse

Construction programme management & scheduling — a full application in the class of Microsoft Project / ProjectLibre, with construction-specific extensions and an AI scheduling copilot.

**One scheduling engine, one set of project data.** Every view (Gantt, network, WBS, usage, costs, copilot) renders results computed by the backend CPM engine. The frontend never computes dates — it sends edit commands and renders authoritative responses.

## Stack

| Layer | Technology |
|---|---|
| Scheduling engine | Pure TypeScript library (`packages/engine`) — working-time calendars, CPM, dependencies, constraints, leveling, costs, earned value |
| API | NestJS (`apps/api`) — REST + WebSocket, TypeORM, versioned schedules, optimistic concurrency |
| Database | PostgreSQL (production) · SQLite fallback for instant dev (no credentials needed) |
| Frontend | React + Vite (`apps/web`) — MS Project-style shell, editable spreadsheet grid, SVG Gantt, dialogs, keyboard shortcuts |
| AI | LangGraph supervisor + DeepSeek (`@langchain/deepseek`) — proposes operations; NestJS validates & schedules them |

## Quick start (no Postgres needed)

```bash
npm install
npm run build          # engine → api → web
npm run start:sqlite   # API on :4000 with local SQLite + seed data
npm run dev:web        # UI on :5173 (or next free port — check the log)
```

The seeded workspace contains two programmes: the reference **Sample Delivery Programme** (Design 10d → Development 10d, Document 5d in parallel → Test 10d → Rollout milestone = **30 working days**) and **Riverside Apartments — 20 Storeys** (construction demo with resources, lags, holidays).

## With PostgreSQL

1. Add your connection to `apps/api/.env`:

```env
DATABASE_URL=postgres://user:password@host:5432/pulse
DEEPSEEK_API_KEY=your-key        # optional — enables the AI copilot
```

2. Migrate and seed:

```bash
npm run build -w packages/engine && npm run build -w apps/api
npm run db:migrate               # version-controlled migrations (PostgreSQL DDL)
npm run db:seed                  # org, portfolio, sample programmes
npm run start                    # API from dist/ against PostgreSQL
```

When `DATABASE_URL` is set the API always uses PostgreSQL; when empty it falls back to `apps/api/data/pulse-dev.sqlite` so you can explore immediately.

## Tests

```bash
npm run test:engine   # 44 tests — all acceptance criteria (§8 of the spec)
npm run test:api      # 14 e2e tests — REST behaviours against in-memory SQLite
```

Covered: the 30-working-day sample; the 10→15 day cascade (dependents move, independents don't); 80h fixed-work with two/one/half-resource durations; summary rollups; circular & summary-to-child dependency rejection; holidays and resource calendars shifting dates; baseline persistence; overallocation detection and leveling preview/apply (no logic changes, no baseline changes); constraints (SNET/MSO/FNET/MFO/SNLT/FNLT/ASAP/ALAP); FS/SS/FF/SF ± lead/lag; manual & elapsed tasks; multiple critical paths; costs; earned value.

## The scheduling engine (packages/engine)

Pure, dependency-free, independently testable:

- **Working-time calendars** — weekly shifts, per-day periods, holiday exceptions; all arithmetic in working minutes (not calendar days)
- **CPM** — forward/backward passes, early/late dates, total & free float, criticality with configurable slack threshold, multiple critical paths
- **Relationships** — FS / SS / FF / SF with positive and negative working-time lag/lead
- **Constraints** — ASAP, ALAP, SNET, SNLT, FNET, FNLT, MSO, MFO (+ deadlines as soft warnings)
- **Task types** — Fixed Units / Fixed Duration / Fixed Work with effort-driven redistribution
- **Resource-aware scheduling** — fixed-work durations derived from assignment capacity; resource calendars extend task dates when resources are unavailable
- **Summaries** — dates, duration, work, cost and % complete roll up; summary links redirect to boundary activities; summary-to-child links rejected
- **Cycle detection** — rejects circular dependencies with the offending path
- **Leveling** — greedy serial leveling by priority/progress/row; delay-only (never changes logic or baselines); preview never mutates
- **Costs & EV** — planned/actual from rates, materials, cost resources, fixed costs; BCWS/BCWP/ACWP, SPI/CPI/EAC/VAC series

## API surface (see `apps/api/src/modules`)

Every endpoint from the specification §6 plus calendars, resources, assignments, usage, leveling, baselines, progress/EV, import/export, templates and AI:

```
POST /api/projects                     POST /api/tasks/bulk
GET  /api/projects/:id/schedule        POST /api/tasks/:id/dependencies
POST /api/projects/:id/tasks           PATCH /api/dependencies/:id
PATCH /api/tasks/:id                   POST /api/projects/:id/recalculate
POST /api/tasks/:id/assignments        GET  /api/projects/:id/resource-usage
POST /api/projects/:id/leveling/preview|apply|clear
POST /api/projects/:id/baselines       GET  /api/baselines/:id/compare
POST /api/tasks/:id/progress           GET  /api/projects/:id/critical-path
POST /api/projects/:id/ai/chat         POST /api/projects/import
```

Mutations are optimistic-concurrency guarded (`expectedScheduleVersion` → 409 on conflict) and return **authoritative** results: the updated task, downstream changed tasks, warnings, and the new schedule version. Every recalculation writes a `schedule_version`, a `schedule_calculation_run` and (where relevant) audit rows; a WebSocket (`/ws`, subscribe `{"type":"subscribe","projectId":…}`) broadcasts changes.

## UI (MS Project / ProjectLibre patterns)

- **Portfolio** — create blank / import, search, sort, progress & critical chips
- **Project Gantt** — spreadsheet grid + timeline split pane (drag the splitter): cell editing (F2/Enter, type-over), arrow-key navigation, multi-row selection, copy-ready IDs, indent/outdent (Alt+Shift+→/←), link/unlink (Ctrl+F2), Insert/Delete, undo/redo (Ctrl+Z/Y), context menus, resizable columns, collapse/expand summaries
- **Timeline** — drag bars to move (applies SNET like MS Project), drag ends to resize duration, drag the end-dot to another row to link, dependency elbows with lag labels, critical-path toggle (red), baseline bars, progress overlays, slack indicator, weekend/holiday shading, today & status-date lines, zoom (Ctrl+wheel or the slider), scroll-to-task
- **Dialogs** — Task Information (General / Scheduling / Dates / Dependencies / Resources / Actuals / Baseline / Notes), Assign Resources, Level Resources (preview → apply → revert), Baselines (save / compare / restore), Change Working Time (holidays), Project Settings, Update Progress
- **Views** — Tracking Gantt, Resource Sheet, Resource Usage (histogram + capacity line + timephased grid), Network Diagram (critical highlighting), WBS, Progress & Costs (EV KPIs, baseline variance, milestones)
- **AI Copilot panel** — natural-language programme creation/edits with a **preview before apply** (engine dry-run), then applies through the same APIs as manual edits; undoable; every action logged

## DeepSeek copilot

Set `DEEPSEEK_API_KEY` and restart the API. A LangGraph supervisor routes to specialised agents (programme creation, schedule editor, scheduling analyst, resource planner, progress analyst, construction advisor). Agents return **structured proposals** — never dates — which the API dry-runs through the pure engine for preview, and applies via the same task/dependency services as manual edits (identical calculations, logged & undoable).

## Repository layout

```
packages/engine    pure scheduling library + 44 tests
apps/api           NestJS REST/WS + TypeORM entities + PostgreSQL migrations + seed
apps/web           React UI (shell, grid, timeline, dialogs, views, copilot)
scripts/           headless UI smoke test (playwright-core)
```

## Status & next steps

Delivered and verified: scheduling engine (all acceptance tests), full REST surface, Gantt UX with spreadsheet editing and authoritative recalcs, resources/costs, leveling, baselines/tracking/EV, network/WBS/usage views, AI copilot plumbing, import/export/templates, SQLite quick-start, PostgreSQL migrations.

On the roadmap: MSPDI (MS Project XML) interchange, look-ahead/weekly work plans, package linking with ProcureFlow/Vault/PayApps (`package_id`, `external_reference_id` columns are already in place), delay/EOT registers, programme-health dashboards.
