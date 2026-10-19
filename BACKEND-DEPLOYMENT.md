# Backend VYV deployment and audit — October 19, 2026

GitHub Pages and Apps Script deploy separately. The user deployed v5 successfully: health reports `ok: true`, `paymentsConfigured: true`; setup copied 3 legacy rows to `Bookings VYV`. The new URL is configured in all five customer/admin pages. GitHub publishing was still queued at the last audit, so the live pages still used the old URL.

## Required security update

The former admin password and server token were embedded in public source. Treat both as compromised. Version 6 removes that server credential and validates administrative requests against the private Apps Script `ADMIN_TOKEN` property. Without a private key, administration fails closed. Public booking saves still require a verified paid Stripe deposit; lead capture does not need administrator access.

1. Back up the Apps Script project. Replace its code with `vyv-booking-backend.js` (also supplied as Backend_VYV_Replacement.txt).
2. In Project Settings → Script Properties, add `ADMIN_TOKEN` with a new random private value of at least 32 characters. Use a password manager to generate it. Keep `STRIPE_SK` and the existing Twilio properties. Do not paste any private value in chat or GitHub.
3. Save and update the existing web-app deployment to a new version, retaining its URL. No spreadsheet migration is needed after the successful v5 setup.
4. Open the deployment URL with `?action=health`. Expect `booking-payments-v6`, `paymentsConfigured: true`, and `adminConfigured: true`.
5. Sign into `/admin.html` using the new private access key. The dashboard now verifies the key on the server; old browser-only login flags do not grant access. The key stays in memory until logout/reload.

Version 6 also fixes arrival-window date parsing, prevents admin timer retries from resetting the start, rejects malformed/past reschedules and occupied windows, and distinguishes eligible refunds requiring manual review in the administrator notification.

## Audit findings repaired in website source

- Booking navigation/progress, address autocomplete, additional stops, current phone and missing local navigation targets.
- Careers previously displayed success without submitting anything. It now submits to the existing Formspree endpoint, and failed submissions preserve the form.
- Review feedback previously displayed success even for rejected server responses. It now checks the response and supports retry.
- Customer cancellation/rescheduling dates failed on stored human-readable AM/PM arrival windows. Dates now parse and refund previews use America/New_York.
- Reservation deposit/refund/rescheduling copy conflicted across the homepage, FAQ, policy and confirmation pages. It now follows current checkout/terms: $250/$300 deposit, 12-hour refund window, $75 late-rescheduling fee.
- Admin failed loads showed sample bookings as real data, and canonical backend field names did not match the dashboard. Failed loads now show an error, and fields/statuses are normalized.
- Administrative HTML interpolations escape customer names, route cities, crew/status and calendar titles.

## Evidence and limits

- All 41 deployed HTML URLs returned HTTP 200 during the audit. Local link/fragment and inline-JavaScript syntax scan: 0 errors.
- `node --test tests/*.test.cjs`: 27 passing tests covering navigation, stops, paid-save retry, Stripe verification/idempotency, migration, admin access, date/time behavior, reschedule rejection and careers submission failures.
- Live browser: booking begins at step 1, FAQ search works, Stripe secure fields and address suggestions were verified in the preceding audit. An extension-generated console error is unrelated to the site's scripts.
- No card charged and no live reservation/refund/cancellation created. Automatic approval review rejected creation of a live unpaid $250 PaymentIntent; this check was not retried. Stripe account/key matching, successful/declined/3DS flows and real payment→booking→notification delivery require a controlled test environment or explicit approval for the blocked initialization.
- Formspree inbox acceptance/delivery and Twilio delivery were not exercised by sending messages.
- Admin security remains unresolved on the running Apps Script until version 6 is manually deployed with a new private key. Removing a credential from current HTML does not revoke historical copies.
- Availability is a preview rather than a locked inventory reservation; simultaneous checkouts/reschedules require a transactional slot-hold design to guarantee no overlap. Pricing fields supplied by the browser also need server-side recalculation before they can be trusted for final automated billing. Review final balances in admin before charging.
- Some older flat-rate/blueprint marketing and redirect-only estimator content remains. A researched quote step is now implemented before checkout. Its model and assumptions are documented in QUOTE-MODEL.md. It clearly distinguishes estimates from a guaranteed final price.
