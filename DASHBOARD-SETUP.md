# VYV staff call dashboard

URL: https://validateyourvision.com/vyv-dashboard/

## One-time server setup

The website lives on GitHub Pages; private records and password verification live in Google Apps Script. Website publishing cannot replace that separately deployed server. This dashboard requires backend `booking-payments-v7`.

1. Back up the existing Backend VYV project. Replace its code with the complete `vyv-booking-backend.js` supplied as `Backend_VYV_Replacement.txt`. Preserve existing Script Properties, especially `STRIPE_SK` and Twilio configuration. The `Bookings VYV` migration already completed; there is no need to migrate it again.
2. Under Project Settings → Script Properties, set `DASHBOARD_PASSWORD` to the private password supplied in chat or another strong password of at least 12 characters. The password is never included in repository files or webpage JavaScript. For the older `/admin.html` dashboard, `ADMIN_TOKEN` remains a separate private setting and must have at least 32 characters; this is not required for signing into the new call desk.
3. Save. Deploy → Manage deployments → edit the current web app → New version → Deploy. Keep the existing deployment URL and access configuration.
4. The deployment URL with `?action=health` should report `booking-payments-v7`, `dashboardEnabled: true` and `dashboardConfigured: true`. Sign in at `/vyv-dashboard/`.

The `Staff Reservations` spreadsheet tab is created automatically on the first authenticated save. It is separate from the paid `Bookings VYV` tab. Existing booking data is not moved or overwritten.

## During a call

- Open Customer, Date & time, Move details, Packing, or Quote & reserve in any order. No previous tab must be completed.
- Save incomplete calls with **Save draft**. Customer information, date and addresses may still be blank. Changes remain in memory until saved; leaving a dirty page prompts before discarding them.
- Add/reorder/remove stops, enter property details, belongings, specialty items and packing needs. Select a date to see the same three-mover day rate as online booking.
- On Quote & reserve, use **Update route & quote**. Pickup/destination and all extra addresses are routed; rates, truck fees, deposits and quote math match public booking through shared source files. Relevant edits invalidate stale routing or recalculate the quote.
- **Copy quote summary** copies customer-facing text. It does not send anything.
- Create the payment link or invoice manually in Stripe and paste its HTTPS link into the record. Only Stripe-hosted payment/checkout/invoice links are accepted. No card details are collected by this dashboard.
- **Reserve · awaiting payment** requires a customer name and phone or email, a valid future/today move date/window, complete routing and a calculated quote. Optional packing needs its date/window. The server recomputes quote math and checks bookings/other staff holds while holding a script lock.
- Holds last 24 hours by default; selectable durations are 24/48/72 hours or 7 days. A hold blocks the public calendar's availability response for its move and optional packing windows. Expired/cancelled holds release those windows. Renew a hold using Reserve again.
- An awaiting-payment reservation is not a verified paid booking. A pasted Stripe link does not prove payment; payment handling stays manual in Stripe. This version does not convert externally paid reservations into the paid-booking/move-day timer workflow automatically. Review/renew its hold accordingly.
- Saved calls open from the sidebar. Conflicting edits from two tabs are rejected rather than silently overwriting newer details. Successful save retries do not create duplicate records.

## Security and operational boundaries

Staff records/listing/writes require an unguessable server-issued session. Password checks are server-side. Session tokens are kept in page memory rather than browser storage; cached sessions expire after up to six hours and can expire sooner. Sign in again if needed. Password rotation invalidates existing sessions; logout revokes the current token. Staff sessions cannot authorize the existing admin balance-charge routes.

Incomplete drafts do not reserve capacity. Staff hold checks are atomic against other staff writes. Public availability remains a preview: the existing public Stripe checkout does not have a transactional cross-flow slot-hold design, so a customer already mid-checkout can race a staff reservation. Do not promise absolute slot exclusivity without that separate payment-hold change. Legacy paid packing records lack a structured arrival window; staff should also review packing schedules manually.

Quotes remain nonbinding estimated ranges based on the existing VYV model. Server computation uses the exact shared math embedded at deployment, so future estimator or rate changes must update both website assets and the Apps Script deployment. Do not put real payroll rates, margins, private passwords or Stripe secret keys into this public repository.

## Validation

Targeted checks include all eight public booking panels, shared pricing, staff tab navigation without prerequisites, server sessions and revocation, partial drafts, quote recomputation, duplicate-save prevention, conflict checks, packing holds, expiry, cancellation, stale edits, unsafe payment links and spreadsheet formula protection. Live staff sign-in/saves/reservations cannot be verified until the Apps Script v7 update is deployed. No live payment, message, cancellation or real customer reservation is created by the implementation tests.
