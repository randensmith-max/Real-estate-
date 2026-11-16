# Flatland Operations

The business management platform for **Flatland Custom Forage**: jobs, customers, crews, time clock, timesheets, equipment, inventory, shop maintenance, inspections, documents, and operational reporting. It works on phones in the field and has full management tables on a desktop.

> This folder is a standalone app. It shares a repository with an unrelated project in `../app`. The two don't depend on each other.

## Quick start

Requirements: Node.js 20 or newer.

```bash
cd flatland-operations
npm install
npm run build        # builds the web app into dist/client
npm start            # serves the app + API on http://localhost:4000
```

Open http://localhost:4000. The first visit shows **company setup**, where you create the owner account. There is no built-in or sample data.

During development, run `npm run dev`. The API runs on :4000 and Vite serves the UI with hot reload on http://localhost:5173.

| Command | What it does |
|---|---|
| `npm run dev` | API (auto-restart) + Vite dev server |
| `npm run build` | Production build of the web app |
| `npm start` | Production server (API + built UI) |
| `npm test` | Server integration tests, including the Phase 1 acceptance suite |
| `npm run test:e2e:phase1` | Browser acceptance run with owner, manager and employee sessions (needs Playwright and a server on an empty data folder) |
| `npm run typecheck` | TypeScript check for server and client |
| `npm run backup` | Writes a consistent database snapshot to `DATA_DIR/backups` |

Configuration is read from `.env` (see `.env.example`). All data lives in `DATA_DIR` (default `./data`): `flatland.db`, `uploads/`, and `backups/`.

## Adding people

Owners and managers add people under **Team → Add person**. The app creates a one-time temporary password and shows it on screen. Hand it over in person or by phone. The person must choose their own password at first sign-in. Email invitations are not configured.

## Documentation

- [docs/DATABASE.md](docs/DATABASE.md): how the main records relate (ER diagram, constraints, history rules)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): stack, data model, security model, and how the phases fit together
- [docs/OPERATIONS.md](docs/OPERATIONS.md): deployment, HTTPS, backups, restore, export
- [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md): e-signature and QuickBooks plans, plus other external dependencies
- [docs/STATUS.md](docs/STATUS.md): phase-by-phase status and the Phase 1 report
