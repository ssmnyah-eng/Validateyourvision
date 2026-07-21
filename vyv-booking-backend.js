// ─────────────────────────────────────────────────────────────
//  VYV Moving — Google Apps Script Backend v2
//  Paste into script.google.com → Deploy as Web App → Anyone
//
//  Set these in GAS BEFORE deploying:
//  Project Settings → Script Properties → Add property
//    STRIPE_SK     → your Stripe live secret key (sk_live_...)
//    TWILIO_TOKEN  → your Twilio auth token
//    TWILIO_SID    → your Twilio account SID (ACf13...)
//    TWILIO_FROM   → your Twilio phone number (+1737...)
// ─────────────────────────────────────────────────────────────

const ADMIN_TOKEN    = 'vyv2026admin';
const NOTIFY_EMAIL   = 'hello@validateyourvision.com';
const CALENDAR_ID    = 'primary';
const BOOKINGS_SHEET = 'Bookings';
const LEADS_SHEET    = 'Leads';
const SITE_URL       = 'https://validateyourvision.com';
const RATES          = { 2: 165, 3: 199 }; // $ per hour, 15-min prorate

// ── ROUTING ───────────────────────────────────────────────────
function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);

    // Public (customer uses move token, not admin token)
    if (d.action === 'start_timer') return json(startTimer(d));

    // Admin
    if (d.token !== ADMIN_TOKEN) return json({ ok: false, error: 'Unauthorized' });

    if (d.action === 'save')          return json(saveBooking(d));
    if (d.action === 'save_lead')     return json(saveLead(d));
    if (d.action === 'update_status') return json(updateStatus(d));
    if (d.action === 'on_the_way')    return json(onTheWay(d));
    if (d.action === 'arrived')       return json(arrived(d));
    if (d.action === 'complete_move') return json(completeMove(d));

    return json({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return json({ ok: false, error: err.message });
  }
}

function doGet(e) {
  try {
    const action = e.parameter.action || 'get_bookings';

    // Public: customer portal polling
    if (action === 'get_move') return json(getMove(e.parameter.id, e.parameter.moveToken));

    const token = e.parameter.token;
    if (token !== ADMIN_TOKEN) return json({ ok: false, error: 'Unauthorized' });

    if (action === 'get_bookings') return json(getBookings());
    if (action === 'get_leads')    return json(getLeads());

    return json({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return json({ ok: false, error: err.message });
  }
}

// ── SAVE BOOKING ──────────────────────────────────────────────
function saveBooking(d) {
  const ss = getOrCreateSheet(BOOKINGS_SHEET, [
    'ID','Booked At','Name','Email','Phone',
    'Move Date','Time','Crew','Rate','Truck Fee',
    'Moving From','Moving To','Stops',
    'Property Details','Volume','Specialty','Packing',
    'Deposit','Payment Method','Notes','Status',
    'StripeCustomerId','StripePaymentMethodId','MoveToken',
    'TimerStart','TimerEnd','FinalHours','FinalCharge'
  ]);

  const id        = 'VYV-' + Date.now();
  const moveToken = generateToken();

  let stripeCustomerId      = '';
  let stripePaymentMethodId = d.paymentMethod || '';

  if (d.paymentMethod && d.paymentMethod !== 'TEST_MODE') {
    const sr = chargeDeposit(d, id);
    stripeCustomerId      = sr.customerId || '';
    stripePaymentMethodId = sr.paymentMethodId || d.paymentMethod;
  }

  ss.appendRow([
    id,
    d.bookedAt || new Date().toISOString(),
    d.name, d.email, d.phone,
    d.moveDate, d.time || '',
    d.crew, d.rate, d.truckFee || '',
    d.from, d.to, d.stops || 1,
    d.propertyDetails || '',
    d.volume || '', d.specialty || '', d.packing || 'No',
    d.deposit || '', d.paymentMethod || '',
    d.notes || '', 'Upcoming',
    stripeCustomerId, stripePaymentMethodId, moveToken,
    '', '', '', ''
  ]);

  const full = { ...d, id, moveToken };
  sendConfirmationEmail(full, id);
  sendOwnerAlert(full, id);
  createCalendarEvent(full, id);

  return { ok: true, id, moveToken };
}

// ── STRIPE: CHARGE DEPOSIT ────────────────────────────────────
function chargeDeposit(d, bookingId) {
  const sk = PropertiesService.getScriptProperties().getProperty('STRIPE_SK');
  if (!sk) return { customerId: '', paymentMethodId: d.paymentMethod };

  try {
    const customer = stripeRequest('POST', '/customers', {
      email: d.email,
      name: d.name,
      phone: d.phone || '',
      'metadata[bookingId]': bookingId,
      payment_method: d.paymentMethod
    });
    if (!customer.id) throw new Error('Customer creation failed');

    stripeRequest('POST', `/payment_methods/${d.paymentMethod}/attach`, {
      customer: customer.id
    });

    stripeRequest('POST', `/customers/${customer.id}`, {
      'invoice_settings[default_payment_method]': d.paymentMethod
    });

    const cents = Math.round(parseFloat((d.deposit || '').replace(/[^0-9.]/g, '') || 250) * 100);
    stripeRequest('POST', '/payment_intents', {
      amount: cents,
      currency: 'usd',
      customer: customer.id,
      payment_method: d.paymentMethod,
      confirm: 'true',
      off_session: 'true',
      'metadata[bookingId]': bookingId,
      'metadata[type]': 'deposit',
      description: `VYV deposit - ${d.name} - ${d.moveDate}`
    });

    return { customerId: customer.id, paymentMethodId: d.paymentMethod };
  } catch (err) {
    console.log('Stripe deposit error: ' + err.message);
    return { customerId: '', paymentMethodId: d.paymentMethod };
  }
}

// ── ON THE WAY ────────────────────────────────────────────────
function onTheWay(d) {
  const b = findBooking(d.id);
  if (!b) return { ok: false, error: 'Not found' };

  updateBookingField(d.id, 'Status', 'On The Way');

  const first = b.Name.split(' ')[0];
  GmailApp.sendEmail(b.Email, `Your VYV movers are on the way, ${first}!`, '',
    { htmlBody: onTheWayHtml(b), name: 'VYV Moving' });

  const phone = (b.Phone || '').replace(/\D/g, '');
  if (phone) sendSMS('+1' + phone,
    `Hi ${first}! Your VYV Moving crew is on the way. We will see you shortly! Questions? Reply here.`);

  return { ok: true };
}

// ── ARRIVED ───────────────────────────────────────────────────
function arrived(d) {
  const b = findBooking(d.id);
  if (!b) return { ok: false, error: 'Not found' };

  updateBookingField(d.id, 'Status', 'Arrived');

  const first     = b.Name.split(' ')[0];
  const moveToken = b.MoveToken || '';
  const link      = `${SITE_URL}/move-day.html?id=${b.ID}&moveToken=${moveToken}`;

  GmailApp.sendEmail(b.Email, `Your VYV movers have arrived, ${first}!`, '',
    { htmlBody: arrivedHtml(b, link), name: 'VYV Moving' });

  const phone = (b.Phone || '').replace(/\D/g, '');
  if (phone) sendSMS('+1' + phone,
    `Hi ${first}! Your VYV Moving crew has arrived. Tap to sign them in and start your move: ${link}`);

  return { ok: true };
}

// ── START TIMER (customer signs in movers) ────────────────────
function startTimer(d) {
  const b = findBookingByToken(d.id, d.moveToken);
  if (!b) return { ok: false, error: 'Invalid link' };

  if (b.TimerStart) return { ok: true, timerStart: b.TimerStart, alreadyStarted: true };

  const now = new Date().toISOString();
  updateBookingField(d.id, 'TimerStart', now);
  updateBookingField(d.id, 'Status', 'In Progress');

  return { ok: true, timerStart: now };
}

// ── GET MOVE (customer portal) ────────────────────────────────
function getMove(id, moveToken) {
  if (!id || !moveToken) return { ok: false, error: 'Missing params' };
  const b = findBookingByToken(id, moveToken);
  if (!b) return { ok: false, error: 'Not found' };

  return {
    ok: true,
    booking: {
      id:         b.ID,
      name:       b.Name,
      moveDate:   b['Move Date'],
      crew:       b.Crew,
      rate:       b.Rate,
      from:       b['Moving From'],
      to:         b['Moving To'],
      status:     b.Status,
      timerStart: b.TimerStart || '',
      timerEnd:   b.TimerEnd   || '',
      deposit:    b.Deposit    || ''
    }
  };
}

// ── COMPLETE MOVE ─────────────────────────────────────────────
function completeMove(d) {
  const b = findBooking(d.id);
  if (!b)            return { ok: false, error: 'Not found' };
  if (!b.TimerStart) return { ok: false, error: 'Timer not started' };

  const now       = new Date();
  const elapsedMs = now - new Date(b.TimerStart);

  const blockMs  = 15 * 60 * 1000;
  const blocks   = Math.ceil(elapsedMs / blockMs);
  const hours    = blocks / 4;

  const crewNum     = parseInt((b.Crew || '2').replace(/\D/g, '')) || 2;
  const ratePerHour = RATES[crewNum] || 165;
  const totalAmount = Math.round(hours * ratePerHour * 100) / 100;
  const depositPaid = parseFloat((b.Deposit || '').replace(/[^0-9.]/g, '')) || 250;
  const finalCharge = Math.max(0, Math.round((totalAmount - depositPaid) * 100) / 100);

  let charged = false;
  if (b.StripeCustomerId && b.StripePaymentMethodId && finalCharge > 0) {
    charged = chargeFinal(b, finalCharge, hours, ratePerHour).ok;
  }

  const timerEnd = now.toISOString();
  updateBookingField(d.id, 'TimerEnd',    timerEnd);
  updateBookingField(d.id, 'FinalHours',  hours.toFixed(2));
  updateBookingField(d.id, 'FinalCharge', finalCharge.toFixed(2));
  updateBookingField(d.id, 'Status',      'Complete');

  sendReceipt(b, hours, ratePerHour, totalAmount, depositPaid, finalCharge, b.TimerStart, timerEnd);

  return { ok: true, hours, totalAmount, depositPaid, finalCharge, charged };
}

function chargeFinal(b, finalCharge, hours, ratePerHour) {
  const sk = PropertiesService.getScriptProperties().getProperty('STRIPE_SK');
  if (!sk) return { ok: false };
  try {
    const r = stripeRequest('POST', '/payment_intents', {
      amount: Math.round(finalCharge * 100),
      currency: 'usd',
      customer: b.StripeCustomerId,
      payment_method: b.StripePaymentMethodId,
      confirm: 'true',
      off_session: 'true',
      'metadata[bookingId]': b.ID,
      'metadata[type]': 'final_charge',
      description: `VYV final balance - ${b.Name} - ${hours}hr @ $${ratePerHour}/hr`
    });
    return { ok: !r.error };
  } catch (err) {
    console.log('Final charge error: ' + err.message);
    return { ok: false };
  }
}

// ── SAVE LEAD ─────────────────────────────────────────────────
function saveLead(d) {
  const ss = getOrCreateSheet(LEADS_SHEET, [
    'Captured At','Name','Email','Phone','Moving From','Moving To','Source'
  ]);
  ss.appendRow([
    d.capturedAt || new Date().toISOString(),
    d.name||'', d.email||'', d.phone||'',
    d.from||'', d.to||'', d.source||'Booking Form'
  ]);
  return { ok: true };
}

// ── UPDATE STATUS ─────────────────────────────────────────────
function updateStatus(d) {
  return updateBookingField(d.id, 'Status', d.status)
    ? { ok: true }
    : { ok: false, error: 'Not found' };
}

// ── GET BOOKINGS ──────────────────────────────────────────────
function getBookings() {
  const ss   = getOrCreateSheet(BOOKINGS_SHEET, []);
  const data = ss.getDataRange().getValues();
  if (data.length < 2) return { ok: true, bookings: [] };
  const headers = data[0];
  return {
    ok: true,
    bookings: data.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    })
  };
}

// ── GET LEADS ─────────────────────────────────────────────────
function getLeads() {
  const ss   = getOrCreateSheet(LEADS_SHEET, []);
  const data = ss.getDataRange().getValues();
  if (data.length < 2) return { ok: true, leads: [] };
  const headers = data[0];
  return {
    ok: true,
    leads: data.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    })
  };
}

// ── CONFIRMATION EMAIL ────────────────────────────────────────
function sendConfirmationEmail(d, id) {
  if (!d.email) return;
  const firstName = (d.name || '').split(' ')[0] || 'there';
  const subject   = `You're booked, ${firstName}! -- VYV Moving`;

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
body{margin:0;padding:24px 16px;background:#f0ecf8;font-family:'Helvetica Neue',Arial,sans-serif;}
.wrap{max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(25,14,42,.10);}
.hdr{background:#190E2A;padding:20px 28px;}.hdr-name{font-size:.85rem;font-weight:800;color:#ECEBEE;}.hdr-sub{font-size:.65rem;color:#8B5BC7;margin-top:1px;}
.hero{background:#fff;border-bottom:1px solid #e6dff5;padding:24px 28px 20px;text-align:center;}
.badge{display:inline-block;background:#d4eddf;border:1px solid #9dd0b4;border-radius:50px;padding:3px 12px;font-size:.62rem;font-weight:700;color:#166534;letter-spacing:.1em;text-transform:uppercase;margin-bottom:10px;}
.hero h1{font-size:1.35rem;font-weight:800;color:#190E2A;margin:0 0 6px;line-height:1.25;}.hero h1 span{color:#4A237A;}
.hero p{font-size:.8rem;color:#6b5b8a;line-height:1.6;margin:0;}
.body{padding:20px 28px 28px;}
.callout{background:#d4eddf;border:1px solid #9dd0b4;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:.78rem;color:#166534;line-height:1.55;}
.callout strong{display:block;font-size:.68rem;text-transform:uppercase;letter-spacing:.07em;margin-bottom:3px;}
.journey{background:#faf8ff;border:1px solid #e6dff5;border-radius:10px;padding:16px;margin-bottom:14px;}
.j-label{font-size:.62rem;font-weight:700;color:#8B5BC7;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px;}
.j-title{font-size:.85rem;font-weight:700;color:#190E2A;margin-bottom:12px;}
.truck-row{text-align:center;margin-bottom:6px;font-size:1.6rem;}
.track{height:5px;background:#e6dff5;border-radius:3px;margin-bottom:8px;}
.track-fill{height:100%;width:10%;background:#16a34a;border-radius:3px;}
.steps-row{display:flex;justify-content:space-between;text-align:center;}
.s-col{flex:1;display:flex;flex-direction:column;align-items:center;gap:5px;}
.s-dot{width:22px;height:22px;border-radius:50%;border:2px solid #d4c9e8;background:#fff;font-size:.6rem;font-weight:700;color:#a892cc;display:flex;align-items:center;justify-content:center;margin:0 auto;}
.s-dot.active{background:#16a34a;border-color:#16a34a;color:#fff;}
.s-lbl{font-size:.58rem;color:#a892cc;line-height:1.3;max-width:60px;}.s-lbl.active{color:#16a34a;font-weight:700;}
.steps-card{border:1px solid #e6dff5;border-radius:10px;overflow:hidden;margin-bottom:14px;}
.sc-hdr{background:#190E2A;padding:12px 16px;}.sc-lbl{font-size:.6rem;font-weight:700;color:#8B5BC7;text-transform:uppercase;letter-spacing:.1em;margin-bottom:2px;}.sc-hdr h3{font-size:.82rem;font-weight:700;color:#ECEBEE;margin:0;}
.si{display:flex;gap:10px;align-items:flex-start;padding:10px 14px;border-bottom:1px solid #e6dff5;background:#fff;}.si:last-child{border-bottom:none;}
.si-num{width:22px;height:22px;min-width:22px;border-radius:50%;background:#4A237A;color:#fff;font-size:.62rem;font-weight:800;display:flex;align-items:center;justify-content:center;margin-top:1px;}
.si-num.cur{background:#16a34a;}
.si-content strong{display:block;font-size:.78rem;font-weight:700;color:#190E2A;margin-bottom:1px;}
.si-content span{font-size:.72rem;color:#6b5b8a;line-height:1.5;}
.here{display:inline-block;background:#d4eddf;color:#166534;font-size:.55rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;padding:1px 6px;border-radius:50px;margin-left:4px;vertical-align:middle;}
.notice{background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:10px 14px;margin-bottom:14px;display:flex;gap:8px;align-items:flex-start;}
.notice strong{display:block;font-size:.68rem;font-weight:700;color:#0c4a6e;margin-bottom:2px;}
.notice p{font-size:.72rem;color:#0369a1;line-height:1.5;margin:0;}
.btns{display:flex;gap:8px;margin-bottom:14px;}
.btn{flex:1;display:block;text-align:center;padding:10px 12px;border-radius:7px;font-size:.72rem;font-weight:700;letter-spacing:.04em;text-decoration:none;text-transform:uppercase;}
.btn-rs{color:#4A237A;border:2px solid #4A237A;}.btn-cn{color:#dc2626;border:2px solid #fca5a5;}
.tips{background:#faf8ff;border:1px solid #e6dff5;border-radius:8px;padding:12px 14px;margin-bottom:14px;}
.tips-title{font-size:.7rem;font-weight:700;color:#190E2A;margin-bottom:8px;}
.tip{display:flex;gap:7px;font-size:.72rem;color:#6b5b8a;line-height:1.5;margin-bottom:6px;}.tip:last-child{margin-bottom:0;}
.tip-ck{color:#8B5BC7;font-weight:700;flex-shrink:0;}.tip strong{color:#190E2A;}
.contact{text-align:center;font-size:.72rem;color:#6b5b8a;padding-top:12px;border-top:1px solid #e6dff5;}.contact a{color:#8B5BC7;font-weight:600;text-decoration:none;}
.ftr{background:#190E2A;padding:18px 28px;text-align:center;}.ftr-name{font-size:.8rem;font-weight:800;color:#ECEBEE;}.ftr-sub{font-size:.62rem;color:#8B5BC7;margin-top:2px;}
.ftr p{font-size:.65rem;color:rgba(236,235,238,.4);line-height:1.8;margin-top:10px;}.ftr a{color:rgba(139,91,199,.8);text-decoration:none;}
</style></head><body>
<div class="wrap">
<div class="hdr"><div class="hdr-name">Validate Your Vision Moving</div><div class="hdr-sub">Fredericksburg, VA &middot; Licensed &amp; Insured</div></div>
<div class="hero">
  <div class="badge">&#9679; Move Confirmed</div>
  <h1>Congrats, <span>${firstName}.</span><br>You're officially booked.</h1>
  <p>Your crew is reserved and your date is locked in. We can't wait to make this the smoothest move you've ever had.</p>
</div>
<div class="body">
<div class="callout"><strong>&#10003; Deposit received &amp; applied to your balance</strong>Your deposit is not an extra fee. It comes straight off your total on move day. The remaining balance is due when the job is complete.</div>
<div class="journey">
  <div class="j-label">Your move journey</div><div class="j-title">Here's where you stand</div>
  <div class="truck-row">&#128666;</div>
  <div class="track"><div class="track-fill"></div></div>
  <div class="steps-row">
    <div class="s-col"><div class="s-dot active">&#10003;</div><div class="s-lbl active">Booked</div></div>
    <div class="s-col"><div class="s-dot">2</div><div class="s-lbl">Prep &amp; Pack</div></div>
    <div class="s-col"><div class="s-dot">3</div><div class="s-lbl">Crew En Route</div></div>
    <div class="s-col"><div class="s-dot">4</div><div class="s-lbl">Moving Day</div></div>
    <div class="s-col"><div class="s-dot">5</div><div class="s-lbl">Done &amp; Paid</div></div>
  </div>
</div>
<div class="steps-card">
  <div class="sc-hdr"><div class="sc-lbl">What happens next</div><h3>Your roadmap to moving day</h3></div>
  <div class="si"><div class="si-num cur">&#10003;</div><div class="si-content"><strong>You're booked <span class="here">You are here</span></strong><span>Deposit received, date locked in. You'll get a text from us the day before to confirm.</span></div></div>
  <div class="si"><div class="si-num">2</div><div class="si-content"><strong>Pack early</strong><span>Start with non-essentials. Label every box with the room name. The more ready you are, the faster your crew moves.</span></div></div>
  <div class="si"><div class="si-num">3</div><div class="si-content"><strong>We text + email you when we're on the way</strong><span>You'll get a heads-up before your crew leaves. No need to track anything -- we come to you.</span></div></div>
  <div class="si"><div class="si-num">4</div><div class="si-content"><strong>Moving day</strong><span>Your crew arrives in uniform with a clear plan. Your price does not change.</span></div></div>
  <div class="si" style="border-bottom:none;"><div class="si-num">5</div><div class="si-content"><strong>Done -- balance charged automatically</strong><span>When the job is complete, the remaining balance is charged to your card on file. No chasing invoices.</span></div></div>
</div>
<div class="notice"><div style="font-size:1rem;">&#128241;</div><div><strong>We'll reach out before your movers leave</strong><p>You'll receive both a text and an email when your crew is on the way.</p></div></div>
<div class="btns">
  <a href="sms:+15403001414?body=Hi, I need to reschedule. Booking: ${d.name}" class="btn btn-rs">Reschedule</a>
  <a href="sms:+15403001414?body=Hi, I need to cancel. Booking: ${d.name}" class="btn btn-cn">Cancel Booking</a>
</div>
<div class="tips">
  <div class="tips-title">Before moving day</div>
  <div class="tip"><span class="tip-ck">&#10003;</span><span><strong>Start boxing non-essentials now.</strong> Label every box with the room name.</span></div>
  <div class="tip"><span class="tip-ck">&#10003;</span><span><strong>Defrost the freezer 24 hours ahead.</strong> We can't move a leaking appliance.</span></div>
  <div class="tip"><span class="tip-ck">&#10003;</span><span><strong>Reserve parking at both locations.</strong> Parking delays come out of your time.</span></div>
  <div class="tip"><span class="tip-ck">&#10003;</span><span><strong>Pack a moving day bag.</strong> Charger, meds, snacks. Keep it with you, not on the truck.</span></div>
</div>
<div class="contact">Questions? Text us anytime at <a href="sms:+15403001414">(540) 300-1414</a><br>
<span style="font-size:.68rem;color:#b0a0cc;">Changes? Text us at least 24 hours before your move at no charge.</span></div>
</div>
<div class="ftr">
  <div class="ftr-name">Validate Your Vision Moving</div>
  <div class="ftr-sub">Fredericksburg, VA &middot; Licensed &amp; Insured &middot; Locally Owned</div>
  <p>You received this because you booked a move with VYV.<br>
  <a href="https://validateyourvision.com/policy.html">Cancellation &amp; Refund Policy</a> &middot; <a href="https://validateyourvision.com">validateyourvision.com</a></p>
</div>
</div></body></html>`;

  GmailApp.sendEmail(d.email, subject, '', { htmlBody: html, name: 'VYV Moving' });
}

// ── OWNER ALERT ───────────────────────────────────────────────
function sendOwnerAlert(d, id) {
  const subject = `New Booking: ${d.name} -- ${d.moveDate}`;
  const body    = `New VYV booking!\n\nID: ${id}\nName: ${d.name}\nEmail: ${d.email}\nPhone: ${d.phone}\nMove Date: ${d.moveDate}\nCrew: ${d.crew}\nFrom: ${d.from}\nTo: ${d.to}\nDeposit: ${d.deposit}\nPacking: ${d.packing||'No'}\nNotes: ${d.notes||'None'}\n\nDashboard: https://validateyourvision.com/admin.html`;
  GmailApp.sendEmail(NOTIFY_EMAIL, subject, body, { name: 'VYV Booking System' });
}

// ── CALENDAR EVENT ────────────────────────────────────────────
function createCalendarEvent(d, id) {
  try {
    const cal     = CalendarApp.getCalendarById(CALENDAR_ID) || CalendarApp.getDefaultCalendar();
    const dateStr = d.moveDate ? d.moveDate.replace(/(AM|PM).*/,'').trim() : '';
    const isAM    = d.moveDate && d.moveDate.includes('AM');
    const date    = dateStr ? new Date(dateStr) : new Date();
    const start   = new Date(date);
    start.setHours(isAM ? 7 : 12, 0, 0, 0);
    const end = new Date(start);
    end.setHours(start.getHours() + 4);
    cal.createEvent(`VYV Move: ${d.name} (${d.crew})`, start, end, {
      description: `ID: ${id}\nCustomer: ${d.name}\nPhone: ${d.phone}\nFrom: ${d.from}\nTo: ${d.to}\nCrew: ${d.crew} @ ${d.rate}\nDeposit: ${d.deposit}\nPacking: ${d.packing||'No'}\nNotes: ${d.notes||'None'}`
    });
  } catch (err) {
    console.log('Calendar error: ' + err.message);
  }
}

// ── RECEIPT ───────────────────────────────────────────────────
function sendReceipt(b, hours, ratePerHour, totalAmount, depositPaid, finalCharge, timerStart, timerEnd) {
  const firstName = b.Name.split(' ')[0];
  const duration  = formatDuration(new Date(timerEnd) - new Date(timerStart));

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<style>body{margin:0;padding:24px 16px;background:#f0ecf8;font-family:'Helvetica Neue',Arial,sans-serif;}.wrap{max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(25,14,42,.10);}.hdr{background:#190E2A;padding:20px 28px;}.hdr-name{font-size:.85rem;font-weight:800;color:#ECEBEE;}.hdr-sub{font-size:.65rem;color:#8B5BC7;margin-top:1px;}.hero{background:#fff;border-bottom:1px solid #e6dff5;padding:24px 28px;text-align:center;}.badge{display:inline-block;background:#d4eddf;border:1px solid #9dd0b4;border-radius:50px;padding:3px 12px;font-size:.62rem;font-weight:700;color:#166534;letter-spacing:.1em;text-transform:uppercase;margin-bottom:10px;}.hero h1{font-size:1.35rem;font-weight:800;color:#190E2A;margin:0 0 6px;}.hero p{font-size:.8rem;color:#6b5b8a;line-height:1.6;margin:0;}.body{padding:20px 28px 28px;}.receipt{border:1px solid #e6dff5;border-radius:10px;overflow:hidden;margin-bottom:14px;}.r-hdr{background:#190E2A;padding:10px 16px;}.r-hdr h3{font-size:.82rem;font-weight:700;color:#ECEBEE;margin:0;}.r-row{display:flex;justify-content:space-between;padding:9px 16px;border-bottom:1px solid #f0ecf8;font-size:.78rem;}.r-row:last-child{border-bottom:none;}.r-label{color:#6b5b8a;}.r-val{font-weight:600;color:#190E2A;}.r-total{background:#faf8ff;font-weight:800;font-size:.85rem;}.r-total .r-label{color:#4A237A;font-weight:700;}.r-total .r-val{color:#4A237A;}.r-charged{background:#d4eddf;font-weight:700;}.r-charged .r-label,.r-charged .r-val{color:#166534;}.contact{text-align:center;font-size:.72rem;color:#6b5b8a;padding-top:12px;border-top:1px solid #e6dff5;}.contact a{color:#8B5BC7;font-weight:600;text-decoration:none;}.ftr{background:#190E2A;padding:18px 28px;text-align:center;font-size:.65rem;color:rgba(236,235,238,.4);line-height:1.8;}.ftr a{color:rgba(139,91,199,.8);text-decoration:none;}
</style></head><body>
<div class="wrap">
<div class="hdr"><div class="hdr-name">Validate Your Vision Moving</div><div class="hdr-sub">Fredericksburg, VA &middot; Licensed &amp; Insured</div></div>
<div class="hero"><div class="badge">&#10003; Move Complete</div><h1>You're all moved in, ${firstName}.</h1><p>Your crew wrapped up in ${duration}. Thank you for choosing VYV Moving!</p></div>
<div class="body">
<div class="receipt">
  <div class="r-hdr"><h3>Move Receipt</h3></div>
  <div class="r-row"><span class="r-label">Time on the job</span><span class="r-val">${duration}</span></div>
  <div class="r-row"><span class="r-label">Crew</span><span class="r-val">${b.Crew}</span></div>
  <div class="r-row"><span class="r-label">Rate</span><span class="r-val">$${ratePerHour}/hr (15-min prorate)</span></div>
  <div class="r-row r-total"><span class="r-label">Total</span><span class="r-val">$${totalAmount.toFixed(2)}</span></div>
  <div class="r-row"><span class="r-label">Deposit already paid</span><span class="r-val">-$${depositPaid.toFixed(2)}</span></div>
  <div class="r-row r-charged"><span class="r-label">&#10003; Charged to card on file</span><span class="r-val">$${finalCharge.toFixed(2)}</span></div>
</div>
<div class="contact">Questions about your receipt? Text us at <a href="sms:+15403001414">(540) 300-1414</a></div>
</div>
<div class="ftr">Validate Your Vision Moving &middot; Fredericksburg, VA &middot; <a href="https://validateyourvision.com">validateyourvision.com</a></div>
</div></body></html>`;

  GmailApp.sendEmail(b.Email, `Your VYV Moving receipt -- $${finalCharge.toFixed(2)} charged today`, '', {
    htmlBody: html, name: 'VYV Moving'
  });

  const phone = (b.Phone || '').replace(/\D/g, '');
  if (phone) sendSMS('+1' + phone,
    `VYV Moving: Move complete! ${duration} on the job. Total: $${totalAmount.toFixed(2)}, deposit paid: $${depositPaid.toFixed(2)}, charged today: $${finalCharge.toFixed(2)}. Thank you!`);
}

// ── EMAIL TEMPLATES ───────────────────────────────────────────
function onTheWayHtml(b) {
  const firstName = b.Name.split(' ')[0];
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><style>body{margin:0;padding:24px 16px;background:#f0ecf8;font-family:'Helvetica Neue',Arial,sans-serif;}.wrap{max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(25,14,42,.10);}.hdr{background:#190E2A;padding:20px 28px;}.hdr-name{font-size:.85rem;font-weight:800;color:#ECEBEE;}.hero{padding:28px;text-align:center;border-bottom:1px solid #e6dff5;}.badge{display:inline-block;background:#fef3c7;border:1px solid #f59e0b;border-radius:50px;padding:3px 12px;font-size:.62rem;font-weight:700;color:#92400e;letter-spacing:.1em;text-transform:uppercase;margin-bottom:10px;}.truck{font-size:3rem;margin:10px 0;}.hero h1{font-size:1.25rem;font-weight:800;color:#190E2A;margin:0 0 8px;}.hero p{font-size:.8rem;color:#6b5b8a;line-height:1.6;margin:0;}.body{padding:20px 28px;}.contact{text-align:center;font-size:.72rem;color:#6b5b8a;padding-top:12px;border-top:1px solid #e6dff5;}.contact a{color:#8B5BC7;font-weight:600;text-decoration:none;}.ftr{background:#190E2A;padding:16px 28px;text-align:center;font-size:.65rem;color:rgba(236,235,238,.4);}</style></head><body><div class="wrap"><div class="hdr"><div class="hdr-name">Validate Your Vision Moving</div></div><div class="hero"><div class="badge">On the way</div><div class="truck">&#128666;</div><h1>Your crew is on the way, ${firstName}!</h1><p>Your VYV Moving team has left and is heading to you now. Make sure parking is clear and you're ready to go!</p></div><div class="body"><div class="contact">Questions? Text us at <a href="sms:+15403001414">(540) 300-1414</a></div></div><div class="ftr">Validate Your Vision Moving &middot; Fredericksburg, VA &middot; validateyourvision.com</div></div></body></html>`;
}

function arrivedHtml(b, moveLink) {
  const firstName = b.Name.split(' ')[0];
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><style>body{margin:0;padding:24px 16px;background:#f0ecf8;font-family:'Helvetica Neue',Arial,sans-serif;}.wrap{max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(25,14,42,.10);}.hdr{background:#190E2A;padding:20px 28px;}.hdr-name{font-size:.85rem;font-weight:800;color:#ECEBEE;}.hero{padding:28px;text-align:center;border-bottom:1px solid #e6dff5;}.badge{display:inline-block;background:#d4eddf;border:1px solid #9dd0b4;border-radius:50px;padding:3px 12px;font-size:.62rem;font-weight:700;color:#166534;letter-spacing:.1em;text-transform:uppercase;margin-bottom:10px;}.hero h1{font-size:1.25rem;font-weight:800;color:#190E2A;margin:0 0 8px;}.hero p{font-size:.8rem;color:#6b5b8a;line-height:1.6;margin:0;}.body{padding:20px 28px;}.btn-wrap{text-align:center;margin:16px 0;}.btn{display:inline-block;background:#16a34a;color:#fff;font-weight:800;font-size:.9rem;padding:14px 32px;border-radius:10px;text-decoration:none;letter-spacing:.03em;}.contact{text-align:center;font-size:.72rem;color:#6b5b8a;padding-top:12px;border-top:1px solid #e6dff5;}.contact a{color:#8B5BC7;font-weight:600;text-decoration:none;}.ftr{background:#190E2A;padding:16px 28px;text-align:center;font-size:.65rem;color:rgba(236,235,238,.4);}</style></head><body><div class="wrap"><div class="hdr"><div class="hdr-name">Validate Your Vision Moving</div></div><div class="hero"><div class="badge">&#10003; Arrived</div><h1>Your movers are here, ${firstName}!</h1><p>Your VYV crew has arrived. Tap the button below to sign them in and start your move clock.</p></div><div class="body"><div class="btn-wrap"><a href="${moveLink}" class="btn">Sign In My Movers</a></div><div class="contact">Questions? Text us at <a href="sms:+15403001414">(540) 300-1414</a></div></div><div class="ftr">Validate Your Vision Moving &middot; Fredericksburg, VA &middot; validateyourvision.com</div></div></body></html>`;
}

// ── TWILIO SMS ────────────────────────────────────────────────
function sendSMS(to, body) {
  const props = PropertiesService.getScriptProperties();
  const sid   = props.getProperty('TWILIO_SID');
  const token = props.getProperty('TWILIO_TOKEN');
  const from  = props.getProperty('TWILIO_FROM');
  if (!sid || !token || !from) return;
  try {
    UrlFetchApp.fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: 'post',
        headers: { Authorization: 'Basic ' + Utilities.base64Encode(sid + ':' + token) },
        payload: { To: to, From: from, Body: body },
        muteHttpExceptions: true
      }
    );
  } catch (err) {
    console.log('SMS error: ' + err.message);
  }
}

// ── STRIPE API ────────────────────────────────────────────────
function stripeRequest(method, path, params) {
  const sk = PropertiesService.getScriptProperties().getProperty('STRIPE_SK');
  const options = {
    method: method.toLowerCase(),
    headers: { Authorization: 'Bearer ' + sk },
    muteHttpExceptions: true
  };
  let url = 'https://api.stripe.com/v1' + path;
  if (method === 'POST') {
    options.payload     = params;
    options.contentType = 'application/x-www-form-urlencoded';
  } else if (params) {
    url += '?' + Object.entries(params).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
  }
  return JSON.parse(UrlFetchApp.fetch(url, options).getContentText());
}

// ── SHEET HELPERS ─────────────────────────────────────────────
function findBooking(id) {
  const ss   = getOrCreateSheet(BOOKINGS_SHEET, []);
  const data = ss.getDataRange().getValues();
  if (data.length < 2) return null;
  const headers = data[0];
  for (let i = 1; i < data.length; i++) {
    const obj = {};
    headers.forEach((h, j) => { obj[h] = data[i][j]; });
    if (obj['ID'] === id) return obj;
  }
  return null;
}

function findBookingByToken(id, moveToken) {
  const b = findBooking(id);
  return (b && b.MoveToken === moveToken) ? b : null;
}

function updateBookingField(id, field, value) {
  const ss      = getOrCreateSheet(BOOKINGS_SHEET, []);
  const data    = ss.getDataRange().getValues();
  if (data.length < 2) return false;
  const headers = data[0];
  const idCol   = headers.indexOf('ID');
  const fCol    = headers.indexOf(field);
  if (idCol < 0 || fCol < 0) return false;
  for (let i = 1; i < data.length; i++) {
    if (data[i][idCol] === id) {
      ss.getRange(i + 1, fCol + 1).setValue(value);
      return true;
    }
  }
  return false;
}

function generateToken() {
  return Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
      Math.random().toString() + Date.now())
  ).replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
}

function formatDuration(ms) {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} hr ${m} min` : `${m} min`;
}

function getOrCreateSheet(name, headers) {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers.length) sheet.appendRow(headers);
  }
  return sheet;
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
