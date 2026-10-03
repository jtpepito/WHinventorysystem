# Inventory

Stock you can trust for a hardware/retail shop: receive and release stock, live on-hand quantities with weighted-average cost, low-stock alerts, physical counts, an immutable movement ledger, and CSV reports.

Runs locally on one PC. No Docker, no cloud. Data lives in a single SQLite file.

## Requirements

- Node.js 24 or newer

## First run

```bash
npm install
cp .env.example .env.local
```

Edit `.env.local`: set `ADMIN_PASSWORD`, `ENCODER_PASSWORD` (different from each other), and `SESSION_SECRET` (generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).

```bash
npm run build
npm start
```

Open http://localhost:3000. The database (`data/inventory.db`) is created on first start and filled with 60 days of sample data to try things out.

**Going live:** add `SAMPLE_DATA=0` to `.env.local`, stop the app, and delete (or move) the `data/` folder. On the next start the database begins empty except for the five categories and common units; add suppliers and items under Settings and Items. To start over at any time, stop the app and delete `data/` again.

Other PCs on the shop network can use `http://<this-pc's-ip>:3000`. Login cookies work over plain HTTP; set `COOKIE_SECURE=1` only if you put the app behind HTTPS.

## Start automatically on Windows

A scheduled task named **Inventory app** starts the app, hidden, whenever you sign in to Windows. It serves on port **3005** (set `PORT` to change it), logs to `logs\app.log`, and restarts the server within about 10 seconds if it crashes.

- **Stop:** double-click `scripts\stop-app.cmd`. Ending the task in Task Scheduler is *not* enough; it leaves the server running.
- **Restart** (needed after every `npm run build`): double-click `scripts\restart-app.cmd`.
- Only one copy runs at a time; starting it again while it's up does nothing.

To create the task on another PC (PowerShell, from the Inventory folder):

```powershell
$dir = (Get-Location).Path
$ps = "`$p = Start-Process cmd.exe -ArgumentList '/c scripts\start-app.cmd' -WorkingDirectory '$dir' -WindowStyle Hidden -Wait -PassThru; exit `$p.ExitCode"
$action = New-ScheduledTaskAction -Execute powershell.exe -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command `"$ps`"" -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable
Register-ScheduledTask -TaskName 'Inventory app' -Action $action -Trigger $trigger -Settings $settings
```

## Roles

- **Admin** password: everything — dashboard, items, receive, release, count, movements, reports, settings, ledger check.
- **Encoder** password: receive, release, count, and read-only items and movements.

## Login lockout

- 5 wrong passwords from one computer lock that computer out for 1 minute; repeat lockouts double (2, 4, 8 minutes) up to 15. A correct password clears the count, and 15 quiet minutes reset it.
- 100 wrong passwords within 15 minutes from anywhere pause all logins for 5 minutes (a backstop against someone faking addresses).
- Restarting the app clears every lockout.

## Rules the app enforces

- On-hand qty is cached on each item and updated in the same transaction as each movement. **Ledger check** (`/debug`) compares it with the sum of movements and can rebuild it.
- Receiving updates the weighted-average cost; releasing never changes it.
- You cannot release more than is on hand, even split across several lines.
- A count can't be posted if stock moved after it started; use **Refresh expected** and re-check those items.
- Movements are never edited or deleted; corrections are new adjustments (counts post them automatically with the note "count variance").
- Low stock = active item with qty at or below its reorder point. New items start at qty 0 with reorder point 0, so they show as low until you set one.

## Backups

```bash
npm run backup
```

This writes a dated copy such as `backups/inventory-2026-10-03_153005.db` (Manila time). It is safe while the app is running: it uses SQLite's `VACUUM INTO`, which takes a consistent snapshot including changes not yet written to the main file, then checks the copy's integrity and prints how many items and movements it holds. Don't back up by copying `data/inventory.db` while the app runs; that copy can be incomplete.

- Save somewhere else: `npm run backup -- D:\InventoryBackups` (a USB drive or another PC's shared folder), or set `BACKUP_DIR` in `.env.local`.
- Old backups are never deleted automatically; clear out the folder now and then.
- **Daily backup on Windows:** in Task Scheduler, create a basic task that runs daily with program `cmd.exe` and arguments `/c cd /d "C:\path\to\Inventory" && npm run backup -- D:\InventoryBackups`.

### Restoring a backup

1. Stop the app.
2. In `data/`, delete `inventory.db-wal` and `inventory.db-shm` if they exist, and rename `inventory.db` (e.g. to `inventory.before-restore.db`) in case you need it.
3. Copy the backup file into `data/` and rename it to `inventory.db`.
4. Start the app and open **Ledger check** to confirm everything matches.

## Development

```bash
npm run dev        # dev server
npm test           # domain tests (Vitest)
npm run test:e2e   # end-to-end acceptance (Playwright; builds the app and uses data/e2e.db)
npm run typecheck
npm run lint
```
