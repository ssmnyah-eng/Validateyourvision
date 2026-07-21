// ─────────────────────────────────────────────────────────────
//  VYV Moving — Google Apps Script Backend
//  Paste this entire file into script.google.com
//  Then: Deploy → New deployment → Web app → Anyone → Deploy
// ─────────────────────────────────────────────────────────────

// ── CONFIG — fill these in before deploying ──────────────────
const ADMIN_TOKEN      = 'vyv2026admin';        // must match book.html + admin.html
const NOTIFY_EMAIL     = 'hello@validateyourvision.com'; // your email for new booking alerts
const CALENDAR_ID      = 'primary';             // 'primary' uses your main Google Calendar
const BOOKINGS_SHEET   = 'Bookings';
const LEADS_SHEET      = 'Leads';
// ─────────────────────────────────────────────────────────────

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    if (data.token !== ADMIN_TOKEN) {
      return json({ ok: false, error: 'Unauthorized' });
    }

    if (data.action === 'save')          return json(saveBooking(data));
    if (data.action === 'save_lead')     return json(saveLead(data));
    if (data.action === 'update_status') return json(updateStatus(data));

    return json({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return json({ ok: false, error: err.message });
  }
}

function doGet(e) {
  try {
    const token = e.parameter.token;
    if (token !== ADMIN_TOKEN) return json({ ok: false, error: 'Unauthorized' });

    const action = e.parameter.action || 'get_bookings';
    if (action === 'get_bookings') return json(getBookings());
    if (action === 'get_leads')    return json(getLeads());

    return json({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return json({ ok: false, error: err.message });
  }
}

// ── SAVE BOOKING ─────────────────────────────────────────────
function saveBooking(d) {
  const ss    = getOrCreateSheet(BOOKINGS_SHEET, [
    'ID','Booked At','Name','Email','Phone',
    'Move Date','Time','Crew','Rate','Truck Fee',
    'Moving From','Moving To','Stops',
    'Property Details','Volume','Specialty','Packing',
    'Deposit','Payment Method','Notes','Status'
  ]);

  const id = 'VYV-' + Date.now();
  const row = [
    id,
    d.bookedAt || new Date().toISOString(),
    d.name, d.email, d.phone,
    d.moveDate, d.time || '',
    d.crew, d.rate, d.truckFee || '',
    d.from, d.to, d.stops || 1,
    d.propertyDetails || '',
    d.volume || '', d.specialty || '', d.packing || 'No',
    d.deposit || '', d.paymentMethod || '',
    d.notes || '', 'Upcoming'
  ];

  ss.appendRow(row);

  // Send confirmation email to customer
  sendConfirmationEmail(d, id);

  // Send alert email to owner
  sendOwnerAlert(d, id);

  // Add to Google Calendar
  createCalendarEvent(d, id);

  return { ok: true, id };
}

// ── SAVE LEAD ────────────────────────────────────────────────
function saveLead(d) {
  const ss = getOrCreateSheet(LEADS_SHEET, [
    'Captured At','Name','Email','Phone','Moving From','Moving To','Source'
  ]);

  ss.appendRow([
    d.capturedAt || new Date().toISOString(),
    d.name || '', d.email || '', d.phone || '',
    d.from || '', d.to || '',
    d.source || 'Booking Form'
  ]);

  return { ok: true };
}

// ── UPDATE STATUS ─────────────────────────────────────────────
function updateStatus(d) {
  const ss   = getOrCreateSheet(BOOKINGS_SHEET, []);
  const data = ss.getDataRange().getValues();
  const headers = data[0];
  const idCol     = headers.indexOf('ID');
  const statusCol = headers.indexOf('Status');

  for (let i = 1; i < data.length; i++) {
    if (data[i][idCol] === d.id) {
      ss.getRange(i + 1, statusCol + 1).setValue(d.status);
      return { ok: true };
    }
  }
  return { ok: false, error: 'Booking not found' };
}

// ── GET BOOKINGS ──────────────────────────────────────────────
function getBookings() {
  const ss   = getOrCreateSheet(BOOKINGS_SHEET, []);
  const data = ss.getDataRange().getValues();
  if (data.length < 2) return { ok: true, bookings: [] };

  const headers = data[0];
  const bookings = data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });

  return { ok: true, bookings };
}

// ── GET LEADS ─────────────────────────────────────────────────
function getLeads() {
  const ss   = getOrCreateSheet(LEADS_SHEET, []);
  const data = ss.getDataRange().getValues();
  if (data.length < 2) return { ok: true, leads: [] };

  const headers = data[0];
  const leads = data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });

  return { ok: true, leads };
}

// ── CONFIRMATION EMAIL TO CUSTOMER ────────────────────────────
function sendConfirmationEmail(d, id) {
  if (!d.email) return;

  const firstName = (d.name || '').split(' ')[0] || 'there';
  const subject   = `You're booked, ${firstName}! — VYV Moving`;

  const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  body{margin:0;padding:24px 16px;background:#f0ecf8;font-family:'Helvetica Neue',Arial,sans-serif;}
  .wrap{max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(25,14,42,0.10);}
  .hdr{background:#190E2A;padding:20px 28px;display:flex;align-items:center;gap:10px;}
  .hdr-name{font-size:0.85rem;font-weight:800;color:#ECEBEE;letter-spacing:0.02em;}
  .hdr-sub{font-size:0.65rem;color:#8B5BC7;margin-top:1px;}
  .hero{background:#fff;border-bottom:1px solid #e6dff5;padding:24px 28px 20px;text-align:center;}
  .badge{display:inline-block;background:#d4eddf;border:1px solid #9dd0b4;border-radius:50px;padding:3px 12px;font-size:0.62rem;font-weight:700;color:#166534;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:10px;}
  .hero h1{font-size:1.35rem;font-weight:800;color:#190E2A;margin:0 0 6px;line-height:1.25;}
  .hero h1 span{color:#4A237A;}
  .hero p{font-size:0.8rem;color:#6b5b8a;line-height:1.6;margin:0;}
  .body{padding:20px 28px 28px;}
  .callout{background:#d4eddf;border:1px solid #9dd0b4;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:0.78rem;color:#166534;line-height:1.55;}
  .callout strong{display:block;font-size:0.68rem;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:3px;}
  /* Journey tracker */
  .journey{background:#faf8ff;border:1px solid #e6dff5;border-radius:10px;padding:16px;margin-bottom:14px;}
  .j-label{font-size:0.62rem;font-weight:700;color:#8B5BC7;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px;}
  .j-title{font-size:0.85rem;font-weight:700;color:#190E2A;margin-bottom:12px;}
  .truck-row{text-align:center;margin-bottom:6px;font-size:1.6rem;animation:none;}
  .track{height:5px;background:#e6dff5;border-radius:3px;margin-bottom:8px;position:relative;}
  .track-fill{height:100%;width:10%;background:#16a34a;border-radius:3px;}
  .steps-row{display:flex;justify-content:space-between;text-align:center;}
  .s-col{flex:1;display:flex;flex-direction:column;align-items:center;gap:5px;}
  .s-dot{width:22px;height:22px;border-radius:50%;border:2px solid #d4c9e8;background:#fff;font-size:0.6rem;font-weight:700;color:#a892cc;display:flex;align-items:center;justify-content:center;margin:0 auto;}
  .s-dot.active{background:#16a34a;border-color:#16a34a;color:#fff;}
  .s-lbl{font-size:0.58rem;color:#a892cc;line-height:1.3;max-width:60px;}
  .s-lbl.active{color:#16a34a;font-weight:700;}
  /* Steps card */
  .steps-card{border:1px solid #e6dff5;border-radius:10px;overflow:hidden;margin-bottom:14px;}
  .sc-hdr{background:#190E2A;padding:12px 16px;}
  .sc-lbl{font-size:0.6rem;font-weight:700;color:#8B5BC7;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:2px;}
  .sc-hdr h3{font-size:0.82rem;font-weight:700;color:#ECEBEE;margin:0;}
  .si{display:flex;gap:10px;align-items:flex-start;padding:10px 14px;border-bottom:1px solid #e6dff5;background:#fff;}
  .si:last-child{border-bottom:none;}
  .si-num{width:22px;height:22px;min-width:22px;border-radius:50%;background:#4A237A;color:#fff;font-size:0.62rem;font-weight:800;display:flex;align-items:center;justify-content:center;margin-top:1px;}
  .si-num.cur{background:#16a34a;}
  .si-content strong{display:block;font-size:0.78rem;font-weight:700;color:#190E2A;margin-bottom:1px;}
  .si-content span{font-size:0.72rem;color:#6b5b8a;line-height:1.5;}
  .here{display:inline-block;background:#d4eddf;color:#166534;font-size:0.55rem;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;padding:1px 6px;border-radius:50px;margin-left:4px;vertical-align:middle;}
  /* Notice */
  .notice{background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:10px 14px;margin-bottom:14px;display:flex;gap:8px;align-items:flex-start;}
  .notice strong{display:block;font-size:0.68rem;font-weight:700;color:#0c4a6e;margin-bottom:2px;}
  .notice p{font-size:0.72rem;color:#0369a1;line-height:1.5;margin:0;}
  /* Buttons */
  .btns{display:flex;gap:8px;margin-bottom:14px;}
  .btn{flex:1;display:block;text-align:center;padding:10px 12px;border-radius:7px;font-size:0.72rem;font-weight:700;letter-spacing:0.04em;text-decoration:none;text-transform:uppercase;}
  .btn-rs{color:#4A237A;border:2px solid #4A237A;}
  .btn-cn{color:#dc2626;border:2px solid #fca5a5;}
  /* Tips */
  .tips{background:#faf8ff;border:1px solid #e6dff5;border-radius:8px;padding:12px 14px;margin-bottom:14px;}
  .tips-title{font-size:0.7rem;font-weight:700;color:#190E2A;margin-bottom:8px;}
  .tip{display:flex;gap:7px;font-size:0.72rem;color:#6b5b8a;line-height:1.5;margin-bottom:6px;}
  .tip:last-child{margin-bottom:0;}
  .tip-ck{color:#8B5BC7;font-weight:700;flex-shrink:0;}
  .tip strong{color:#190E2A;}
  .contact{text-align:center;font-size:0.72rem;color:#6b5b8a;padding-top:12px;border-top:1px solid #e6dff5;}
  .contact a{color:#8B5BC7;font-weight:600;text-decoration:none;}
  .ftr{background:#190E2A;padding:18px 28px;text-align:center;}
  .ftr-name{font-size:0.8rem;font-weight:800;color:#ECEBEE;}
  .ftr-sub{font-size:0.62rem;color:#8B5BC7;margin-top:2px;}
  .ftr p{font-size:0.65rem;color:rgba(236,235,238,0.4);line-height:1.8;margin-top:10px;}
  .ftr a{color:rgba(139,91,199,0.8);text-decoration:none;}
</style>
</head>
<body>
<div class="wrap">

  <div class="hdr">
    <div>
      <div class="hdr-name">Validate Your Vision Moving</div>
      <div class="hdr-sub">Fredericksburg, VA &middot; Licensed &amp; Insured</div>
    </div>
  </div>

  <div class="hero">
    <div class="badge">&#9679; Move Confirmed</div>
    <h1>Congrats, <span>${firstName}.</span><br>You're officially booked.</h1>
    <p>Your crew is reserved and your date is locked in. We can't wait to make this the smoothest move you've ever had.</p>
  </div>

  <div class="body">

    <div class="callout">
      <strong>&#10003; Deposit received &amp; applied to your balance</strong>
      Your deposit is not an extra fee. It comes straight off your total on move day. The remaining balance is due when the job is complete.
    </div>

    <div class="journey">
      <div class="j-label">Your move journey</div>
      <div class="j-title">Here's where you stand</div>
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
      <div class="sc-hdr">
        <div class="sc-lbl">What happens next</div>
        <h3>Your roadmap to moving day</h3>
      </div>
      <div class="si">
        <div class="si-num cur">&#10003;</div>
        <div class="si-content">
          <strong>You're booked <span class="here">You are here</span></strong>
          <span>Deposit received, date locked in. You'll get a text from us the day before to confirm.</span>
        </div>
      </div>
      <div class="si">
        <div class="si-num">2</div>
        <div class="si-content">
          <strong>Pack early</strong>
          <span>Start with non-essentials. Label every box with the room name. The more ready you are, the faster your crew moves.</span>
        </div>
      </div>
      <div class="si">
        <div class="si-num">3</div>
        <div class="si-content">
          <strong>We text + email you when we're on the way</strong>
          <span>You'll get a heads-up before your crew leaves. No need to track anything — we come to you.</span>
        </div>
      </div>
      <div class="si">
        <div class="si-num">4</div>
        <div class="si-content">
          <strong>Moving day</strong>
          <span>Your crew arrives in uniform with a clear plan. Your price does not change.</span>
        </div>
      </div>
      <div class="si" style="border-bottom:none;">
        <div class="si-num">5</div>
        <div class="si-content">
          <strong>Done — balance charged automatically</strong>
          <span>When the job is complete, the remaining balance is charged to your card on file. No chasing invoices.</span>
        </div>
      </div>
    </div>

    <div class="notice">
      <div style="font-size:1rem;">&#128241;</div>
      <div>
        <strong>We'll reach out before your movers leave</strong>
        <p>You'll receive both a text and an email when your crew is on the way. We'll have you covered.</p>
      </div>
    </div>

    <div class="btns">
      <a href="sms:+15403001414?body=Hi, I need to reschedule. Booking: ${firstName} ${(d.name||'').split(' ').slice(1).join(' ')}" class="btn btn-rs">Reschedule</a>
      <a href="sms:+15403001414?body=Hi, I need to cancel. Booking: ${firstName} ${(d.name||'').split(' ').slice(1).join(' ')}" class="btn btn-cn">Cancel Booking</a>
    </div>

    <div class="tips">
      <div class="tips-title">Before moving day</div>
      <div class="tip"><span class="tip-ck">&#10003;</span><span><strong>Start boxing non-essentials now.</strong> Books, decor, anything you won't need this week. Label every box with the room name.</span></div>
      <div class="tip"><span class="tip-ck">&#10003;</span><span><strong>Defrost the freezer 24 hours ahead.</strong> We can't move a leaking appliance.</span></div>
      <div class="tip"><span class="tip-ck">&#10003;</span><span><strong>Reserve parking at both locations.</strong> Arrange truck-sized spots in advance — parking delays come out of your time.</span></div>
      <div class="tip"><span class="tip-ck">&#10003;</span><span><strong>Pack a moving day bag.</strong> Charger, meds, snacks, change of clothes. Keep it with you, not on the truck.</span></div>
    </div>

    <div class="contact">
      Questions? Text us anytime at <a href="sms:+15403001414">(540) 300-1414</a><br>
      <span style="font-size:0.68rem;color:#b0a0cc;">Changes? Text us at least 24 hours before your move at no charge.</span>
    </div>

  </div>

  <div class="ftr">
    <div class="ftr-name">Validate Your Vision Moving</div>
    <div class="ftr-sub">Fredericksburg, VA &middot; Licensed &amp; Insured &middot; Locally Owned</div>
    <p>
      You received this because you booked a move with VYV.<br>
      <a href="https://validateyourvision.com/policy.html">Cancellation &amp; Refund Policy</a> &middot;
      <a href="https://validateyourvision.com">validateyourvision.com</a>
    </p>
  </div>

</div>
</body>
</html>`;

  GmailApp.sendEmail(d.email, subject, '', { htmlBody: html, name: 'VYV Moving' });
}

// ── OWNER ALERT EMAIL ─────────────────────────────────────────
function sendOwnerAlert(d, id) {
  const subject = `New Booking: ${d.name} — ${d.moveDate}`;
  const body = `New VYV booking received!\n\nID: ${id}\nName: ${d.name}\nEmail: ${d.email}\nPhone: ${d.phone}\nMove Date: ${d.moveDate}\nCrew: ${d.crew}\nFrom: ${d.from}\nTo: ${d.to}\nDeposit: ${d.deposit}\nPacking: ${d.packing || 'No'}\nNotes: ${d.notes || 'None'}\n\nView your dashboard: https://validateyourvision.com/admin.html`;
  GmailApp.sendEmail(NOTIFY_EMAIL, subject, body, { name: 'VYV Booking System' });
}

// ── GOOGLE CALENDAR EVENT ─────────────────────────────────────
function createCalendarEvent(d, id) {
  try {
    const cal = CalendarApp.getCalendarById(CALENDAR_ID) || CalendarApp.getDefaultCalendar();

    // Parse date — expects "Monday, January 1, 2026 AM" or similar
    const dateStr = d.moveDate ? d.moveDate.replace(/(AM|PM).*/, '').trim() : '';
    const isAM    = d.moveDate && d.moveDate.includes('AM');
    const date    = dateStr ? new Date(dateStr) : new Date();

    const start = new Date(date);
    start.setHours(isAM ? 7 : 12, 0, 0, 0);
    const end = new Date(start);
    end.setHours(start.getHours() + 4); // placeholder 4-hour block

    const title = `VYV Move: ${d.name} (${d.crew})`;
    const desc  = [
      `Booking ID: ${id}`,
      `Customer: ${d.name}`,
      `Phone: ${d.phone}`,
      `Email: ${d.email}`,
      `From: ${d.from}`,
      `To: ${d.to}`,
      `Crew: ${d.crew} @ ${d.rate}`,
      `Truck Fee: ${d.truckFee || 'TBD'}`,
      `Deposit Paid: ${d.deposit}`,
      `Packing: ${d.packing || 'No'}`,
      `Notes: ${d.notes || 'None'}`,
    ].join('\n');

    cal.createEvent(title, start, end, { description: desc });
  } catch (err) {
    // Calendar errors don't block the booking save
    console.log('Calendar error: ' + err.message);
  }
}

// ── HELPERS ───────────────────────────────────────────────────
function getOrCreateSheet(name, headers) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  let sheet   = ss.getSheetByName(name);
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
