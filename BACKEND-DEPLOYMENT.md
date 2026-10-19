# Payment deployment required

The public website is hosted on GitHub Pages. The booking/payment server is a separate Google Apps Script deployment; merging this repository does not update that server.

The live server returned `{"ok":false,"error":"Unauthorized"}` for both public availability and payment initialization checks on October 19, 2026. Stripe Elements loads in the browser, but an actual deposit cannot be confirmed until the server is updated.

## Deploy the prepared repair

1. Open the Apps Script project that owns the web app URL configured as `SHEET_SCRIPT_URL` in `book.html`. Preserve the existing spreadsheet binding and script properties.
2. Compare its current source with `vyv-booking-backend.js` before updating, preserving any production features absent from this repository. The deployed server may differ from the checked-in source.
3. Apply the payment creation/verification/save changes in `vyv-booking-backend.js`. Keep `STRIPE_SK` only in Script Properties. Never put a Stripe secret key in HTML or GitHub.
4. Update the existing web app deployment to a new version, retaining its URL and access configuration.
5. Request the existing web app URL with `?action=health`. Expect `version: booking-payments-v3`, `ok: true`, and `paymentsConfigured: true`.
6. Check public `?action=get_booked_slots` returns `ok: true`. Run successful, declined, and authentication-required card scenarios in a separate Stripe test-mode setup, including a failed booking save followed by retry. Never use test card numbers against the live key.
7. Confirm a successful payment creates exactly one spreadsheet booking and that retrying its save neither charges again nor creates another booking. Check notifications and customer move links with a controlled test booking.

## Remaining audit limits

- No real card was charged and no real reservation was created during this audit. The live UI was checked through Stripe's secure card fields using clearly marked audit contact details.
- Confirmation emails, SMS delivery, admin actions, cancellation/refunds, rescheduling, and the move-day timer need a controlled booking after backend deployment. The repository's customer cancellation/rescheduling pages reference actions that are absent from its checked-in backend; compare the actual production Apps Script before modifying it.
- Existing admin authentication uses a shared token embedded in public HTML. That token is not a secure administrative boundary; move administrative operations behind real server-side authentication before storing customer data in production.
- The estimator advertises a different walkthrough/deposit pricing model from the main hourly booking flow. Those commercial terms need the owner's decision; this repair preserves their amounts.

## Checks

`python tests/site-audit.py` checks all 41 HTML pages for missing local files, fragments, JavaScript syntax errors, and the retired phone number.

`node --test tests/*.test.cjs` checks booking navigation, progress milestones, stop controls, homepage handoff, acknowledged booking saves, payment verification, idempotent requests, and duplicate-charge prevention using mocks rather than live payments.
