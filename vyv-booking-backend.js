// ═══════════════════════════════════════════════════════════════
//  VYV Moving — Google Apps Script Backend
//  Paste this entire file into your GAS editor and re-deploy.
//  Script Properties required: STRIPE_SK, TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM
// ═══════════════════════════════════════════════════════════════

const SHEET_ID      = '1-KEfahm-VkdVG2T_tV6GyF4kRTIUqchanSKKL-kNagM';
const ADMIN_TOKEN   = 'vyv2026admin';
const BOOKING_TAB   = 'Bookings';
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
    const isAdmin = token === ADMIN_TOKEN;

    // ── Public routes (no token needed) ──
    if (action === 'create_payment_intent') return createPaymentIntent(data);
    if (action === 'get_move')              return getMove(data);
    if (action === 'customer_checkin')      return customerCheckin(data);
    if (action === 'reschedule')            return rescheduleBooking(data);
    if (action === 'cancel')               return cancelBooking(data);

    // ── Admin routes ──
    if (!isAdmin) return jsonErr('Unauthorized');

    if (action === 'save')              return saveBooking(data);
    if (action === 'save_lead')         return saveLead(data);
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
    if (action === 'health') return jsonOk({ version: 'booking-payments-v4', paymentsConfigured: !!getProp('STRIPE_SK') });
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
    const value = String(row[5] || '');
    const slot = value.match(/\b(AM|PM)\b/i)?.[1]?.toUpperCase();
    if (!slot) return;
    const clean = value.replace(/\b(?:AM|PM)\b/ig, '').replace(/^\w+,\s*/, '').trim();
    const date = new Date(clean);
    if (isNaN(date.getTime())) return;
    const key = date.getFullYear() + '-' + String(date.getMonth()+1).padStart(2,'0') + '-' + String(date.getDate()).padStart(2,'0');
    if (!slots[key]) slots[key] = [];
    if (!slots[key].includes(slot)) slots[key].push(slot);
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
  if (existing[21]) return jsonOk({checkinAt: existing[21]});
  if (['cancelled','completed'].includes(String(existing[19]).toLowerCase())) return jsonErr('This booking cannot be checked in');
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
      (refunded ? '\n\nYour deposit refund is on the way and should appear within 5 to 10 business days.' : '\n\nAs the cancellation was made less than 12 hours before your move, the deposit is non-refundable per our cancellation policy.') +
      '\n\nQuestions? Text us at (540) 301-1152.\n\nVYV Moving Team'
    );
  } catch(e) {}

  // Notify admin
  try {
    GmailApp.sendEmail(NOTIFY_EMAIL,
      'Booking cancelled — ' + row[2],
      row[2] + ' cancelled their move scheduled for ' + row[5] + '.' +
      (refunded ? ' Deposit refunded.' : ' NO refund (within 12-hour window).')
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
function getSheet(name) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(name);
  if (!sheet) throw new Error('Missing spreadsheet tab: ' + name);
  if (name === BOOKING_TAB) {
    const header = sheet.getRange(1, 1, 1, 27).getValues()[0];
    if (/^(Booking ID|ID)$/i.test(String(header[0] || '').trim())) {
      throw new Error('Bookings uses an older column layout. Migrate it before enabling this backend.');
    }
  }
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

function hoursUntilMove(moveDateStr) {
  const value = String(moveDateStr || '').trim();
  const slot = value.match(/\b(AM|PM)\s*$/i)?.[1]?.toUpperCase();
  const clean = value.replace(/\b(?:AM|PM)\s*$/i, '').replace(/^\w+,\s*/, '').trim();
  const date = new Date(clean);
  if (isNaN(date.getTime())) throw new Error('Move date could not be read. Please contact us.');
  const hasClock = /\d{1,2}:\d{2}/.test(clean);
  if (slot && !hasClock) {
    const day = date.getFullYear() + '-' + String(date.getMonth()+1).padStart(2,'0') + '-' + String(date.getDate()).padStart(2,'0');
    const offset = Utilities.formatDate(date, 'America/New_York', 'Z');
    const instant = new Date(day + (slot === 'AM' ? 'T07:00:00' : 'T16:00:00') + offset.slice(0,3) + ':' + offset.slice(3));
    return (instant - Date.now()) / 3600000;
  }
  return (date - Date.now()) / 3600000;
}
