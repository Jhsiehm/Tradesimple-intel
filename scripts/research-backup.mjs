import { rehearseResearchBackup } from "../server/domain/research-rehearsal.mjs";
import {
  createResearchBackup,
  verifyResearchBackup,
  restoreResearchBackup,
} from "../server/domain/research-backup.mjs";
const [command, first, second, ...extra] = process.argv.slice(2);
try {
  if (extra.length || !first || (command !== "verify" && !second) || (command === "verify" && second))
    throw new Error(
      "Usage: node scripts/research-backup.mjs create SOURCE_DB NEW_BACKUP_DIR | verify BACKUP_DIR | restore BACKUP_DIR NEW_DB_PATH | rehearse BACKUP_DIR NEW_REHEARSAL_DIR",
    );
  let result;
  if (command === "create") result = createResearchBackup(first, second);
  else if (command === "verify") result = verifyResearchBackup(first);
  else if (command === "restore") result = restoreResearchBackup(first, second);
  else if (command === "rehearse") {
    result = rehearseResearchBackup(first, second);
    if (result.status !== "passed") process.exitCode = 1;
  } else throw new Error("Choose create, verify, restore or rehearse.");
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
