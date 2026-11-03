# GPOP Fulfillment — project checklist

Updated November 3, 2026. The app currently runs locally; the production website has not been deployed.

## Completed and verified

- [x] React, TypeScript, Vite, Tailwind, Lucide and Motion application source created.
- [x] Seller/admin workspace built; desktop and mobile layouts checked.
- [x] Supabase Free project connected; schema, constraints, RLS and private buckets installed.
- [x] Public signup disabled; anonymous product-table access blocked.
- [x] Administrator account created and administrator workspace accessed.
- [x] Mistaken administrator account demoted/suspended; unused invitation expired.
- [x] Seller invitation function deployed as `swift-worker`; app configured for its endpoint.
- [x] Invitation function rejects signed-out requests.
- [x] Brevo SMTP key and verified **GPOP Fulfillment** sender configured by the owner.
- [x] Custom SMTP saved; invitation sent through Relay, accepted, and seller login completed.
- [x] First product saved: **John Pork Chain**, **Silver-tone** variant.
- [x] Fulfillment price **$4.99**, suggested resale **$9.99**, physical stock **20 units**.
- [x] Four HEIC photos converted to JPEG and uploaded; gallery checked.
- [x] Product description, listing title and visible specifications saved.
- [x] Live PDF upload to private shipping-label storage passed in the administrator session.
- [x] Signed download matched the exact file; public access was blocked.
- [x] 51 automated checks and the production build pass.
- [x] Source ZIP, setup guide, migrations, function, environment example and CI supplied.
- [x] Payments remain offline; no automatic payment processing added.

## Built, with live workflow tests still pending

Checked implementation items below mean the code exists. Unchecked tests mean the complete hosted workflow has not yet been verified.

- [x] Product search/filter/sort, detail pages and profit calculator implemented.
- [ ] Verify their interactions with live seller catalog data.
- [x] Individual/ZIP photo downloads and copyable listing materials implemented.
- [ ] Verify seller downloads and clipboard actions.
- [x] Credit requests, payment reporting, administrator verification and approval implemented.
- [ ] Test a live request and confirm reporting payment leaves balances unchanged.
- [ ] Test live verification/approval using an actual received payment; do not fabricate a payment record.
- [ ] Verify hosted duplicate-approval and insufficient-stock handling.
- [x] Product-specific balances, immutable ledgers and reasoned administrator corrections implemented and covered by automated database tests.
- [ ] Check live balances/ledger after authorized issuance.
- [x] Guided label submission, previews, idempotency and transactional reservations implemented.
- [ ] Test the complete seller submission with approved credits and verify its order reference/reserved balance.
- [ ] Verify live PNG/JPG and multiple-label uploads; the storage check used PDF only.
- [x] Acceptance, rejection, eligible cancellation, packaging, shipment/tracking and completion implemented.
- [ ] Test full live processing and administrator label access.
- [ ] Verify restoration on rejection/cancellation, consumption on acceptance and one-time stock deduction on shipment.
- [x] Notifications, read states, order history, private notes and administrator audit views implemented.
- [ ] Verify them across the live seller/admin workflow.
- [x] Password reset, password settings, persistent sessions and logout implemented.
- [ ] Verify recovery email/completion and persistence/logout across fresh browser sessions.
- [x] Automated tests cover invitation expiration, RLS isolation, suspension, immutable logs, insufficient balances and duplicate operations.
- [ ] Validate access boundaries in both live seller/admin sessions.
- [x] True multi-connection concurrency test and GitHub Actions job supplied.
- [ ] Run that suite on disposable local Supabase or GitHub Actions.

## New payment permission feature

- [x] Per-seller Pay upfront / Pay later controls implemented with administrator-only authorization and required audit reasons.
- [x] Every request still needs approval; pay-later approval commits real stock and tracks the amount owed.
- [x] Later payment verification settles the approved purchase without issuing duplicate credits.
- [x] 16 additional checks cover permission, approval, revocation, stock limits, settlement, and payment actions.
- [x] Payment-terms migration applied to hosted Supabase.
- [x] Live seller payment controls enabled; test seller shows Pay later permitted after a saved permission change.
- [ ] Verify the full pay-later approval and later-settlement workflow in live seller/admin sessions.

## Remaining launch work

- [ ] Confirm product condition, material, dimensions and weight; these were not supplied.
- [ ] Enter actual offline payment instructions in administrator Settings.
- [ ] Create/connect the GitHub repository and push the source.
- [ ] Configure a free frontend host such as Cloudflare Pages.
- [ ] Set its public Supabase build values and `VITE_INVITATION_FUNCTION=swift-worker`.
- [ ] Add the production origin to function `APP_ORIGINS` and Supabase Auth site/redirect settings.
- [ ] Verify the deployed website's authentication, invitations, files and mobile layouts.
- [ ] Complete the live workflow tests before onboarding the full beta.
- [ ] Establish appropriate backups and storage retention within the free-plan limits.

GitHub Pages is inactive because its commercial-use policy conflicts with operating this platform. GitHub remains the intended source/CI host, with Cloudflare Pages the proposed free frontend host. No paid subscription or payment processor has been enabled by the app.

One small PDF marked **UPLOAD TEST ONLY — NOT A SHIPPING LABEL** remains in private storage. It is not attached to an order; its test did not change credits or stock.

## Order controls and resource use

- [x] Remove the requested 3 unused seller credits; verified stock 20 on hand / 0 committed / 20 uncommitted.
- [x] Build recoverable Delete/Restore controls for fulfillment orders and credit requests.
- [x] Preserve shipped totals, payments and debts; return unshipped fulfillment credits exactly once.
- [x] Add exact Set stock alongside existing Adjust stock, guarded by committed inventory.
- [x] Add throttled cleanup for stale notifications and unaccepted/unlinked expired invitations.
- [x] Bound activity ledger reads to the latest 100 rows and remove duplicate refresh timer.
- [x] Pass all 67 automated checks and production build.
- [x] Order-management database controls applied as part of the successful account-controls update.
- [ ] Verify deletion/restoration in a live disposable seller/admin workflow after activation.

## Optional reasons and outstanding balances

- [x] Make administrator reasons optional in both forms and database actions.
- [x] Add Sellers → Change balance, including setting a person’s outstanding amount to zero.
- [x] Preserve stock, credits and payment evidence during monetary corrections.
- [x] Audit old/new amounts automatically, prevent stale overwrites, and isolate sellers with RLS.
- [x] Preserve adjustments during update reapplication and subsequent payment verification.
- [x] Pass all 78 checks and production build.
- [x] Owner applied account-controls-update.sql; live controls enabled and blank reason field verified.
- [ ] Test a live balance change once the owner chooses a target amount (no amount was changed during inspection).

## Automatic approval and branding

- [x] Add default-off, per-seller automatic approval for future credit requests.
- [x] Preserve verified-payment rules for upfront accounts, unpaid balances for pay-later, and inventory limits.
- [x] Stop pending automatic requests when permission is disabled; do not revive old manual requests.
- [x] Deny client access to the private issuance helper and retain automatic approval audit records.
- [x] Owner applied auto-approval update; enabled controls and manual defaults verified live.
- [x] Rename website to GPOP Fulfillment, add local red G package SVG and favicon, use red accents.
- [x] Pass all 86 automated checks and production build.
- [ ] Verify automatic issuance in a live workflow after the owner chooses a seller to enable.

## Readability and training videos

- [x] Fix button contrast, small type, disabled styling and action labels.
- [x] Inspect all admin sections and all seller sections using live/read-only or isolated training screens.
- [x] Check seller controls at phone width; restore the default viewport afterward.
- [x] Preserve passing 86 checks and production build.
- [x] Create separate narrated administrator and seller MP4s with captions and transcripts.
- [x] Decode both completed videos, check audio levels and inspect extracted frames.
- [x] Keep training fixtures outside the production source and database.
