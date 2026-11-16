# Operations: deployment, backups, export

## Deploying

This app runs as a single Node process. A small VPS (1 vCPU, 1–2 GB RAM) or an always-on office computer is enough.

1. Install Node 20+. Run `npm ci && npm run build`.
2. Set `NODE_ENV=production` and `DATA_DIR=/var/lib/flatland` (any persistent path) in `.env`.
3. Run `npm start` under a process manager (systemd, pm2) so it restarts automatically.
4. **Put it behind HTTPS.** Caddy or nginx with Let's Encrypt can proxy to `localhost:4000`. Production cookies are marked `Secure`, so sign-in will not work over plain HTTP. Employees use this on phones over cellular, so HTTPS is required.

Example Caddyfile:

```
ops.example.com {
  reverse_proxy localhost:4000
}
```

## Backups

- **Automatic:** while the server is running, it writes a consistent SQLite snapshot to `DATA_DIR/backups/` every 24 hours.
- **On demand:** use Settings → Backup & export → "Back up now", or run `npm run backup`.
- **Uploaded files** live in `DATA_DIR/uploads/` and are **not** inside the database file. Back up that folder too.
- **Off-site copies are your responsibility.** Backups stored on the same machine don't protect against losing that machine. A nightly job such as the one below is enough:

```bash
rclone sync /var/lib/flatland/backups remote:flatland-backups
rclone sync /var/lib/flatland/uploads remote:flatland-uploads
```

- Prune old snapshots periodically (for example, keep 30 days).

### Restore

Stop the server. Copy the chosen `backups/flatland-*.db` file to `DATA_DIR/flatland.db`, deleting any `flatland.db-wal` and `flatland.db-shm` files. Restore `uploads/`. Start the server.

## Data export

Owners can download a full JSON export or per-table CSV files from Settings → Backup & export. Exports never include password hashes or session tokens. Payroll CSVs are on the Timesheets page and include approved hours only.

## Schema changes

Migrations are listed in `server/db/db.ts` and applied automatically at startup inside a transaction. Never edit a migration that has already shipped; add a new one.
