// ═══════════════════════════════════════════════════════════════
//  VYV Moving — Google Apps Script Backend
//  Replace the existing code, Save, run setupBackend once, then update the existing deployment.
//  Script Properties required: STRIPE_SK, TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM
// ═══════════════════════════════════════════════════════════════

const SHEET_ID      = '1-KEfahm-VkdVG2T_tV6GyF4kRTIUqchanSKKL-kNagM';
const BOOKING_TAB   = 'Bookings VYV';
const LEGACY_BOOKING_TAB = 'Bookings';
const LEADS_TAB     = 'Leads';
const NOTIFY_EMAIL  = 'hello@validateyourvision.com';
const BUSINESS_PHONE= '+15403011152';
const REVIEW_LINK   = 'https://g.page/r/CTEfnP3H0I5qEAI/review';

// ── Spreadsheet column layout (0-based) ──────────────────────
// A  0  Timestamp
// B  1  Move Token
// C  2  Name
// D  3  Email
// E  4  Phone
// F  5  Move Date
// G  6  Crew
// H  7  Rate
// I  8  Truck Fee
// J  9  From
// K 10  To
// L 11  Stops
// M 12  Volume
// N 13  Specialty Items
// O 14  Packing
// P 15  Notes
// Q 16  Deposit Amount
// R 17  Payment Intent ID
// S 18  Payment Method ID
// T 19  Status
// U 20  Booked At
// V 21  Checkin At
// W 22  Completed At
// X 23  Hours Worked
// Y 24  Labor Amount
// Z 25  Final Charge
// AA 26 Charge Status

// ═══════════════════════════════════════════════════════════════
//  ENTRY POINT
// ═══════════════════════════════════════════════════════════════
function doPost(e) {
  try {
    const data    = JSON.parse(e.postData.contents);
    const action  = data.action  || '';
    const token   = data.token   || '';
    const adminSecret = getProp('ADMIN_TOKEN') || '';
    const isAdmin = adminSecret.length >= 32 && adminSecret !== 'vyv2026admin' && token === adminSecret;

    // Staff sessions grant access only to the call desk, never balance charges.
    if (action === 'staff_login') return staffLogin(data);
    if (action.startsWith('staff_')) {
      if (!staffAuthorized(data.staffToken)) return staffAuthError();
      if (action === 'staff_logout') { CacheService.getScriptCache().remove('vyv-staff-session:' + data.staffToken); return jsonOk({}); }
      if (action === 'staff_list') return staffList();
      if (action === 'staff_save') return staffSave(data);
      if (action === 'staff_cancel') return staffCancel(data);
      return jsonErr('Unknown staff action');
    }

    // ── Public routes (no token needed) ──
    if (action === 'create_payment_intent') return createPaymentIntent(data);
    if (action === 'get_move')              return getMove(data);
    if (action === 'customer_checkin')      return customerCheckin(data);
    if (action === 'reschedule')            return rescheduleBooking(data);
    if (action === 'cancel')               return cancelBooking(data);

    // Paid saves verify the Stripe deposit; no administrative secret belongs in public HTML.
    if (action === 'save') return saveBooking(data);
    if (action === 'save_lead') return saveLead(data);

    // ── Admin routes ──
    if (!isAdmin) return jsonErr('Unauthorized');

    if (action === 'get_bookings')      return getBookings(data);
    if (action === 'update_status')     return updateStatus(data);
    if (action === 'on_the_way')        return onTheWay(data);
    if (action === 'arrived')           return arrivedAction(data);
    if (action === 'complete_move')     return completeMove(data);
    if (action === 'charge_balance')    return chargeBalance(data);
    if (action === 'start_timer_admin') return startTimerAdmin(data);

    return jsonErr('Unknown action: ' + action);
  } catch (err) {
    return jsonErr('Server error: ' + err.message);
  }
}

function doGet(e) {
  try {
    const action = e.parameter.action;
    if (action === 'health') { getSheet(BOOKING_TAB); return jsonOk({ version: 'booking-payments-v7', paymentsConfigured: !!getProp('STRIPE_SK'), adminConfigured: (getProp('ADMIN_TOKEN') || '').length >= 32, dashboardEnabled: true, dashboardConfigured: (getProp('DASHBOARD_PASSWORD') || '').length >= 12 }); }
    if (action === 'get_booked_slots') return getBookedSlots();
    if (action === 'get_move') return getMove({moveToken: e.parameter.moveToken});
    return jsonErr('Unknown public action');
  } catch (error) { return jsonErr(error.message); }
}

function getBookedSlots() {
  const rows = getSheet(BOOKING_TAB).getDataRange().getValues();
  const slots = {};
  rows.slice(1).forEach(row => {
    if (['cancelled','canceled'].includes(String(row[19]).toLowerCase())) return;
    const parts = bookingDateParts(row[5]);
    if (!parts) return;
    const slot = parts.slot;
    const key = parts.day;
    if (!slots[key]) slots[key] = [];
    if (!slots[key].includes(slot)) slots[key].push(slot);
  });
  staffOccupiedSlots().forEach(slot => {
    if (!slots[slot.date]) slots[slot.date] = [];
    if (!slots[slot.date].includes(slot.time)) slots[slot.date].push(slot.time);
  });
  return jsonOk({slots});
}

// ═══════════════════════════════════════════════════════════════
//  STRIPE — CREATE PAYMENT INTENT (deposit)
// ═══════════════════════════════════════════════════════════════
// Stripe requests throw readable errors without exposing credentials.
function stripeApi(method, path, payload, requestKey) {
  const secret = getProp('STRIPE_SK');
  if (!secret) throw new Error('Stripe is not configured in Script Properties');
  const options = { method, headers: { Authorization: 'Bearer ' + secret }, muteHttpExceptions: true };
  if (payload) options.payload = payload;
  if (requestKey) options.headers['Idempotency-Key'] = requestKey;
  const result = JSON.parse(UrlFetchApp.fetch('https://api.stripe.com/v1' + path, options).getContentText());
  if (result.error) throw new Error(result.error.message || 'Stripe request failed');
  return result;
}

function createPaymentIntent(data) {
  if (![25000, 30000].includes(data.amountCents)) return jsonErr('Invalid deposit amount');
  if (!data.email || !data.name || !/^[a-zA-Z0-9_-]{16,80}$/.test(data.requestId || '')) {
    return jsonErr('Contact details and a payment request ID are required');
  }
  getSheet(BOOKING_TAB); // Check the spreadsheet before a customer can pay.
  const customer = stripeApi('post', '/customers', { email: data.email, name: data.name }, 'customer-' + data.requestId);
  const pi = stripeApi('post', '/payment_intents', {
    amount: String(data.amountCents), currency: 'usd', customer: customer.id,
    receipt_email: data.email, description: 'VYV Moving deposit — ' + data.name,
    setup_future_usage: 'off_session', 'payment_method_types[]': 'card', 'metadata[type]': 'deposit'
  }, 'deposit-' + data.requestId);
  return jsonOk({ clientSecret: pi.client_secret });
}

function verifyDeposit(data) {
  if (!/^pi_[a-zA-Z0-9]+$/.test(data.paymentIntentId || '')) throw new Error('A paid deposit is required');
  const pi = stripeApi('get', '/payment_intents/' + data.paymentIntentId);
  if (pi.status !== 'succeeded' || pi.currency !== 'usd' ||
      ![25000, 30000].includes(pi.amount_received) || pi.metadata?.type !== 'deposit' ||
      (pi.receipt_email || '').toLowerCase() !== (data.email || '').toLowerCase()) {
    throw new Error('Deposit verification failed');
  }
  return pi;
}

// ═══════════════════════════════════════════════════════════════
//  SAVE BOOKING
// ═══════════════════════════════════════════════════════════════
function saveBooking(data) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return savePaidBooking(data); }
  finally { lock.releaseLock(); }
}

function savePaidBooking(data) {
  const payment = verifyDeposit(data);
  const sheet = getSheet(BOOKING_TAB);
  const rows = sheet.getDataRange().getValues();
  const existing = rows.slice(1).find(row => row[17] === payment.id);
  if (existing) return jsonOk({ id: existing[1], moveToken: existing[1] });
  data.deposit = '$' + payment.amount_received / 100;
  data.paymentMethod = payment.payment_method;
  if (data.propertyDetails) data.notes = (data.notes || '') + '\nLocation/property details: ' + data.propertyDetails;
  const token = generateToken();
  const row   = [
    new Date().toISOString(),   // A  Timestamp
    token,                      // B  Move Token
    data.name        || '',     // C  Name
    data.email       || '',     // D  Email
    data.phone       || '',     // E  Phone
    data.moveDate    || '',     // F  Move Date
    data.crew        || '',     // G  Crew
    data.rate        || '',     // H  Rate
    data.truckFee    || '',     // I  Truck Fee
    data.from        || '',     // J  From
    data.to          || '',     // K  To
    data.stops       || '',     // L  Stops
    data.volume      || '',     // M  Volume
    data.specialty   || '',     // N  Specialty
    data.packing     || '',     // O  Packing
    data.notes       || '',     // P  Notes
    data.deposit     || '',     // Q  Deposit Amount
    data.paymentIntentId || '', // R  Payment Intent ID
    data.paymentMethod   || '', // S  Payment Method ID
    data.status      || 'Upcoming', // T Status
    data.bookedAt    || new Date().toISOString(), // U Booked At
    '',                         // V  Checkin At
    '',                         // W  Completed At
    '',                         // X  Hours Worked
    '',                         // Y  Labor Amount
    '',                         // Z  Final Charge
    ''                          // AA Charge Status
  ];
  sheet.appendRow(row);
  [() => sendConfirmationEmail(data, token), () => notifyAdmin(data)].forEach(send => {
    try { send(); } catch (error) { console.error('Notification failed: ' + error.message); }
  });
  return jsonOk({ id: token, moveToken: token });
}

// ═══════════════════════════════════════════════════════════════
//  SAVE LEAD (partial — no payment yet)
// ═══════════════════════════════════════════════════════════════
function saveLead(data) {
  try {
    const ss    = SpreadsheetApp.openById(SHEET_ID);
    let sheet   = ss.getSheetByName(LEADS_TAB);
    if (!sheet) {
      sheet = ss.insertSheet(LEADS_TAB);
      sheet.appendRow(['Captured At','Name','Email','Phone','From','To','Source']);
    }
    sheet.appendRow([
      data.capturedAt || new Date().toISOString(),
      data.name  || '',
      data.email || '',
      data.phone || '',
      data.from  || '',
      data.to    || '',
      data.source || 'Website'
    ]);
    return jsonOk({});
  } catch(e) {
    return jsonOk({}); // never fail a lead save
  }
}

// ═══════════════════════════════════════════════════════════════
//  GET MOVE (customer-facing, by moveToken)
// ═══════════════════════════════════════════════════════════════
function getMove(data) {
  const row = findRow(data.moveToken);
  if (!row) return jsonErr('Booking not found');
  return jsonOk({ ok: true, booking: rowToBooking(row) });
}

// ═══════════════════════════════════════════════════════════════
//  CUSTOMER CHECK-IN (customer taps "Check In Your Crew")
// ═══════════════════════════════════════════════════════════════
function customerCheckin(data) {
  const existing = findRow(data.moveToken);
  if (!existing) return jsonErr('Booking not found');
  if (['cancelled','completed'].includes(String(existing[19]).toLowerCase())) return jsonErr('This booking cannot be checked in');
  if (existing[21]) return jsonOk({checkinAt: existing[21]});
  const result = updateRowField(data.moveToken, {
    19: 'Moving',               // Status
    21: new Date().toISOString() // Checkin At
  });
  if (!result) return jsonErr('Booking not found');

  // Notify admin by email
  try {
    const row = findRow(data.moveToken);
    if (row) {
      GmailApp.sendEmail(
        NOTIFY_EMAIL,
        'Customer checked in — ' + row[2],
        row[2] + ' has checked in their crew. Timer is running.\nBooking: ' + row[5]
      );
    }
  } catch(e) {}

  return jsonOk({ checkinAt: new Date().toISOString() });
}

// ═══════════════════════════════════════════════════════════════
//  ON THE WAY (admin button)
// ═══════════════════════════════════════════════════════════════
function onTheWay(data) {
  const row = findRow(data.moveToken);
  if (!row) return jsonErr('Booking not found');

  updateRowField(data.moveToken, { 19: 'On The Way' });

  const name  = row[2];
  const email = row[3];
  const phone = row[4];

  // Email customer
  try {
    GmailApp.sendEmail(email,
      'Your VYV Moving crew is on the way!',
      'Hi ' + name + ',\n\nGreat news — your crew is on the way and will arrive shortly.\n\nQuestions? Text us at (540) 301-1152.\n\nVYV Moving Team'
    );
  } catch(e) {}

  // SMS customer
  sendSMS(phone, 'Hi ' + name.split(' ')[0] + '! Your VYV Moving crew is on the way. See you soon!');

  return jsonOk({});
}

// ═══════════════════════════════════════════════════════════════
//  ARRIVED (admin button — sends check-in link to customer)
// ═══════════════════════════════════════════════════════════════
function arrivedAction(data) {
  const row = findRow(data.moveToken);
  if (!row) return jsonErr('Booking not found');

  updateRowField(data.moveToken, { 19: 'Arrived' });

  const name     = row[2];
  const email    = row[3];
  const phone    = row[4];
  const token    = row[1];
  const moveLink = 'https://validateyourvision.com/move-day.html?token=' + token;

  // Email customer
  try {
    GmailApp.sendEmail(email,
      'Your VYV crew has arrived — tap to check in',
      'Hi ' + name + ',\n\nYour crew is here! Tap the link below to check them in and start the clock:\n\n' + moveLink + '\n\nVYV Moving Team'
    );
  } catch(e) {}

  // SMS customer
  sendSMS(phone, 'Hi ' + name.split(' ')[0] + '! Your VYV crew has arrived. Check them in here: ' + moveLink);

  return jsonOk({});
}

// ═══════════════════════════════════════════════════════════════
//  START TIMER (admin manual override)
// ═══════════════════════════════════════════════════════════════
function startTimerAdmin(data) {
  const row = findRow(data.moveToken);
  if (!row) return jsonErr('Booking not found');
  if (['cancelled','completed'].includes(String(row[19]).toLowerCase())) return jsonErr('This booking cannot be started');
  if (row[21]) return jsonOk({checkinAt: row[21]});
  const now = new Date().toISOString();
  const result = updateRowField(data.moveToken, {
    19: 'Moving',
    21: now
  });
  if (!result) return jsonErr('Booking not found');
  return jsonOk({ checkinAt: now });
}

// ═══════════════════════════════════════════════════════════════
//  COMPLETE MOVE (admin — stops timer, calculates bill)
// ═══════════════════════════════════════════════════════════════
function completeMove(data) {
  const row = findRow(data.moveToken);
  if (!row) return jsonErr('Booking not found');

  const completedAt = new Date();
  const checkinAt   = row[21] ? new Date(row[21]) : null;
  const rateStr     = String(row[7] || '130');
  const ratePerHr   = parseFloat(rateStr.replace(/[^0-9.]/g, '')) || 130;
  const truckFeeRaw = String(row[8] || '99');
  const truckFee    = parseFloat(truckFeeRaw.replace(/[^0-9.]/g, '')) || 99;
  const depositRaw  = String(row[16] || '250');
  const depositAmt  = parseFloat(depositRaw.replace(/[^0-9.]/g, '')) || 250;

  // Hours worked — round up to nearest 15 min
  let hours = 0;
  if (checkinAt) {
    hours = (completedAt - checkinAt) / 3600000;
    hours = Math.ceil(hours * 4) / 4; // ceil to nearest 0.25
  }

  const laborAmount = Math.round(hours * ratePerHr * 100) / 100;
  const totalAmount = Math.round((laborAmount + truckFee) * 100) / 100;
  const finalCharge = Math.max(0, Math.round((totalAmount - depositAmt) * 100) / 100);

  // Save to spreadsheet
  const sheet = getSheet(BOOKING_TAB);
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] !== data.moveToken) continue;
    sheet.getRange(i + 1, 20).setValue('Completed');
    sheet.getRange(i + 1, 23).setValue(completedAt.toISOString());
    sheet.getRange(i + 1, 24).setValue(hours);
    sheet.getRange(i + 1, 25).setValue(laborAmount);
    sheet.getRange(i + 1, 26).setValue(finalCharge);
    break;
  }

  return jsonOk({
    completedAt: completedAt.toISOString(),
    hours,
    rate:        rateStr,
    laborAmount,
    truckFee,
    depositPaid: depositAmt,
    totalAmount,
    finalCharge
  });
}

// ═══════════════════════════════════════════════════════════════
//  CHARGE BALANCE (admin — after reviewing receipt)
//  Receives final edited values from admin panel
// ═══════════════════════════════════════════════════════════════
function chargeBalance(data) {
  const row = findRow(data.moveToken);
  if (!row) return jsonErr('Booking not found');

  const pmId        = row[18]; // Payment Method ID saved at deposit
  const name        = row[2];
  const email       = row[3];
  const finalCharge = parseFloat(data.finalCharge) || 0;
  const hours       = parseFloat(data.hours)       || 0;
  const rate        = data.rate                    || row[7];
  const truckFee    = parseFloat(data.truckFee)    || 0;
  const depositPaid = parseFloat(data.depositPaid) || 0;

  const amountCents = Math.round(finalCharge * 100);

  if (amountCents > 0) {
    const sk = getProp('STRIPE_SK');

    if (row[26] === 'Charged') return jsonOk({finalCharge: row[25], alreadyCharged: true});
    const deposit = stripeApi('get', '/payment_intents/' + row[17]);
    // A stable key makes retries of this invoice amount reuse one charge.
    const resp = UrlFetchApp.fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'post',
      headers: { Authorization: 'Bearer ' + sk, 'Idempotency-Key': 'balance-' + data.moveToken + '-' + amountCents },
      payload: {
        customer:         deposit.customer,
        amount:           String(amountCents),
        currency:         'usd',
        payment_method:   pmId,
        confirm:          'true',
        off_session:      'true',
        receipt_email:    email,
        description:      'VYV Moving balance — ' + name,
        'payment_method_types[]': 'card'
      }
    });
    const pi = JSON.parse(resp.getContentText());
    if (pi.error) return jsonErr(pi.error.message);
    if (pi.status !== 'succeeded') return jsonErr('The balance payment needs customer authentication or another payment method.');
  }

  // Save final bill to spreadsheet
  const sheet = getSheet(BOOKING_TAB);
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] !== data.moveToken) continue;
    sheet.getRange(i + 1, 24).setValue(hours);
    sheet.getRange(i + 1, 25).setValue(parseFloat(data.laborAmount) || hours * parseFloat(String(rate).replace(/[^0-9.]/g,'')) || 0);
    sheet.getRange(i + 1, 26).setValue(finalCharge);
    sheet.getRange(i + 1, 27).setValue('Charged');
    break;
  }

  // Send confirmation email to customer
  sendFinalInvoiceEmail({ name, email, hours, rate, truckFee, depositPaid, finalCharge });

  return jsonOk({ finalCharge });
}

// ═══════════════════════════════════════════════════════════════
//  RESCHEDULE (customer-facing)
// ═══════════════════════════════════════════════════════════════
function rescheduleBooking(data) {
  const row = findRow(data.moveToken);
  if (!row) return jsonErr('Booking not found');

  const status = String(row[19] || '').toLowerCase();
  if (status === 'cancelled' || status === 'completed' || status === 'moving' || status === 'arrived') {
    return jsonErr('This booking cannot be rescheduled at this time.');
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.newDate || '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(data.newTime || '')) return jsonErr('Choose a valid future date and time.');
  const tomorrow = Utilities.formatDate(new Date(Date.now() + 86400000), 'America/New_York', 'yyyy-MM-dd');
  if (data.newDate < tomorrow || !isFinite(new Date(data.newDate + 'T12:00:00').getTime())) return jsonErr('Choose a future move date.');
  const slot = Number(data.newTime.slice(0,2)) < 12 ? 'AM' : 'PM';
  const otherRows = getSheet(BOOKING_TAB).getDataRange().getValues().slice(1).filter(r => r[1] !== data.moveToken && !['cancelled','canceled','completed'].includes(String(r[19]).toLowerCase()));
  const conflict = otherRows.some(r => { const p = bookingDateParts(r[5]); return p && p.day === data.newDate && p.slot === slot; });
  if (conflict) return jsonErr('That arrival window is already booked. Please choose another time.');

  // Check 12-hour rule
  const moveDateStr = String(row[5] || '');
  const hoursUntil  = hoursUntilMove(moveDateStr);
  const isLateReschedule = hoursUntil < 12;

  // Update move date
  const sheet = getSheet(BOOKING_TAB);
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] !== data.moveToken) continue;
    sheet.getRange(i + 1, 6).setValue(data.newDate + ' ' + (data.newTime || ''));
    sheet.getRange(i + 1, 20).setValue('Upcoming');
    break;
  }

  // Notify admin
  try {
    GmailApp.sendEmail(NOTIFY_EMAIL,
      (isLateReschedule ? '[LATE $75 FEE] ' : '') + 'Reschedule request — ' + row[2],
      row[2] + ' rescheduled their move.\nNew date: ' + data.newDate + ' ' + (data.newTime || '') +
      (data.note ? '\nNote: ' + data.note : '') +
      (isLateReschedule ? '\n\nWARNING: Less than 12 hours notice. $75 late reschedule fee applies.' : '') +
      '\nEmail: ' + row[3] + '\nPhone: ' + row[4]
    );
  } catch(e) {}

  return jsonOk({ rescheduled: true, lateReschedule: isLateReschedule });
}

// ═══════════════════════════════════════════════════════════════
//  CANCEL (customer-facing)
// ═══════════════════════════════════════════════════════════════
function cancelBooking(data) {
  const row = findRow(data.moveToken);
  if (!row) return jsonErr('Booking not found');

  const status = String(row[19] || '').toLowerCase();
  if (status === 'cancelled')  return jsonErr('Already cancelled.');
  if (status === 'completed')  return jsonErr('Move already completed.');
  if (status === 'moving' || status === 'arrived') return jsonErr('Move is in progress. Call us directly.');

  const moveDateStr = String(row[5] || '');
  const hoursLeft   = hoursUntilMove(moveDateStr);
  const refundable  = hoursLeft >= 12;

  // Mark cancelled
  updateRowField(data.moveToken, { 19: 'Cancelled' });

  // Issue Stripe refund if eligible
  let refunded = false;
  if (refundable && row[17]) {
    try {
      const sk   = getProp('STRIPE_SK');
      const resp = UrlFetchApp.fetch('https://api.stripe.com/v1/refunds', {
        method: 'post',
        headers: { Authorization: 'Bearer ' + sk },
        payload: { payment_intent: row[17] }
      });
      const r = JSON.parse(resp.getContentText());
      refunded = !r.error;
    } catch(e) {}
  }

  // Email customer
  try {
    GmailApp.sendEmail(row[3],
      'Your VYV Moving booking has been cancelled',
      'Hi ' + row[2] + ',\n\nYour move on ' + row[5] + ' has been cancelled.' +
      (refunded ? '\n\nYour deposit refund is on the way and should appear within 5 to 10 business days.' : refundable ? '\n\nYour cancellation is eligible for a refund, but it needs manual review. Please contact us so we can complete it.' : '\n\nAs the cancellation was made less than 12 hours before your move, the deposit is non-refundable per our cancellation policy.') +
      '\n\nQuestions? Text us at (540) 301-1152.\n\nVYV Moving Team'
    );
  } catch(e) {}

  // Notify admin
  try {
    GmailApp.sendEmail(NOTIFY_EMAIL,
      'Booking cancelled — ' + row[2],
      row[2] + ' cancelled their move scheduled for ' + row[5] + '.' +
      (refunded ? ' Deposit refunded.' : refundable ? ' Eligible refund requires manual review.' : ' NO refund (within 12-hour window).')
    );
  } catch(e) {}

  return jsonOk({ cancelled: true, refunded });
}

// ═══════════════════════════════════════════════════════════════
//  GET ALL BOOKINGS (admin dashboard)
// ═══════════════════════════════════════════════════════════════
function getBookings(data) {
  const sheet = getSheet(BOOKING_TAB);
  const rows  = sheet.getDataRange().getValues();
  const bookings = [];
  for (let i = 1; i < rows.length; i++) {
    bookings.push(rowToBooking(rows[i]));
  }
  return jsonOk({ bookings });
}

// ═══════════════════════════════════════════════════════════════
//  UPDATE STATUS (admin quick actions)
// ═══════════════════════════════════════════════════════════════
function updateStatus(data) {
  const result = updateRowField(data.moveToken, { 19: data.status });
  if (!result) return jsonErr('Booking not found');
  return jsonOk({});
}

// ═══════════════════════════════════════════════════════════════
//  EMAIL HELPERS
// ═══════════════════════════════════════════════════════════════
function sendConfirmationEmail(data, token) {
  const moveLink = 'https://validateyourvision.com/move-day.html?token=' + token;
  const cancelLink = 'https://validateyourvision.com/cancel.html?token=' + token;
  const reschedLink = 'https://validateyourvision.com/reschedule.html?token=' + token;

  const subject = 'Your VYV Moving booking is confirmed!';
  const body =
    'Hi ' + data.name + ',\n\n' +
    'You are all set! Here are your booking details:\n\n' +
    'Date: ' + data.moveDate + '\n' +
    'Crew: ' + data.crew + '\n' +
    'Rate: ' + data.rate + '\n' +
    'From: ' + data.from + '\n' +
    'To: ' + data.to + '\n' +
    'Deposit paid: ' + data.deposit + '\n\n' +
    'Track your crew on move day here:\n' + moveLink + '\n\n' +
    'Need to reschedule? ' + reschedLink + '\n' +
    'Need to cancel? ' + cancelLink + '\n\n' +
    'Cancellations and reschedules are free up to 12 hours before your move.\n\n' +
    'Text us anytime at (540) 301-1152.\n\nVYV Moving Team';

  try { GmailApp.sendEmail(data.email, subject, body); } catch(e) {}
}

function sendFinalInvoiceEmail({ name, email, hours, rate, truckFee, depositPaid, finalCharge }) {
  const labor = (hours * parseFloat(String(rate).replace(/[^0-9.]/g,''))) || 0;
  const subject = 'Your VYV Moving invoice — thank you!';
  const body =
    'Hi ' + name + ',\n\n' +
    'Your move is complete! Here is your final invoice:\n\n' +
    'Hours worked: ' + parseFloat(hours).toFixed(2) + ' hrs\n' +
    'Labor (' + rate + '): $' + labor.toFixed(2) + '\n' +
    'Truck fee: $' + parseFloat(truckFee).toFixed(2) + '\n' +
    'Deposit applied: -$' + parseFloat(depositPaid).toFixed(2) + '\n' +
    '─────────────────────\n' +
    'Balance charged: $' + parseFloat(finalCharge).toFixed(2) + '\n\n' +
    'Thank you so much for trusting us with your move. We hope everything went smoothly!\n\n' +
    'If you have a moment, a Google review means the world to a small business:\n' + REVIEW_LINK + '\n\n' +
    'Questions? Text us at (540) 301-1152.\n\nVYV Moving Team';

  try { GmailApp.sendEmail(email, subject, body); } catch(e) {}
}

function notifyAdmin(data) {
  try {
    GmailApp.sendEmail(NOTIFY_EMAIL,
      'New booking — ' + data.name + ' on ' + data.moveDate,
      'Name: ' + data.name + '\nEmail: ' + data.email + '\nPhone: ' + data.phone +
      '\nDate: ' + data.moveDate + '\nCrew: ' + data.crew + '\nRate: ' + data.rate +
      '\nFrom: ' + data.from + '\nTo: ' + data.to +
      '\nDeposit: ' + data.deposit + '\nPacking: ' + data.packing
    );
  } catch(e) {}
}

// ═══════════════════════════════════════════════════════════════
//  SMS (Twilio)
// ═══════════════════════════════════════════════════════════════
function sendSMS(to, message) {
  try {
    const sid   = getProp('TWILIO_SID');
    const token = getProp('TWILIO_TOKEN');
    const from  = getProp('TWILIO_FROM');
    if (!sid || !token || !from) return;
    UrlFetchApp.fetch('https://api.twilio.com/2010-04-01/Accounts/' + sid + '/Messages.json', {
      method: 'post',
      headers: { Authorization: 'Basic ' + Utilities.base64Encode(sid + ':' + token) },
      payload: { To: to, From: from, Body: message }
    });
  } catch(e) {}
}

// ═══════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════
const BOOKING_HEADERS = [
  'Timestamp','Move Token','Name','Email','Phone','Move Date','Crew','Rate','Truck Fee',
  'From','To','Stops','Volume','Specialty Items','Packing','Notes','Deposit Amount',
  'Payment Intent ID','Payment Method ID','Status','Booked At','Checkin At',
  'Completed At','Hours Worked','Labor Amount','Final Charge','Charge Status'
];

function validateBookingHeaders(sheet) {
  const header = sheet.getRange(1, 1, 1, BOOKING_HEADERS.length).getValues()[0];
  if (!BOOKING_HEADERS.every((name, i) => String(header[i] || '').trim() === name)) {
    throw new Error('The Bookings VYV column layout is unexpected. No data was overwritten.');
  }
}

// Run once from the editor before updating the web-app deployment.
// Copies recognized old rows into a new tab; never edits or deletes the old tab.
function setupBackend() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const legacy = ss.getSheetByName(LEGACY_BOOKING_TAB);
    const oldRows = legacy ? legacy.getDataRange().getValues() : [];
    const converted = convertLegacyRows(oldRows);
    let sheet = ss.getSheetByName(BOOKING_TAB);
    if (!sheet) {
      sheet = ss.insertSheet(BOOKING_TAB);
      if (sheet.getMaxColumns() < BOOKING_HEADERS.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), BOOKING_HEADERS.length - sheet.getMaxColumns());
      sheet.getRange(1, 1, 1, BOOKING_HEADERS.length).setValues([BOOKING_HEADERS]);
      sheet.setFrozenRows(1);
    } else validateBookingHeaders(sheet);
    const existing = new Set(sheet.getDataRange().getValues().slice(1).map(row => String(row[1])));
    const missing = converted.filter(row => {
      if (!row[1] || existing.has(String(row[1]))) return false;
      existing.add(String(row[1]));
      return true;
    });
    if (missing.length) {
      const next = sheet.getLastRow() + 1;
      if (sheet.getMaxRows() < next + missing.length - 1) sheet.insertRowsAfter(sheet.getMaxRows(), next + missing.length - 1 - sheet.getMaxRows());
      sheet.getRange(next, 1, missing.length, BOOKING_HEADERS.length).setValues(missing);
    }
    const result = {ok:true, bookingTab:BOOKING_TAB, copied:missing.length, stripeConfigured:!!getProp('STRIPE_SK')};
    console.log(JSON.stringify(result));
    return result;
  } finally { lock.releaseLock(); }
}

function convertLegacyRows(rows) {
  const nonempty = rows.filter(row => row.some(value => value !== '' && value !== null));
  if (!nonempty.length) return [];
  const first = nonempty[0];
  if (String(first[0]).trim() === 'Timestamp' && /move.?token/i.test(String(first[1]))) {
    return nonempty.slice(1).map(row => BOOKING_HEADERS.map((_, i) => row[i] ?? ''));
  }
  let layout, data;
  if (String(first[0]).trim() === 'Booking ID' && /move.?token/i.test(String(first[1]))) {
    layout = 21; data = nonempty.slice(1);
  } else if (['ID','Booking ID'].includes(String(first[0]).trim())) {
    layout = 28; data = nonempty.slice(1);
  } else if (/^VYV-/.test(String(first[0]))) {
    layout = first[23] ? 28 : 21; data = nonempty;
  } else throw new Error('Old Bookings layout is not recognized. No records were changed.');
  return data.map(row => {
    const out = Array(27).fill('');
    if (layout === 28) {
      const map = [1,23,2,3,4,5,7,8,9,10,11,12,14,15,16,19,17,null,18,20,1,24,25,26,null,27,null];
      map.forEach((old, i) => { if (old !== null) out[i] = row[old] ?? ''; });
    } else {
      const map = [2,1,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,null,18,20,2];
      map.forEach((old, i) => { out[i] = row[old] ?? ''; });
    }
    return out;
  });
}

function getSheet(name) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(name);
  if (!sheet) throw new Error('Run setupBackend once in the editor before accepting bookings. Missing tab: ' + name);
  if (name === BOOKING_TAB) validateBookingHeaders(sheet);
  return sheet;
}

function getProp(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || '';
}

function generateToken() {
  return Utilities.getUuid();
}

function jsonOk(obj) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, ...obj }))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonErr(msg) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: false, error: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}

function findRow(moveToken) {
  if (!moveToken) return null;
  const sheet = getSheet(BOOKING_TAB);
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] === moveToken) return rows[i];
  }
  return null;
}

function updateRowField(moveToken, fieldMap) {
  const sheet = getSheet(BOOKING_TAB);
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] !== moveToken) continue;
    for (const [col, val] of Object.entries(fieldMap)) {
      sheet.getRange(i + 1, parseInt(col) + 1).setValue(val);
    }
    return true;
  }
  return false;
}

function rowToBooking(row) {
  return {
    moveToken:     row[1]  || '',
    name:          row[2]  || '',
    email:         row[3]  || '',
    phone:         row[4]  || '',
    moveDate:      row[5]  || '',
    crew:          row[6]  || '',
    rate:          row[7]  || '',
    truckFee:      row[8]  || '',
    fromAddress:   row[9]  || '',
    toAddress:     row[10] || '',
    stops:         row[11] || '',
    volume:        row[12] || '',
    specialty:     row[13] || '',
    packing:       row[14] || '',
    notes:         row[15] || '',
    depositAmount: String(row[16] || '').replace(/[^0-9.]/g, '') || '0',
    paymentIntentId: row[17] || '',
    status:        row[19] || 'Upcoming',
    bookedAt:      row[20] || '',
    checkinAt:     row[21] || '',
    completedAt:   row[22] || '',
    hoursWorked:   row[23] || null,
    laborAmount:   row[24] || null,
    finalCharge:   row[25] || null,
    chargeStatus:  row[26] || ''
  };
}

function hoursUntilMove(value) {
  const p = bookingDateParts(value);
  if (!p) throw new Error('Move date could not be read. Please contact us.');
  const noon = new Date(p.day + 'T12:00:00Z');
  const offset = Utilities.formatDate(noon, 'America/New_York', 'Z');
  return (new Date(p.day + 'T' + p.time + ':00' + offset.slice(0,3) + ':' + offset.slice(3)) - Date.now()) / 3600000;
}

function bookingDateParts(value) {
  const raw = String(value || '').trim().replace(/^\w+,\s*/, '');
  const clock = raw.match(/(?:T|\s)(\d{1,2}:\d{2})(?:\s*(AM|PM))?$/i);
  const suffix = raw.match(/\b(AM|PM)$/i)?.[1]?.toUpperCase();
  const clean = clock ? raw.slice(0, clock.index) : raw.replace(/\s+(AM|PM)$/i, '');
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(clean) ? clean + 'T12:00:00' : clean);
  if (isNaN(d)) return null;
  let hour = clock ? Number(clock[1].split(':')[0]) : suffix === 'PM' ? 16 : 7;
  if (clock && clock[2]) hour = hour % 12 + (clock[2].toUpperCase() === 'PM' ? 12 : 0);
  const time = String(hour).padStart(2,'0') + ':' + (clock ? clock[1].split(':')[1] : '00');
  return { day: d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'), time, slot: hour < 12 ? 'AM' : 'PM' };
}



// Staff dashboard: password and sessions are server-side only.
const STAFF_TAB = 'Staff Reservations';
const STAFF_HEADERS = ['ID','Status','Move Date','Window','Hold Until','Revision','Updated At','Name','Phone','Email','Record JSON'];
function staffFingerprint(value) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8));
}
function staffLogin(data) {
  const password = getProp('DASHBOARD_PASSWORD');
  if (password.length < 12) return jsonErr('Set DASHBOARD_PASSWORD in Script Properties before signing in.');
  if (typeof data.password !== 'string' || data.password.length > 300 || staffFingerprint(data.password) !== staffFingerprint(password)) return jsonErr('Incorrect dashboard password.');
  const session = Utilities.getUuid() + Utilities.getUuid();
  CacheService.getScriptCache().put('vyv-staff-session:' + session, staffFingerprint(password), 21600);
  return jsonOk({session, expiresIn:21600});
}
function staffAuthorized(token) {
  if (typeof token !== 'string' || !/^[a-fA-F0-9-]{72}$/.test(token)) return false;
  const password = getProp('DASHBOARD_PASSWORD');
  return password.length >= 12 && CacheService.getScriptCache().get('vyv-staff-session:' + token) === staffFingerprint(password);
}
function staffAuthError() {
  return ContentService.createTextOutput(JSON.stringify({ok:false,code:'STAFF_AUTH',error:'Sign in to the staff dashboard.'})).setMimeType(ContentService.MimeType.JSON);
}
function staffSheet(create) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(STAFF_TAB);
  if (!sheet && create) { sheet = ss.insertSheet(STAFF_TAB); sheet.appendRow(STAFF_HEADERS); sheet.setFrozenRows(1); }
  if (sheet && sheet.getLastRow() > 0) {
    const headers = sheet.getRange(1,1,1,STAFF_HEADERS.length).getValues()[0];
    if (JSON.stringify(headers) !== JSON.stringify(STAFF_HEADERS)) throw new Error('Staff Reservations headings do not match. Contact support before saving.');
  }
  return sheet;
}
function staffRecords(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  if (sheet.getLastRow() > 10001) throw new Error('Staff reservation archive needs maintenance before continuing.');
  return sheet.getRange(2,1,sheet.getLastRow()-1,STAFF_HEADERS.length).getValues().map((row,i)=>{
    let record; try { record=JSON.parse(row[10]); } catch(e) { throw new Error('Staff reservation row '+(i+2)+' could not be read.'); }
    return {record,row:i+2};
  });
}
function staffList() { return jsonOk({records:staffRecords(staffSheet(false)).slice(-500).reverse().map(r=>r.record)}); }
function staffResourceSlots(record) {
  const slots = [{date:record.date,time:record.time}];
  if (record.packing && record.packingDate && record.packingTime) slots.push({date:record.packingDate,time:record.packingTime});
  return slots.filter((s,i,a)=>s.date && ['AM','PM'].includes(s.time) && a.findIndex(t=>t.date===s.date&&t.time===s.time)===i);
}
function staffOccupiedSlots(excludeId) {
  return staffRecords(staffSheet(false)).filter(r=>r.record.id!==excludeId && r.record.status==='Awaiting payment' && Date.parse(r.record.holdUntil)>Date.now()).flatMap(r=>staffResourceSlots(r.record));
}
function staffCheckAvailability(record, excludeId) {
  const occupied = staffOccupiedSlots(excludeId);
  getSheet(BOOKING_TAB).getDataRange().getValues().slice(1).forEach(row=>{
    if (['cancelled','canceled'].includes(String(row[19]).toLowerCase())) return;
    const p = bookingDateParts(row[5]); if (p) occupied.push({date:p.day,time:p.slot});
  });
  if (staffResourceSlots(record).some(s=>occupied.some(t=>t.date===s.date&&t.time===s.time))) throw new Error('That move or packing window is already booked or held. Choose another window.');
}
function staffCleanDraft(value) {
  if (!value || typeof value!=='object' || JSON.stringify(value).length>40000) throw new Error('Call record is missing or too large.');
  if (!/^[a-fA-F0-9-]{36}$/.test(value.id||'')) throw new Error('Call ID is invalid. Start a new call.');
  if (!Array.isArray(value.stops) || value.stops.length<2 || value.stops.length>10) throw new Error('Use between 2 and 10 locations.');
  const record={id:value.id,revision:Number(value.revision)||0};
  const fields=['name','phone','email','notes','date','time','volume','density','boxes','ready','packingDate','packingTime','paymentLink'];
  fields.forEach(k=>{record[k]=String(value[k]??'').trim();});
  if (record.name.length>180 || record.email.length>200 || record.phone.length>60 || record.notes.length>8000 || record.paymentLink.length>2000) throw new Error('A call field exceeds its maximum length.');
  if (record.paymentLink && !/^https:\/\/(?:buy|checkout|invoice)\.stripe\.com\/[^\s]*$/i.test(record.paymentLink)) throw new Error('Use an HTTPS Stripe payment or invoice link.');
  record.packing=!!value.packing; record.longCarry=!!value.longCarry;
  const special=['antiques','gun_safe','piano','pool_table','hot_tub','large_tv','artwork'];
  record.specialty=Array.isArray(value.specialty)?[...new Set(value.specialty.filter(x=>special.includes(x)))]:[];
  record.stops=value.stops.map(s=>{const clean={};['address','unit','propType','beds','sqft','garage','stories','floorLevel','elevator','unitSize'].forEach(k=>{clean[k]=String(s[k]??'').slice(0,500);});return clean;});
  record.holdHours=[24,48,72,168].includes(Number(value.holdHours))?Number(value.holdHours):24;
  if (value.distance && Number.isFinite(value.distance.moveMiles) && Number.isFinite(value.distance.baseMiles) && value.distance.moveMiles>=0 && value.distance.baseMiles>=0 && value.distance.moveMiles<10000 && value.distance.baseMiles<10000) record.distance={moveMiles:value.distance.moveMiles,baseMiles:value.distance.baseMiles,routeKey:String(value.distance.routeKey||'')};
  else record.distance=null;
  return record;
}
function staffWrite(sheet, record, row) {
  const safe=v=>/^[=+@-]/.test(String(v))?"'"+v:v;
  const values=[record.id,record.status,record.date,record.time,record.holdUntil,record.revision,record.updatedAt,safe(record.name),safe(record.phone),safe(record.email),JSON.stringify(record)];
  if (row) sheet.getRange(row,1,1,STAFF_HEADERS.length).setValues([values]); else sheet.appendRow(values);
}
function staffSave(data) {
  const lock=LockService.getScriptLock();lock.waitLock(30000);
  try {
    const record=staffCleanDraft(data.draft);const sheet=staffSheet(true);
    const existing=staffRecords(sheet).find(r=>r.record.id===record.id);
    // A lost response can be retried without a duplicate row or second hold.
    if (existing && existing.record.revision!==record.revision) {
      if (existing.record.savedRequestHash===staffFingerprint(JSON.stringify(data.draft)) && existing.record.savedAsReservation===!!data.reserve) return jsonOk({record:existing.record});
      throw new Error('This call changed in another tab. Open its latest saved version before updating.');
    }
    let quote=null;try {quote=VYVStaffModel.quote(record);}catch(e){if(data.reserve)throw e;}
    const today=Utilities.formatDate(new Date(),'America/New_York','yyyy-MM-dd');
    if (data.reserve) {
      quote=VYVStaffModel.validateReservation(record,today);
      if (record.packing && record.packingDate<today) throw new Error('Choose today or a future packing date.');
      staffCheckAvailability(record,record.id);
      record.status='Awaiting payment';record.holdUntil=new Date(Date.now()+record.holdHours*3600000).toISOString();
    } else if (existing && existing.record.status==='Awaiting payment') {
      if (JSON.stringify(staffResourceSlots(existing.record))!==JSON.stringify(staffResourceSlots(record))) throw new Error('Use Reserve to change the date or packing window of an existing reservation.');
      record.status=existing.record.status;record.holdUntil=existing.record.holdUntil;
    } else {record.status='Draft';record.holdUntil='';}
    record.quote=quote;record.paymentStatus='Not verified';record.updatedAt=new Date().toISOString();record.revision=record.revision+1;
    record.savedRequestHash=staffFingerprint(JSON.stringify(data.draft));record.savedAsReservation=!!data.reserve;
    staffWrite(sheet,record,existing?.row);
    return jsonOk({record});
  } finally {lock.releaseLock();}
}
function staffCancel(data) {
  const lock=LockService.getScriptLock();lock.waitLock(30000);
  try {
    const sheet=staffSheet(false), existing=staffRecords(sheet).find(r=>r.record.id===data.id);
    if (!existing) return jsonErr('Reservation not found.');
    if (existing.record.status==='Cancelled') return jsonOk({record:existing.record});
    if (existing.record.revision!==Number(data.revision)) return jsonErr('This reservation changed. Refresh it before cancelling.');
    const record=existing.record;record.status='Cancelled';record.holdUntil='';record.revision++;record.updatedAt=new Date().toISOString();delete record.savedRequestHash;
    staffWrite(sheet,record,existing.row);return jsonOk({record});
  } finally {lock.releaseLock();}
}

// Shared source: assets/booking-pricing.js
/* Shared by public booking, staff quoting and the Apps Script staff backend. */
(function(root){
 const rates={2:{0:180,1:165,2:165,3:170,4:170,5:180,6:180},3:{0:220,1:201,2:199,3:199,4:199,5:210,6:220}};
 function rateForDate(date,crew=3){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')) throw Error('Choose a move date.');
  const d=new Date(date+'T12:00:00Z');
  if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==date) throw Error('Choose a valid date.');
  return rates[crew]?.[d.getUTCDay()] || 0;
 }
 root.VYVPricing={rates,rateForDate,truckFeeFromMiles:miles=>miles<=50?99:125,depositFromBaseMiles:miles=>miles>50?300:250};
})(typeof window!=='undefined'?window:globalThis);


// Shared source: assets/quote-estimator.js
/* VYV planning model. Business assumptions and sources: QUOTE-MODEL.md. */
(function(root) {
  'use strict';
  const roundUp = n => Math.ceil(n * 4) / 4;
  const sizes = [[2.5,4],[5.5,6.45],[6.5,9],[7,11],[10,15],[12,18]];
  function estimate(input) {
    const stops = input.stops || [];
    const origin = stops[0] || {};
    const beds = Number.parseInt(origin.beds,10);
    const sqft = {'0-1000':1,'1000-1500':2,'1500-2000':3,'2000-3000':4,'3000+':5}[origin.sqft];
    let size = Number.isFinite(beds) ? Math.min(5,Math.max(0,beds)) : (sqft || 2);
    if (sqft) size = Math.max(size,sqft);
    const storage = {'5x5':0,'5x10':1,'5x15':2,'10x10':2,'10x15':3,'10x20':4,'10x25':5,'10x30':5};
    if (origin.propType === 'Storage') size = storage[origin.unitSize] ?? 2;
    const volume = {everything:1,most:0.9,half:0.7,few:0.45}[input.volume] || 1;
    const density = {light:0.85,normal:1,heavy:1.35}[input.density] || 1;
    const boxes = Math.max(0,Number(input.boxes) || 0);
    const boxFactor = boxes ? Math.max(1, boxes / ([20,40,65,100,140,180][size])) : 1;
    const inventory = boxes ? Math.max(density,Math.min(2.5,boxFactor)) : density;
    const crew = input.crew === 3 ? 0.85 : 1;
    let low = sizes[size][0] * volume * inventory * crew;
    let high = sizes[size][1] * volume * inventory * crew;
    const baseHandling = [low,high];
    const reasons = [];
    if (inventory > 1) reasons.push('Fuller inventory / box count');
    let accessLow = 0, accessHigh = 0;
    stops.forEach(s => {
      const floors = Math.max(0,(Number(s.floorLevel) || Number.parseInt(s.stories,10) || 1)-1);
      if (floors && s.elevator !== 'yes') { accessLow += floors*0.25; accessHigh += floors*0.6; }
      if (s.elevator === 'yes' && floors) { accessLow += 0.25; accessHigh += 0.75; }
    });
    if (accessHigh) {low += accessLow; high += accessHigh; reasons.push('Stairs / elevator access at all locations');}
    const garage = {'1 Car':0.5,'2 Car':1,'3+ Car':1.5}[origin.garage] || 0;
    low += garage*crew; high += garage*1.5*crew;
    if (garage) reasons.push('Garage contents');
    const extra = Math.max(0,stops.length-2); low += extra*0.5; high += extra;
    if (extra) reasons.push(extra + ' additional stop(s)');
    const special = {gun_safe:0.5,piano:0.75,pool_table:1,hot_tub:0.75,large_tv:0.25,antiques:0.5,artwork:0.25};
    const handling = (input.specialty || []).reduce((sum,key)=>sum+(special[key] || 0),0);
    low += handling; high += handling*1.5;
    if (handling) reasons.push('Special handling time (no separate item fee)');
    if (input.longCarry) {low += 0.5; high += 1.5; reasons.push('Long walk between truck and door');}
    const preparation = input.ready === 'not-ready' && !input.packing ? [1,2.5] : [0,0];
    low += preparation[0]; high += preparation[1];
    if (preparation[1]) reasons.push('Unfinished preparation allowance; packing service and materials still require confirmation');
    const miles = Math.max(0,Number(input.miles) || 0);
    const travelLow = Math.max(0.25,miles/35), travelHigh = Math.max(0.5,miles/20);
    low += travelLow; high += travelHigh;
    reasons.push('Loading, unloading, furniture protection and estimated driving time');
    low = roundUp(Math.max(2,low)); high = roundUp(Math.max(low+0.5,high));
    const quarter = n => Math.round(n*4)/4;
    const hours = [low,high];
    const driving = [roundUp(travelLow),roundUp(travelHigh)];
    const protection = baseHandling.map(h=>quarter(h*0.15));
    const loading = baseHandling.map((h,i)=>quarter(h*0.45 + Math.max(0,hours[i]-driving[i]-baseHandling[i]-preparation[i])/2));
    const unloading = hours.map((h,i)=>quarter(h-driving[i]-protection[i]-loading[i]-preparation[i]));
    const stages = {protection,loading,driving,unloading,preparation};
    const rate = Number(input.rate), truck = Number(input.truckFee), deposit = Number(input.deposit);
    if (![rate,truck,deposit].every(Number.isFinite) || rate <= 0 || truck < 0 || deposit < 0) throw Error('Complete date and distance pricing first.');
    const packingHours = input.packing ? [roundUp(Math.max(2,(size+1)*0.75*inventory*volume)),roundUp(Math.max(3,(size+1)*1.5*inventory*volume))] : [0,0];
    const packingRate = input.packing ? Number(input.packingRate) : 0;
    if (!Number.isFinite(packingRate) || packingRate < 0 || (input.packing && !packingRate)) throw Error('Choose the packing date first.');
    const labor = [Math.round(low*rate),Math.round(high*rate)];
    const packing = packingHours.map(h=>Math.round(h*packingRate));
    const total = [labor[0]+truck+packing[0],labor[1]+truck+packing[1]];
    return {version:2,stages,crew:input.crew,volume:input.volume,density:input.density,boxes,readiness:input.ready,longCarry:!!input.longCarry,hours:[low,high],rate,labor,truckFee:truck,packingHours,packingRate,packing,total,deposit,balance:total.map(v=>Math.max(0,v-deposit)),reasons,needsReview:high>12 || size>=5 || (input.ready==='not-ready' && !input.packing) || !origin.beds && !origin.sqft && origin.propType!=='Storage',miles};
  }
  root.VYVQuote = {estimate};
})(typeof window !== 'undefined' ? window : globalThis);



// Shared source: assets/staff-dashboard-model.js
(function(root){
 function routeKey(draft){return JSON.stringify((draft.stops||[]).map(s=>(s.address||'').trim()));}
 function quote(draft){
  if(!draft.date) throw Error('Choose a move date to calculate the hourly rate.');
  if((draft.stops||[]).length<2||draft.stops.some(s=>!String(s.address||'').trim())) throw Error('Enter an address for pickup, destination and each stop.');
  if(draft.distance?.routeKey!==routeKey(draft)||![draft.distance.moveMiles,draft.distance.baseMiles].every(n=>Number.isFinite(n)&&n>=0)) throw Error('Update the route to calculate the truck fee and deposit.');
  if(draft.packing&&(!draft.packingDate||!['AM','PM'].includes(draft.packingTime))) throw Error('Choose a packing date and arrival window.');
  const p=root.VYVPricing;
  return root.VYVQuote.estimate({stops:draft.stops,crew:3,volume:draft.volume||'everything',specialty:draft.specialty||[],miles:draft.distance.moveMiles,rate:p.rateForDate(draft.date,3),truckFee:p.truckFeeFromMiles(draft.distance.moveMiles),deposit:p.depositFromBaseMiles(draft.distance.baseMiles),packing:!!draft.packing,packingRate:draft.packing?p.rateForDate(draft.packingDate,3):0,density:draft.density||'normal',boxes:draft.boxes||0,ready:draft.ready||'ready',longCarry:!!draft.longCarry});
 }
 function validateReservation(draft,today){
  if(!String(draft.name||'').trim()) throw Error('Add the customer name before reserving.');
  if(!String(draft.phone||'').trim()&&!String(draft.email||'').trim()) throw Error('Add a phone number or email before reserving.');
  if(draft.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email)) throw Error('Check the customer email.');
  if(draft.phone&&String(draft.phone).replace(/\D/g,'').length<10) throw Error('Check the customer phone number.');
  if(!['AM','PM'].includes(draft.time)) throw Error('Choose an AM or PM move window.');
  if(draft.date<today) throw Error('Choose today or a future move date.');
  return quote(draft);
 }
 function isStripeLink(value){try{const u=new URL(value);return u.protocol==='https:'&&['buy.stripe.com','checkout.stripe.com','invoice.stripe.com'].includes(u.hostname)&&!u.username&&!u.password;}catch{return false;}}
 root.VYVStaffModel={routeKey,quote,validateReservation,isStripeLink};
})(typeof window!=='undefined'?window:globalThis);

