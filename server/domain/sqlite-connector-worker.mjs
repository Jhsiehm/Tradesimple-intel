/** One bounded read-only query in an expendable process. Never print paths, SQL or SQLite errors. */
import { DatabaseSync } from "node:sqlite";
const fail = (message) => {
  process.stdout.write(JSON.stringify({ ok: false, error: message }));
};
let db;
try {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 32768) throw Error("configuration");
  }
  const { file, query, rowLimit, byteLimit } = JSON.parse(input);
  db = new DatabaseSync(file, { readOnly: true, allowExtension: false });
  db.exec("PRAGMA hard_heap_limit=67108864; PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; BEGIN");
  const statement = db.prepare(`SELECT * FROM (${query}) LIMIT ${rowLimit + 1}`);
  statement.setReadBigInts(true);
  const rows = [];
  let bytes = 2;
  for (const raw of statement.iterate()) {
    if (rows.length === rowLimit) {
      fail("Database connector exceeds 5,000 rows. Narrow the configured query.");
      process.exit(0);
    }
    const row = Object.create(null);
    for (const [key, value] of Object.entries(raw)) {
      if (value instanceof Uint8Array) throw Error("blob");
      if (typeof value === "number" && !Number.isFinite(value)) throw Error("number");
      row[key] =
        typeof value === "bigint"
          ? value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
            ? Number(value)
            : String(value)
          : value;
    }
    bytes += Buffer.byteLength(JSON.stringify(row)) + 1;
    if (bytes > byteLimit) {
      fail("Database connector exceeds 2 MiB. Narrow the configured query.");
      process.exit(0);
    }
    rows.push(row);
  }
  db.exec("COMMIT");
  db.close();
  db = null;
  process.stdout.write(JSON.stringify({ ok: true, items: rows }));
} catch (error) {
  fail(
    error.message === "blob"
      ? "Database connector returned binary data. Cast or omit binary columns."
      : "Database connector query failed. Check the configured read-only query and database.",
  );
} finally {
  db?.close();
}
