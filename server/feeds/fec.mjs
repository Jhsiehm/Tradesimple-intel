import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fetchResponse } from "../lib/http.mjs";
import { DAY } from "../lib/time.mjs";

const execFileAsync = promisify(execFile);

export async function fecBulk(name, cycle, inner) {
  const zip = path.join(os.tmpdir(), `fec-${name}.zip`);
  const fresh = fs.existsSync(zip) && Date.now() - fs.statSync(zip).mtimeMs < (cycle >= new Date().getUTCFullYear() ? DAY : 7 * DAY);
  if (!fresh) {
    const res = await fetchResponse(`https://www.fec.gov/files/bulk-downloads/${cycle}/${name}.zip`, { redirect: "follow" }, 180000);
    if (!res.ok) throw new Error(`FEC ${name} HTTP ${res.status}`);
    fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  }
  const { stdout } = await execFileAsync("unzip", ["-p", zip, inner], { maxBuffer: 400 * 1024 * 1024, encoding: "latin1" });
  return stdout;
}
