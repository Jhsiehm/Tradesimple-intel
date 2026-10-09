import fs from "node:fs";
import readline from "node:readline";
import { Readable } from "node:stream";
import { createInflateRaw } from "node:zlib";

const EOCD = 0x06054b50;
const EOCD64_LOCATOR = 0x07064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX32 = 0xffffffff;

function readAt(fd, position, length) {
  const buf = Buffer.alloc(length);
  const n = fs.readSync(fd, buf, 0, length, position);
  return buf.subarray(0, n);
}

/** Zip64 extra field (0x0001): the 64-bit values for whichever 32-bit fields were saturated, in spec order. */
function zip64Extra(extra, entry) {
  for (let p = 0; p + 4 <= extra.length;) {
    const id = extra.readUInt16LE(p);
    const size = extra.readUInt16LE(p + 2);
    if (id === 0x0001) {
      let q = p + 4;
      for (const k of ["size", "compressedSize", "offset"]) {
        if (entry[k] !== MAX32) continue;
        entry[k] = Number(extra.readBigUInt64LE(q));
        q += 8;
      }
      return;
    }
    p += 4 + size;
  }
}

/** Entries of a zip file on disk (name, method, sizes, local header offset). Reads only the central directory. */
export function zipEntries(file) {
  const fd = fs.openSync(file, "r");
  try {
    const { size } = fs.fstatSync(fd);
    const tailLen = Math.min(size, 65557);
    const tail = readAt(fd, size - tailLen, tailLen);
    let at = -1;
    for (let i = tail.length - 22; i >= 0; i -= 1) if (tail.readUInt32LE(i) === EOCD) { at = i; break; }
    if (at < 0) throw new Error("not a zip file (no end-of-central-directory record)");
    let count = tail.readUInt16LE(at + 10);
    let cdSize = tail.readUInt32LE(at + 12);
    let cdOffset = tail.readUInt32LE(at + 16);
    if ((cdOffset === MAX32 || count === 0xffff) && at >= 20 && tail.readUInt32LE(at - 20) === EOCD64_LOCATOR) {
      const rec = readAt(fd, Number(tail.readBigUInt64LE(at - 12)), 56);
      count = Number(rec.readBigUInt64LE(32));
      cdSize = Number(rec.readBigUInt64LE(40));
      cdOffset = Number(rec.readBigUInt64LE(48));
    }
    const cd = readAt(fd, cdOffset, cdSize);
    const out = [];
    for (let p = 0, i = 0; i < count && p + 46 <= cd.length; i += 1) {
      if (cd.readUInt32LE(p) !== CENTRAL) throw new Error("corrupt zip central directory");
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const entry = {
        name: cd.subarray(p + 46, p + 46 + nameLen).toString("utf8"),
        method: cd.readUInt16LE(p + 10),
        compressedSize: cd.readUInt32LE(p + 20),
        size: cd.readUInt32LE(p + 24),
        offset: cd.readUInt32LE(p + 42)
      };
      zip64Extra(cd.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen), entry);
      out.push(entry);
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  } finally {
    fs.closeSync(fd);
  }
}

/** A readable stream of one entry's uncompressed bytes (stored or deflated); memory stays at stream buffer size. */
export function zipEntryStream(file, entry) {
  const fd = fs.openSync(file, "r");
  let header;
  try { header = readAt(fd, entry.offset, 30); } finally { fs.closeSync(fd); }
  if (header.readUInt32LE(0) !== LOCAL) throw new Error(`corrupt zip local header for ${entry.name}`);
  const start = entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  if (!entry.compressedSize) return Readable.from([]);
  const raw = fs.createReadStream(file, { start, end: start + entry.compressedSize - 1 });
  if (entry.method === 0) return raw;
  if (entry.method !== 8) throw new Error(`zip method ${entry.method} is not supported (${entry.name})`);
  const inflate = createInflateRaw();
  raw.on("error", (err) => inflate.destroy(err));
  return raw.pipe(inflate);
}

/** Lines of one zip entry, streamed. */
export async function* zipEntryLines(file, name) {
  const entry = zipEntries(file).find((e) => e.name === name || e.name.endsWith(`/${name}`));
  if (!entry) throw new Error(`${name} is not in ${file}`);
  const rl = readline.createInterface({ input: zipEntryStream(file, entry), crlfDelay: Infinity });
  for await (const line of rl) yield line;
}
