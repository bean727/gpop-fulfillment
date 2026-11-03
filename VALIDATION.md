# Verification record

Updated November 3, 2026. See PROJECT-CHECKLIST.md for the current launch checklist.

## Build and automated checks

TypeScript and the configured production build pass. All 51 automated checks pass: 41 embedded PostgreSQL workflow/access tests, 5 domain/routing tests, and 5 payment-UI tests. They cover invitation gating/expiration, payment-report/approval separation, idempotency, stock/credit limits, reservations, restoration, shipment accounting, immutable ledgers, private notes, anonymous denial, isolation and suspension. Embedded tests model Auth/Storage tables. Real multi-connection tests are supplied in CI but have not run locally because Docker/Supabase CLI are unavailable.

## Hosted Supabase with local frontend

- Database migrations installed, public signup disabled and anonymous product access denied.
- Administrator setup completed; administrator workspace inspected.
- Mistaken account demoted/suspended and unused invitation expired.
- Seller invitation endpoint deployed as swift-worker and configured in the local app.
- Function responses verified: OPTIONS 200, GET 405, signed-out POST 401 (Sign in first).
- Owner configured Brevo SMTP and verified GPOP Fulfillment sender.
- Test invitation sent through Relay, accepted status observed, and seller login reported by owner.
- John Pork Chain saved: Silver-tone, $4.99 fulfillment, $9.99 suggested resale, 20 stock, four uploaded photos.
- Desktop/mobile layout, decoded hash routes and no-credit gating inspected.

## Live private label storage

PASS in the administrator session: small clearly marked PDF uploaded, 120-second signed URL generated, downloaded file matched exactly, public URL denied. No order or credit/stock changes occurred. One small test file remains privately stored. The local development-only Settings diagnostic is excluded from production builds.

This does not yet verify live seller credit/payment approval, complete reservation/submission, order processing, cross-account label denial, PNG/JPG/multiple labels, recovery/persistent sessions or true concurrency. See the checklist for remaining tests.

## Hosting

The app runs locally. No production frontend is deployed and no GitHub repository is connected. GitHub Pages is inactive due to its commercial-use restriction; the documented alternative is GitHub source/CI with Cloudflare Pages and Supabase Free.

## Payment-terms extension — November 3, 2026

Source and local UI now include administrator-controlled pay-upfront/pay-later permissions, per-request terms, separate payment status, approved amounts owed, and later settlement without reissuance. The 51 automated tests and production build pass. The new migration has not been applied to hosted Supabase yet; live permission controls remain disabled until the owner runs payment-terms-update.sql. No live seller permission or financial balance was changed for testing.

## Payment-terms activation verified

The owner applied the new database update. The live administrator Sellers screen now has enabled Payment terms controls and shows the test seller as Pay later permitted, with $0.00 outstanding and a Payment permission updated confirmation. No credits or payment records were created by the assistant during this verification. Live unpaid approval and subsequent settlement remain untested.

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
