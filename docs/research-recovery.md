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
