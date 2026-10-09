/**
 * `npm run auth:hash` prints the sign-in lines for /etc/tradesimple/env on a hosted copy:
 * INTEL_PASSWORD_HASH (scrypt) and a fresh INTEL_SESSION_SECRET. `-- --totp` also prints INTEL_TOTP_SECRET and an
 * otpauth:// link for an authenticator app. The password is typed at a hidden prompt (or piped on stdin), never
 * passed as an argument, so it stays out of shell history and `ps`.
 */
import crypto from "node:crypto";
import { base32Encode, hashPassword } from "../server/lib/auth.mjs";

async function readHidden(prompt) {
  const { stdin, stderr } = process;
  if (!stdin.isTTY) {
    let text = "";
    for await (const chunk of stdin) text += chunk;
    return text.split("\n")[0].replace(/\r$/, "");
  }
  stderr.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const done = (fn) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      stderr.write("\n");
      fn();
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return done(() => resolve(value));
        if (ch === "\u0003") return done(() => reject(new Error("Cancelled.")));
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else if (ch >= " ") value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

const password = await readHidden("New sign-in password: ");
if (password.length < 12) {
  console.error("Use at least 12 characters (a passphrase of 4+ random words is best).");
  process.exit(1);
}
if (process.stdin.isTTY && (await readHidden("Repeat it: ")) !== password) {
  console.error("The two entries differ.");
  process.exit(1);
}

const lines = [
  "# Sign-in for the hosted copy. Paste into /etc/tradesimple/env on the server (never into git).",
  `INTEL_PASSWORD_HASH=${await hashPassword(password)}`,
  `INTEL_SESSION_SECRET=${crypto.randomBytes(48).toString("base64url")}`
];
if (process.argv.includes("--totp")) {
  const secret = base32Encode(crypto.randomBytes(20));
  lines.push(`INTEL_TOTP_SECRET=${secret}`);
  console.error(`Add this to your authenticator app (or type the secret in by hand):\n  otpauth://totp/TradeSimple%20Intel?secret=${secret}&issuer=TradeSimple&digits=6&period=30\n`);
}
console.log(lines.join("\n"));
