# Relay — private seller marketplace

A React + TypeScript application for an invitation-only dropshipping beta. Supabase owns authentication, PostgreSQL transactions, private storage, and invitation email dispatch. Payments are arranged outside the application. There is no payment processor.

## Current delivery status

The frontend, database migrations, invitation Edge Function, automated tests, and deployment configuration are included. The production build and 51 automated checks have passed locally. The dashboard, catalog route, and setup state have been checked in the local browser.

**The local app is now connected to the user’s Supabase project; the hosted frontend has not been deployed.** The administrator setup and initial invitation acceptance were completed with the user. The seller invitation function is deployed at `swift-worker`; its OPTIONS/GET behavior and signed-out POST rejection have been verified without sending invitations. Seller email delivery, storage uploads/signed URLs, and real concurrent PostgreSQL connections still require integration verification. The database tests execute the actual migrations in embedded PostgreSQL with small Auth/Storage schema substitutes; they do not replace testing Supabase's services. No example customer records or manufactured order balances are supplied.

## Free setup: start here

1. Sign in at [supabase.com](https://supabase.com/) using your GitHub account. Create an organization on the **Free** plan, then create a project. Choose a nearby region and save the database password in your password manager. Do not paste that password into chat or commit it.
2. Open the project's Connect/API screen. Copy the **Project URL** and **publishable key**. These two browser-safe settings are needed by the application. Never use a secret or `service_role` key in the frontend.
3. Create a **private GitHub repository**, for example `relay-marketplace`. Upload the contents of this source folder, including `.github`, `.gitignore`, and the lockfile. Do not upload `node_modules`, `.env`, shipping labels, or any business/customer exports.
4. Create a free [Cloudflare account](https://dash.cloudflare.com/). In Workers & Pages, create a **Pages** project connected to your GitHub repository. Use `npm run build` as the build command, `dist` as the output directory, and Node 22. Add the two environment settings below. Cloudflare redeploys when you push to the configured branch.
5. Use the free `*.pages.dev` address. No purchased domain is required for website hosting. Follow the Supabase and invitation-email steps below before inviting sellers.

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_PUBLISHABLE_KEY
VITE_INVITATION_FUNCTION=invite-seller
```

### Why the host differs from the original brief

[GitHub Pages policy](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) prohibits operating an online business, e-commerce site, or commercial SaaS on Pages. Relay still keeps its source and CI in GitHub; Cloudflare Pages serves the static application. A non-enabled GitHub Pages workflow is supplied under `deployment/` for reference, with the policy restriction documented. It is deliberately not an active production workflow.

### Free-plan limits and invitation emails

At verification on November 2, 2026, [Supabase Free](https://supabase.com/pricing) includes a 500 MB database and 1 GB of file storage; inactive Free projects can pause after one week. Monitor usage, compress product images, and back up business records. Signed links do not delete stored label files. Storage can eventually fill, so an administrator must manage a retention policy appropriate for the business before removing old labels. Credits and their audit history must be retained.

Supabase's [default email sender](https://supabase.com/docs/guides/auth/auth-smtp) is restricted to project team addresses and a low test rate. It cannot deliver invitations to your normal sellers. Configure **custom SMTP** under Authentication → Email/SMTP first. [Brevo Free](https://help.brevo.com/hc/en-us/articles/208589409-About-Brevo-s-pricing-plans) is one option with 300 daily emails. Register its free plan, enable transactional email, verify an allowed sender, and copy its SMTP host/login/key into Supabase's SMTP settings. Follow the provider's sender approval rules; a domain may be needed for the sender identity you choose. No paid Supabase plan is required for custom SMTP. Never put SMTP credentials in GitHub or in frontend variables.

The host, database and email sender can start on free plans within provider limits. Availability, sender approval and future pricing are controlled by those providers; no paid subscription is enabled by this source code.

## Apply the database

For a first hosted project without a command line, open Supabase's SQL Editor. Run these files **in order, once**:

1. `supabase/migrations/202611020001_workspace.sql`
2. `supabase/migrations/202611020002_internal_notes.sql`
3. `supabase/migrations/202611030001_payment_terms.sql`

These create all tables, constraints, immutable ledgers, RLS policies, private file buckets, and transactional operations. Do not paste a migration repeatedly into a populated database. For future changes, use additional migrations.

Alternatively, install the official [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started), then run from the project folder:

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

In hosted Supabase Auth settings:

- **Disable public signups.** Enable email confirmations. Disable anonymous sign-ins and unused login providers.
- Set the Site URL and redirect allowlist to your exact deployed application address, including any path prefix. Use only trusted origins.
- Set the email OTP/invitation token lifetime to **604800 seconds (7 days)**. The database enforces the shorter per-invitation expiration (default 24 hours, adjustable to 1–168 hours). Both limits apply; an expired invitation cannot activate an account.
- Configure custom SMTP and test delivery before inviting sellers.
- Use a minimum password length of 12 in Auth settings to match the UI.

For local Supabase, `supabase/config.toml` contains local equivalents. Restart the local stack after configuration changes.

## Create your first administrator

This bootstrap happens once using the project owner's dashboard. The app never lets a seller promote themselves.

1. In SQL Editor, substitute your actual email and run:

```sql
insert into public.invitations(email, expires_at)
values (lower('YOUR_EMAIL'), now() + interval '1 day');
```

2. In Authentication → Users, **invite** that same email address. Use the deployed app as the redirect URL. Do not create a pre-confirmed user as a shortcut; accept the email invitation to verify your identity.
3. Before accepting, promote that new profile in SQL Editor:

```sql
update public.profiles
set role = 'admin'
where email = lower('YOUR_EMAIL');
```

4. Open your invitation email, follow its single-use link, and set a password in Relay. Sign out and sign in again to verify the account.

Keep project-owner access limited. Additional administrator promotions require the project owner; there is no public role-change endpoint.

## Deploy seller invitations

The invitation function validates the caller's JWT, checks the current database role/suspension status, records an expiring invitation, then uses Supabase's backend-only service credential to send the invite. `verify_jwt = false` in the function config allows newer publishable-key setups; **the function explicitly validates every caller with `auth.getUser()` and the database administrator check**.

```sh
supabase functions deploy invite-seller
supabase secrets set APP_ORIGINS=https://YOUR_SITE.pages.dev
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected by the Supabase hosted Edge environment. Do not copy the privileged key into a local environment file or the frontend. For multiple trusted origins, set `APP_ORIGINS` to a comma-separated list, without spaces. Set the same trusted redirect URL in Supabase Auth.

If you deployed through the dashboard under a different endpoint slug, set `VITE_INVITATION_FUNCTION` to that slug in your local `.env` and hosting build environment. This project currently uses `swift-worker` on the connected Supabase project. A display-name change in the dashboard does not change the endpoint slug. The source folder and CLI deployment name remain `invite-seller`; the configurable frontend setting supports either endpoint.

Administrators can now open Sellers → Invite seller. Invitation settings are under Settings. The Auth verification link is single-use, and the database rejects confirmation after its configured expiration.

If an invitation expires, this beta does not include a resend/reinvite interface. The project owner must remove the never-activated Auth user/profile and expired invitation through the dashboard/SQL before sending a new invitation. First confirm the account has never activated and has no business records; do not remove active sellers or ledger history. A failed SMTP attempt may leave an unconfirmed Auth user, which also requires owner review before retrying.

## Run locally

Use Node 22 or later. Copy `.env.example` to `.env` and fill only the two public settings.

```sh
npm ci
npm run dev
```

With no environment configuration, Relay displays a setup state and empty catalog. It does not fabricate payment approvals, credit balances or shipments. With configuration, the application requires authentication before showing the workspace.

```sh
npm test
npm run build
npm run preview
```

The application uses validated hash routes, so refreshing a nested view works on static hosting without rewrite rules. Supabase uses the initial fragment for verification/recovery links; the app ignores non-route fragments while the Auth client processes them.

## Workflow and accounting

1. **Products:** Create a product, add variants/SKUs, upload photos/listing assets, then add physical stock in Inventory with a reason. New variants start with zero stock. Prices are stored as integer cents.
2. **Credits:** The seller requests a whole quantity of one variant. The request captures the current wholesale price. Reporting payment changes status and notifies administrators; no credits are issued.
3. **Verification:** An administrator records received date, payment method and internal notes after checking funds outside Relay. Verification creates an immutable payment record; approval is separate.
4. **Approval:** One transaction locks the request, seller and variant, checks verified upfront payment or explicit pay-later permission, checks uncommitted stock, adds credits, records inventory/credit ledgers and notifies the seller. Unpaid pay-later approval requires an administrator reason. Repeated approval returns the original result.
5. **Submission:** The seller uploads 1–10 private prepaid labels, selects quantity and confirms. One transaction locks the variant and balance, validates label ownership, creates the order and reserves credits. An idempotency key prevents repeat submission of the same draft.
6. **Fulfillment:** Acceptance moves reserved credits to consumed. Rejection or cancellation is allowed only before acceptance and restores reserved credits to available. The seller still owns the credits, so the stock commitment remains. Accepted orders cannot be canceled through the beta; arrange exceptional corrections through the owner and audited adjustment process.
7. **Shipping:** Recording tracking and shipment deducts physical stock and the corresponding commitment exactly once. Packaging is optional before shipping. Completed follows shipped. Internal administrator notes are stored separately from seller-readable order history.

`issued = available + reserved + consumed` always. `0 <= committed <= stock` always. Inventory commitments include available/reserved credits **and accepted but unshipped units**; shipment retires the commitment. Reserved units shown in Inventory are a subset of commitments, never an additional deduction. Shipped is cumulative. Credits never expire and no expiration job exists.

Positive manual credit adjustments are explicit administrator corrections and must carry a reason; they also commit physical stock and cannot overissue. Removing credits can remove only available credits, so reserved or consumed balances cannot be silently reversed. Inventory corrections cannot take stock below outstanding commitments.

## Tests and remaining integration verification

`npm test` runs 51 checks including the actual SQL migrations in embedded PostgreSQL, transaction rollback, invitation gating/expiration, immutable logs, RLS under `authenticated`/`anon`, private note isolation, label ownership policies, and accounting workflows. Auth and Storage tables are modeled for these tests; real Supabase APIs must also be tested.

`.github/workflows/checks.yml` builds the UI and runs unit/database checks. A separate job starts a disposable Supabase stack and runs `scripts/concurrency.mjs` against real PostgreSQL with multiple independent connections. It tests simultaneous approval, competing credit reservations, and identical repeated fulfillment submission. **This multi-connection suite has not been executed on the current computer because Docker/Supabase CLI are not installed.** It will run in GitHub Actions after upload.

You can run that suite locally with Docker and the Supabase CLI, using a fresh disposable local database:

```sh
supabase start
# Set DATABASE_URL to the local connection shown by Supabase status.
# Set RUN_DISPOSABLE_DATABASE_TESTS=yes in your shell.
node scripts/concurrency.mjs
```

The concurrency script refuses non-local databases and creates permanent test audit fixtures. Use only a disposable local stack. A local reset removes all local data; never point test/reset commands at production.

Before the private beta starts, verify with two real seller accounts and one administrator:

- Public signup denied, email invitation confirmation, login, logout, persistent session, password reset and invitation expiration.
- Product/variant editing, photos and ZIP downloads, copy listing text, and archived catalog behavior.
- Reported payment leaves balances unchanged; payment verification and approval issue credits once.
- Private PDF/image uploads, preview/download via expiring signed URLs, and denial of another seller's file access.
- Concurrent reservations, rejection/cancellation restoration, acceptance, packaging, shipment/tracking and duplicate shipment handling.
- Suspended seller access denied, administrator-only mutations denied to sellers, and notifications read state.
- Mobile layouts, keyboard navigation and the deployed host's authentication redirect flow.

## Files

- `src/`: responsive seller/admin UI, authentication, calculator, storage and RPC client.
- `supabase/migrations/`: schema, RLS, immutable ledgers and atomic business logic.
- `supabase/functions/invite-seller/`: authenticated administrator invitation dispatch.
- `tests/`: executable database and domain checks.
- `scripts/concurrency.mjs`: true multi-connection test for disposable local Supabase.
- `.github/workflows/checks.yml`: CI validation; Cloudflare handles Git-connected production deployment.
- `deployment/github-pages.yml.example`: reference workflow, inactive due to the commercial-use restriction.

Never commit `.env`, passwords, privileged keys, email credentials, labels or customer information. Public publishable keys are expected to be visible in the browser; authorization comes from Auth, RLS, and the database functions, not from hiding the public key.

## Per-seller payment permission

Existing and new sellers default to **Pay upfront**. In Sellers → Payment terms, an administrator can permit **Pay later**, with a required reason. Sellers cannot edit this permission. Every credit request still needs administrator approval; there is no direct label-submission bypass and no automatic credit issuance.

A request records the seller's terms at submission. Pay-upfront requests require verified full payment before approval. Pay-later requests enter review without issuing credits; the administrator can approve before payment with a reason, subject to physical inventory limits. Approval records the full purchase as outstanding until payment is verified. The seller can report payment after approval, and the administrator can verify it in Payment Verification without issuing credits again. Only full-payment verification is currently supported; no installment schedule or automatic due date is assumed.

Changing permission does not rewrite earlier requests or remove existing amounts owed. Revoking pay-later permission blocks further unpaid approvals, even for earlier pending pay-later requests. An earlier prepaid request still requires payment; submit a new request to use newly granted terms. Already approved credits remain valid and existing unpaid purchases remain payable.

For an existing project that has the first two migrations installed, run **only** the new payment-terms migration once. The supplied **payment-terms-update.sql** file wraps it in a transaction. Permission controls stay disabled until the new columns are installed. Refresh the app after applying it. No seller is switched to pay-later automatically.

## Order controls and data housekeeping — November 3, 2026

Administrator controls now support recoverable deletion/restoration of every fulfillment status and every credit-request status. Deleting pending/accepted/packaging fulfillment cancels it and returns reserved/consumed units to available credits without changing physical stock or its credit commitments. Shipped/completed records retain stock, tracking and consumed-credit totals. Restore recovers visibility; canceled fulfillment stays canceled and needs a new label submission.

Credit-request deletion hides the record only. Issued credits, payment evidence and amounts owed remain unchanged; outstanding totals include deleted approved purchases. Restore before processing payment or approval. Removing available credits is a separate audited Sellers → View history → Adjust action.

Inventory supports existing positive/negative Adjust stock and a new exact Set stock count, with reasons and a database guard against stock below committed credits. Automatic housekeeping is administrator-only, serialized and throttled to once daily when the app is used. It removes at most 1,000 notifications and 1,000 unused expired invitations per run: read notices 30 days after reading, unread notices 90 days after creation, and unaccepted unlinked invitations 90 days after expiry. It preserves linked/accepted invitations and all order, payment, credit and inventory histories. Empty runs do not create audit rows. Routine profile edits and marking notifications read no longer add administrator audit clutter.

Activity ledgers fetch the latest 100 records each (older rows remain recorded). A duplicate refresh timer was removed. This does not cap the size of core business records or guarantee the project will always fit a free plan.

Existing project: run outputs/order-management-update.sql in Supabase SQL Editor, then refresh the app. It includes the fourth migration and is safe to reapply. Delete/Restore and Set stock stay disabled until the matching database controls exist. Existing Adjust stock works without it. Housekeeping also requires this update. Production build and all **67 automated tests** pass, including every fulfillment status, request archival/debt preservation, admin permission checks, stock bounds, retry safety, update reapplication and retention boundaries. Hosted activation is still pending the owner running the SQL; no disposable production fixtures were created.

Operational correction verified: removed the test seller's 3 available John Pork Chain credits through an audited adjustment. Physical stock 20, committed 0, available inventory 20. The original $14.97 unpaid approved purchase remains recorded.

## Account controls — November 3, 2026 (current behavior)

Reasons are now optional for administrator deletion/restoration, rejection, payment-term changes, pay-later approval, stock and credit adjustments, and seller suspension/restoration. This supersedes earlier instructions requiring reasons. Actor, timestamp and financial/inventory changes remain recorded automatically.

Sellers → Change balance accepts an exact nonnegative dollar total, including zero, without changing issued product credits, physical stock, original purchase prices or payment-verification evidence. Reductions clear manual balances first, then reduce outstanding unpaid invoices from newest to oldest. Increases apply to the oldest unpaid approved invoice; with none, they create a manual account amount. A later full-payment verification clears only the selected invoice's adjusted outstanding amount, preventing negative debt or duplicate credit issuance. Manual amounts can be cleared with Change balance; they are never represented as a verified payment automatically. Deleted approved purchases remain included until their balance is adjusted or settled. Both seller and administrator displays use these adjusted amounts.

Administrator edits record before/after amounts and invoice allocation changes in the existing immutable audit log. Per-seller locks serialize approval, settlement and balance edits; stale form submissions are rejected for review. Reapplying the account migration preserves prior adjustments. Seller billing rows have owner/admin read policies and no direct client-write privileges. No extra financial history table or periodic audit spam was added.

All **78 automated tests** and the production build pass. The owner ran account-controls-update.sql successfully. Live verification confirmed the admin Change balance controls are enabled, the actual seller editor shows $14.97, and its Reason field has no required attribute. The editor was left open without submitting a balance change because the owner has not specified a new amount. Existing reasons can be blank, and the database retains automatic audit entries.

Five source migrations are packaged. Existing projects with payment terms installed can apply the supplied account-controls-update.sql, which includes the prerequisite order-management update. New projects use supabase-setup.sql only. Do not reapply an older feature update after the latest account update.

## Automatic approval and GPOP identity — November 3, 2026 (current behavior)

The website is now **GPOP Fulfillment**, including the page title, authentication screens, navigation, footer and payment copy. A small local SVG red package with a G is used for the brand mark, favicon and dashboard parcel. Primary buttons, selected navigation, focus outlines and supporting accents use red. No generated bitmap assets, paid services or new dependencies were added.

Sellers → Auto-approve credits controls approval per person and defaults off. Enabling applies to subsequently submitted requests only. The request snapshots eligibility, and current permission is checked again before automatic issuance. Disabling clears eligibility for open requests, so re-enabling never revives those requests automatically. Existing issued credits stay valid. Pay-later requests can issue immediately; pay-upfront requests still require an administrator to verify actual payment. Stock shortages leave requests in review without partial issuance; administrators can review those manually after stock is available.

Approval and payment settlement serialize with existing per-seller billing locks. The private issuance helper cannot be invoked by authenticated/anonymous clients, and direct profile writes remain denied. Automatic issuance records the authorizing administrator, initiating user, issued quantity, stock commitment and unpaid amount. Duplicate approval/verification cannot issue twice. Older manual requests do not become automatic retroactively.

The owner applied auto-approval-update.sql successfully. Live inspection confirmed the Auto-approve credits controls are enabled, both sellers still show Manual credit approval, and the actual seller's setting opens with Manual approval selected. No seller permission or credit balance was changed by the assistant during inspection. GPOP branding was visually checked on the live local app. Full automatic issuance was checked in isolated automated fixtures, not by creating live transactions.

All **86 tests** and the production build pass. Six source migrations are packaged. Existing projects already using account controls apply auto-approval-update.sql; fresh projects use supabase-setup.sql. Auto-approval is now an intentional exception to earlier documentation saying every request must be manually approved.

## Button readability and walkthroughs — November 3, 2026

Fixed low-contrast Invite seller text caused by a panel-heading color override, darkened navigation/sign-out/activity controls, increased action labels to 13–14px, preserved readable disabled states without opacity fading, and added consistent 40px desktop / 44px phone target heights. Actions wrap on narrow screens; seller action groups no longer squeeze the account details. Icon-only controls have larger targets and keyboard focus outlines. Product photo buttons have explicit accessible names. Ambiguous labels now say Edit product, Adjust credits, Restore/Suspend seller access, View all activity, Accept order, Reject order, Start packaging, Record shipment and Mark completed. Confirmation buttons name the action. Redundant navigation to the page already open is hidden.

All nine administrator sections were inspected with live read-only navigation. All eight seller sections and the label wizard were inspected using isolated training data, plus product and permission dialogs. Phone layout was checked at 390×844; viewport override was reset afterward. Follow-up measurements found no text-contrast failures on corrected Overview, Products or Sellers buttons (lowest measured ratio 5.19:1); phone seller controls were readable at 44px height with no clipped labels. This is targeted UI verification, not a certification of every possible browser/state. All 86 existing checks and the final production build pass.

Created two 1920×1080 narrated MP4 walkthroughs: Administrator, approximately 7:20 with 19 chapters; Seller, approximately 5:53 with 15 chapters. They use actual current UI captures with clearly marked local training fixtures, not live seller accounts. English captions are embedded and also supplied as .srt files, with timestamped .md transcripts. Both finished videos fully decoded without errors; audio was checked for non-silent levels, and representative frames were extracted and visually reviewed. No live requests, labels, payments, permissions or balances were changed to make the recordings. The temporary training server was stopped and its copied photo removed from the application. No training fixtures, video encoder dependency or credentials are included in the application source ZIP. No new database migration is needed for these readability changes.

## Updated walkthrough narration — November 3, 2026

Both tutorials now have natural male narration (en-US-AndrewNeural), replacing the original desktop-voice presentation in the recommended versions. Updated MP4/SRT/transcript files have the suffix Male-Voice. The administrator guide is approximately 6:16 and the seller guide 5:00. Original frames and instructions were preserved; captions use speech-service word timing. Both new videos fully decoded without errors, and sample audio levels were checked. Only generic training narration was sent to the speech service, with no account/customer records or credentials. The application itself and its database were unchanged.
