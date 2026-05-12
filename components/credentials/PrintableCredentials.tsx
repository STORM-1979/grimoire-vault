"use client";

import type { CredentialDecrypted } from "@/lib/types";

/**
 * Print-only credentials sheet.  Renders an absolutely-positioned
 * white page with every decrypted credential laid out as a card —
 * service, URL, username, password (plain text), 2FA flag, notes,
 * tags.  Invisible on screen (hidden class), shown only when the
 * browser print dialog kicks in via the @media print rules in
 * globals.css.
 *
 * Pure presentational — the parent decides when to render this
 * and when to call window.print().
 *
 * Why an in-page hidden component instead of window.open() + a
 * detached HTML document: keeping it inside the React tree means
 * the decrypted values never leave the existing security boundary
 * (master key in sessionStorage, vault unlocked in this tab).  A
 * new window would inherit cookies but the master key wouldn't be
 * available, so we'd have to ship plaintext via URL/postMessage —
 * worse.
 */
export function PrintableCredentials({ items }: { items: CredentialDecrypted[] }) {
  const today = new Date();
  // Sort: pinned first, then alphabetical by service so the
  // printed sheet has a stable order independent of the on-screen
  // sort preference.
  const sorted = [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return a.service.localeCompare(b.service, "ru", { sensitivity: "base" });
  });

  return (
    <section className="printable hidden print:block">
      <header className="printable-head">
        <div className="printable-brand">Grimoire Vault — Credentials</div>
        <div className="printable-meta">
          {sorted.length} {plural(sorted.length, "запись", "записи", "записей")} · сгенерировано{" "}
          {today.toLocaleString("ru-RU", {
            year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit",
          })}
        </div>
        <div className="printable-warning">
          КОНФИДЕНЦИАЛЬНО · Не оставляйте распечатку без присмотра ·
          После использования храните в сейфе или уничтожьте
        </div>
      </header>

      <ol className="printable-list">
        {sorted.map((it, i) => (
          <li key={it.id} className="printable-card">
            <div className="printable-index">{i + 1}</div>
            <div className="printable-body">
              <div className="printable-service">
                {it.service}{it.twoFactor && <span className="printable-2fa"> · 2FA</span>}
              </div>
              {it.url && <div className="printable-url">{it.url}</div>}
              <dl className="printable-fields">
                <dt>Username</dt>
                <dd>{it.username || "—"}</dd>
                <dt>Password</dt>
                <dd className="printable-password">{it.password}</dd>
                {it.notes && (
                  <>
                    <dt>Notes</dt>
                    <dd className="printable-notes">{it.notes}</dd>
                  </>
                )}
                {it.tags.length > 0 && (
                  <>
                    <dt>Tags</dt>
                    <dd>{it.tags.join(", ")}</dd>
                  </>
                )}
              </dl>
            </div>
          </li>
        ))}
      </ol>

      <footer className="printable-foot">
        Grimoire Vault · personal knowledge base
      </footer>
    </section>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
