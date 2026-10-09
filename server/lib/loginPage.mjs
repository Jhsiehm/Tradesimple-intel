/** Sign-in and sign-out pages. Self-contained (no app assets load before sign-in), no scripts. */

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const PAGE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY"
};

function shell(title, inner) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${esc(title)} · TradeSimple Intel</title>
<style>
:root{color-scheme:dark;--bg:#07090c;--panel:#0d1115;--ink:#e4e7e6;--dim:#8a949b;--line:#232c34;--amber:#ffc14a;--nay:#ff4d6a}
*{box-sizing:border-box}html,body{height:100%;margin:0}
body{display:grid;place-items:center;background:var(--bg);color:var(--ink);font:13px/1.5 ui-monospace,"SF Mono",Menlo,Consolas,monospace}
main{width:min(340px,calc(100vw - 32px));border:1px solid var(--line);background:var(--panel);padding:24px}
h1{margin:0 0 4px;font-size:13px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--amber)}
p{margin:0 0 16px;color:var(--dim)}
label{display:block;margin:12px 0 4px;color:var(--dim)}
input{width:100%;padding:8px 10px;border:1px solid var(--line);background:var(--bg);color:var(--ink);font:inherit}
input:focus{outline:1px solid var(--amber);outline-offset:1px}
button{margin-top:16px;width:100%;padding:8px;border:1px solid var(--amber);background:transparent;color:var(--amber);font:inherit;cursor:pointer}
button:hover{background:rgba(255,193,74,.08)}
.err{color:var(--nay);margin:12px 0 0}
</style></head><body><main>${inner}</main></body></html>`;
}

export function loginPage({ next = "/", error = "", totp = false } = {}) {
  return shell("Sign in", `<h1>TradeSimple Intel</h1><p>Research terminal. Sign in to continue.</p>
<form method="post" action="/login">
<input type="hidden" name="next" value="${esc(next)}">
<label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
${totp ? `<label for="code">Authenticator code</label><input id="code" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required>` : ""}
<button type="submit">Sign in</button>
${error ? `<p class="err" role="alert">${esc(error)}</p>` : ""}
</form>`);
}

export function logoutPage() {
  return shell("Sign out", `<h1>TradeSimple Intel</h1><p>Sign out of this browser.</p>
<form method="post" action="/logout"><button type="submit">Sign out</button></form>`);
}
