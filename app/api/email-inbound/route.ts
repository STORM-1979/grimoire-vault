import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { withErrorHandler, HttpError } from "@/lib/api-helpers";
import { createEntry } from "@/lib/data/entries";

/**
 * POST /api/email-inbound — webhook for inbound email forwarding.
 *
 * Stub-friendly: any provider that POSTs an `{ to, subject, text,
 * from }` payload (Postmark, SendGrid Inbound Parse, Mailgun Routes,
 * SES + SNS, etc.) hits this endpoint and the user's vault gets a
 * new entry.  The `to` address is matched against the
 * `email_aliases` table (alias → user_id mapping); the body's URL
 * (if any) goes through the existing extract pipeline.
 *
 * Setup checklist (deferred — needs DNS + provider account):
 *   1. Provision a domain (e.g. `gv-mail.your-domain.com`) with MX
 *      records pointing at Postmark / SendGrid.
 *   2. Configure the provider to POST inbound to
 *      https://grimoire-vault.vercel.app/api/email-inbound.
 *   3. Add a webhook secret as `EMAIL_WEBHOOK_SECRET` env var,
 *      verify it in the handler below.
 *   4. Create the `email_aliases` table (see deferred migration in
 *      docs/UPGRADING.md "Email-to-vault" section).
 *   5. Add a Settings UI for users to provision their alias.
 *
 * For now this endpoint accepts the payload, validates schema,
 * saves to misc category for the configured owner — enough to test
 * end-to-end once the DNS / webhook half is in place.
 */

// Module-scoped cache of the resolved owner id, keyed by the email the
// resolution was done against.  Lambda lifetime only — Vercel recycles
// these frequently enough that a stale value doesn't outlast a config
// change in any meaningful way.
let ownerCache: { email: string; id: string } | null = null;

const inboundSchema = z.object({
  to: z.string().email().optional(),
  from: z.string().email().optional(),
  subject: z.string().max(500).optional(),
  text: z.string().max(20000).optional(),
  html: z.string().max(50000).optional(),
});

export const POST = withErrorHandler(async (req: Request) => {
  // Verify webhook secret to prevent random POSTs from creating
  // entries.  Without EMAIL_WEBHOOK_SECRET configured we refuse all
  // requests — opening this endpoint is opt-in via env var, not the
  // default state.  Earlier draft skipped the check entirely when
  // the env was unset, which let anyone with the URL DOS the owner.
  const secret = process.env.EMAIL_WEBHOOK_SECRET;
  if (!secret) {
    throw new HttpError("Email inbound is not configured on this deployment", 503);
  }
  const reqUrl = new URL(req.url);
  const provided = reqUrl.searchParams.get("secret") ?? req.headers.get("x-webhook-secret");
  if (provided !== secret) throw new HttpError("Unauthorized", 401);

  let body: unknown;
  try { body = await req.json(); }
  catch { throw new HttpError("Body must be valid JSON", 400); }
  const parsed = inboundSchema.safeParse(body);
  if (!parsed.success) throw new HttpError("Invalid payload", 400);
  const { from, subject, text, html } = parsed.data;
  // `to` is read once email_aliases lands; for now everything routes
  // to OWNER_EMAIL so we ignore the destination address.

  // TODO(email-aliases): replace this with a real lookup against
  // public.email_aliases keyed by `to`.  For now we route everything
  // to the configured owner.
  //
  // Resolution order:
  //   1. OWNER_USER_ID env var — direct UUID, no admin-API call.
  //      Preferred for production: one webhook hit = one DB write,
  //      no rate-limit pressure on Supabase's admin endpoint.
  //   2. OWNER_EMAIL env var — fall back to admin.listUsers() and
  //      filter by email.  Used when the admin only knows their
  //      sign-in email, not the internal user id.
  const svc = createServiceClient();
  const ownerUserId = process.env.OWNER_USER_ID;
  const ownerEmail = process.env.OWNER_EMAIL;
  let ownerId: string | null = null;

  if (ownerUserId) {
    ownerId = ownerUserId;
  } else if (ownerEmail) {
    // The admin API has its own rate limit and listing all users
    // scales O(n) — fine for a personal vault but worth not doing on
    // every webhook hit.  In-process memoise so repeated webhooks
    // within the lambda's lifetime don't re-pay the cost.
    if (!ownerCache || ownerCache.email !== ownerEmail) {
      const { data: { users } } = await svc.auth.admin.listUsers();
      const owner = users.find((u) => u.email === ownerEmail);
      if (!owner) throw new HttpError("Owner not found", 503);
      ownerCache = { email: ownerEmail, id: owner.id };
    }
    ownerId = ownerCache.id;
  } else {
    throw new HttpError("Server not configured for email inbound", 503);
  }

  // Detect URL in the body — falls back to subject as title if none.
  const combined = (text ?? "") + " " + (html ?? "");
  const urlMatch = combined.match(/https?:\/\/[^\s)>"'`]+/);
  const url = urlMatch?.[0] ?? null;

  await createEntry(ownerId, {
    categoryId: url ? "web" : "misc",
    title: subject?.trim() || "(email)",
    description: text?.trim().slice(0, 2000) || null,
    url: url ?? undefined,
    tags: ["email", from?.split("@")[1] ?? "inbox"].filter(Boolean) as string[],
    pinned: false,
    metadata: { capturedVia: "email", from },
    importedVia: "web",
  });

  return NextResponse.json({ ok: true });
});
