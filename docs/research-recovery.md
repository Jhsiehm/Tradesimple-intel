# Research backup and recovery

The research database contains saved experiments, dataset versions, notebooks, comparison plans, calculation engines and any historical evidence tables. The feed cache is separate. Keep backups in a private location outside the repository: the research database can contain proprietary imported data.

Create a new snapshot directory (its parent must already exist):

```sh
node scripts/research-backup.mjs create data/research.sqlite /private/backup/location/snapshot-001
```

The API may remain open. SQLite creates a consistent snapshot including committed WAL contents; unpublished transactions are not included. Creation validates SQLite integrity, record/engine checksums and core references. A manifest records the file checksum and table counts. Existing backup directories are never replaced. This backs up the database, not application configuration or provider credentials.

Verify the snapshot:

```sh
node scripts/research-backup.mjs verify /private/backup/location/snapshot-001
```

Restore into a **new** path:

```sh
node scripts/research-backup.mjs restore /private/backup/location/snapshot-001 /private/restore/location/research.sqlite
```

The restore refuses an existing destination or associated WAL/SHM files. It validates the backup before copying and checks the restored database. To use the restored file, stop the API, set `INTEL_RESEARCH` to its absolute path, then restart. Keep the previous file until saved experiments, notebook evidence and offline replay have been checked in the restored application. Do not replace an open database or delete its WAL files.

Checksums detect changes; they do not authenticate a backup against an attacker who can replace both database and manifest. Keep independent protected copies according to the sensitivity of your research.

Automated recovery verification covers a snapshot of an open WAL database, preservation of saved experiment metadata, deterministic replay after restoration, corruption rejection and refusal to overwrite existing files. It does not establish a production recovery-time guarantee.

## Rehearse restoration and every archived calculation

```sh
node scripts/research-backup.mjs rehearse /private/backup/location/snapshot-001 /private/restore/location/drill-001
```

The new private directory retains a restored `research.sqlite` and `rehearsal.json`. Existing directories are refused. The command validates and restores the snapshot, then opens the restored database read-only and checks **every** run with calculation inputs using its saved engine files. Temporary replay files are removed after each run. The application and live database are not opened by this command; no API restart or cutover occurs.

The report records per-run outcomes, engine/input hashes for matches, elapsed replay times, aggregate restore/replay/total milliseconds, and explicit failures. Saved runs without calculation inputs are counted separately: preserved provider failures are not replay successes. A backup with no calculations reports `no-calculations`, not a passing reproducibility check. Exit status is zero only for `passed`; mismatches, corrupt backups, timeouts and no-calculation rehearsals return a nonzero exit status. Inspect the report before using a recovered database.

Each calculation has a 60-second limit and a 2 MiB process-output limit. The original archived engine runs in a separate Node process with an empty environment and filesystem access restricted to its temporary replay directory. Use trusted backups: [Node's permission model](https://nodejs.org/download/release/v22.17.0/docs/api/permissions.html) limits accidental resource access and is not a sandbox for hostile code. A matching calculation is evidence of reproducibility, not source authenticity or investment validity.

These timings measure this machine and this snapshot. They exclude incident detection, retrieving an offsite backup, application/configuration recovery, provider reconnection and live cutover. Repeat on deployment-equivalent infrastructure before setting a recovery-time objective. Retain the private report as drill evidence and remove the restored copy when it is no longer needed.
