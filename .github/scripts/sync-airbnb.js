// Fetches Airbnb iCal feeds for all 3 rooms and upserts upcoming bookings into Supabase.
// If any booking with a check-in within the next 24h has changed, sends an alert email.

import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, GMAIL_USER, GMAIL_APP_PASSWORD } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const ROOMS = [
    { name: 'Room 1', url: 'https://www.airbnb.com.au/calendar/ical/1177127470457652236.ics?t=169fabe1ed394fadabf32cc7158ba9cd' },
    { name: 'Room 2', url: 'https://www.airbnb.com.au/calendar/ical/1177134716734273232.ics?t=403a1651aa024eb0b1e173c95970f533' },
    { name: 'Room 3', url: 'https://www.airbnb.com.au/calendar/ical/1177136108707135736.ics?t=b47454515ace4873b3ee27c1adfc185f' },
];

const EVERYONE = ['angussullivan@gmail.com', 'jenna4134@gmail.com', 'angelicasuesscun@icloud.com'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function buildMaintenanceAlertEmail(issues) {
    const LOCS_MAP = { airbnb: 'Reservoir St Airbnb Rooms', laundry: 'Reservoir St Laundry', tamarama: 'Tamarama Home' };
    const rows = issues.map(issue => {
        const locName  = LOCS_MAP[issue.location] || issue.location;
        const urgent   = issue.priority === 'urgent';
        const reported = new Date(issue.created_at).toLocaleString('en-AU', {
            timeZone: 'Australia/Sydney', dateStyle: 'medium', timeStyle: 'short'
        });
        return `<tr><td style="padding:12px 0;border-bottom:1px solid #f5f5f5">
            <div style="margin-bottom:5px">
                ${urgent
                    ? `<span style="background:#E74C3C;color:#fff;padding:2px 8px;border-radius:100px;font-size:0.72rem;font-weight:700">URGENT</span>`
                    : `<span style="background:#f0f0f0;color:#666;padding:2px 8px;border-radius:100px;font-size:0.72rem;font-weight:700">Normal</span>`}
                <span style="font-size:0.8rem;color:#888;margin-left:6px">${escHtml(locName)}</span>
            </div>
            <div style="font-size:0.92rem;color:#2C3E50;line-height:1.45">${escHtml(issue.description)}</div>
            <div style="font-size:0.75rem;color:#aaa;margin-top:4px">${reported}</div>
        </td></tr>`;
    }).join('');
    const title = `Maintenance Issue${issues.length > 1 ? 's' : ''} Reported`;
    return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f7f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:580px;margin:24px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.07)">
  <div style="background:linear-gradient(135deg,#1B4965,#2d6b8a);padding:22px 28px">
    <h2 style="margin:0;color:#fff;font-size:1.05rem;font-weight:700">${title}</h2>
    <p style="margin:4px 0 0;color:rgba(255,255,255,0.6);font-size:0.8rem">Hours Tracker · Reservoir St &amp; Tamarama</p>
  </div>
  <div style="padding:24px 28px">
    <p style="color:#2C3E50;margin-bottom:16px">The following maintenance issue${issues.length > 1 ? 's have' : ' has'} been flagged:</p>
    <table style="width:100%;border-collapse:collapse">${rows}</table>
    <p style="text-align:center;margin-top:20px">
      <a href="https://www.reservoirlaundry.com.au/cleaner.html"
         style="display:inline-block;background:#1B4965;color:#fff;padding:13px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:0.95rem">Open App →</a>
    </p>
  </div>
  <div style="padding:14px 28px;background:#f9f9f9;border-top:1px solid #eee;font-size:0.72rem;color:#aaa;text-align:center">
    Sent automatically by Hours Tracker · <a href="https://www.reservoirlaundry.com.au/cleaner.html" style="color:#62B6CB">Open app</a>
  </div>
</div></body></html>`;
}

function parseDate(s) {
    return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
}

function fmtDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    return `${days[dt.getDay()]} ${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

function parseIcal(text) {
    const events = [];
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    let current = null;
    for (const raw of lines) {
        const line = raw.trimEnd();
        if (line === 'BEGIN:VEVENT') { current = {}; continue; }
        if (line === 'END:VEVENT') {
            if (current?.uid && current?.dtstart && current?.dtend) events.push(current);
            current = null; continue;
        }
        if (!current) continue;
        if (line.startsWith('UID:'))     current.uid     = line.slice(4).trim();
        if (line.startsWith('SUMMARY:')) current.summary = line.slice(8).trim();
        const dsm = line.match(/^DTSTART[^:]*:(\d{8})/);
        const dem = line.match(/^DTEND[^:]*:(\d{8})/);
        if (dsm) current.dtstart = dsm[1];
        if (dem) current.dtend   = dem[1];
    }
    return events.map(e => ({
        uid:      e.uid,
        summary:  e.summary || '',
        checkin:  parseDate(e.dtstart),
        checkout: parseDate(e.dtend),
    }));
}

function buildAlertEmail(changes, todayStr, tomorrowStr) {
    const rows = changes.map(c => {
        const b = c.booking;
        const when = b.checkin === todayStr ? 'Today' : 'Tomorrow';
        let badge, detail;
        if (c.type === 'new') {
            badge = `<span style="background:#27AE60;color:#fff;padding:3px 10px;border-radius:6px;font-size:0.75rem;font-weight:700">NEW BOOKING</span>`;
            detail = `Check-in ${when} (${fmtDate(b.checkin)}) · Check-out ${fmtDate(b.checkout)}`;
        } else if (c.type === 'cancelled') {
            badge = `<span style="background:#E05C5C;color:#fff;padding:3px 10px;border-radius:6px;font-size:0.75rem;font-weight:700">CANCELLED</span>`;
            detail = `Was checking in ${when} (${fmtDate(b.checkin)}) · Checking out ${fmtDate(b.checkout)}`;
        } else {
            badge = `<span style="background:#E67E22;color:#fff;padding:3px 10px;border-radius:6px;font-size:0.75rem;font-weight:700">CHANGED</span>`;
            detail = `Was ${fmtDate(c.previous.checkin)} → ${fmtDate(c.previous.checkout)}<br>Now ${fmtDate(b.checkin)} → ${fmtDate(b.checkout)}`;
        }
        return `<div style="background:#f8f9fa;border-radius:10px;padding:14px;margin-bottom:10px">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
                ${badge}
                <span style="font-weight:700;color:#1B4965;font-size:0.92rem">${b.room}</span>
            </div>
            <div style="font-size:0.85rem;color:#5D7285;line-height:1.5">${detail}</div>
        </div>`;
    }).join('');

    const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f7f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:580px;margin:24px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.07)">
  <div style="background:linear-gradient(135deg,#1B4965,#2d6b8a);padding:22px 28px">
    <h2 style="margin:0;color:#fff;font-size:1.05rem;font-weight:700">⚠️ Airbnb Calendar Change — Imminent Check-in</h2>
    <p style="margin:4px 0 0;color:rgba(255,255,255,0.6);font-size:0.8rem">Hours Tracker · Reservoir St &amp; Tamarama</p>
  </div>
  <div style="padding:24px 28px">
    <p style="color:#5D7285;margin-top:0">A booking has changed for a guest arriving within the next 24 hours:</p>
    ${rows}
    <p style="margin-top:16px;text-align:center">
        <a href="https://www.reservoirlaundry.com.au/cleaner.html"
           style="display:inline-block;background:#1B4965;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:700;font-size:0.9rem">
           View Schedule →
        </a>
    </p>
  </div>
  <div style="padding:14px 28px;background:#f9f9f9;border-top:1px solid #eee;font-size:0.72rem;color:#aaa;text-align:center">
    Sent automatically by Hours Tracker · <a href="https://www.reservoirlaundry.com.au/cleaner.html" style="color:#62B6CB">Open app</a>
  </div>
</div></body></html>`;

    return html;
}

async function main() {
    const sydneyNow  = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
    const todayStr   = `${sydneyNow.getFullYear()}-${String(sydneyNow.getMonth()+1).padStart(2,'0')}-${String(sydneyNow.getDate()).padStart(2,'0')}`;
    const tomorrow   = new Date(sydneyNow); tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth()+1).padStart(2,'0')}-${String(tomorrow.getDate()).padStart(2,'0')}`;

    // Fetch existing bookings from Supabase for change detection
    const { data: existing } = await supabase
        .from('airbnb_bookings')
        .select('*')
        .gte('checkout', todayStr);
    const existingMap = new Map((existing || []).map(b => [b.id, b]));

    // Fetch fresh iCal data
    const allBookings = [];
    for (const room of ROOMS) {
        console.log(`Fetching ${room.name}...`);
        const res = await fetch(room.url);
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${room.name}`);
        const text = await res.text();
        const events = parseIcal(text);
        const upcoming = events.filter(e => e.checkout >= todayStr);
        console.log(`  ${upcoming.length} upcoming events`);
        for (const e of upcoming) {
            allBookings.push({
                id:         `${room.name.replaceAll(' ','').toLowerCase()}-${e.uid}`,
                room:       room.name,
                checkin:    e.checkin,
                checkout:   e.checkout,
                summary:    e.summary,
                fetched_at: new Date().toISOString(),
            });
        }
    }
    const newMap = new Map(allBookings.map(b => [b.id, b]));

    // Detect changes for bookings with check-in within 24h (today or tomorrow)
    const changes = [];
    for (const [id, b] of newMap) {
        if (b.checkin !== todayStr && b.checkin !== tomorrowStr) continue;
        const prev = existingMap.get(id);
        if (!prev) {
            changes.push({ type: 'new', booking: b });
        } else if (prev.checkin !== b.checkin || prev.checkout !== b.checkout) {
            changes.push({ type: 'modified', booking: b, previous: prev });
        }
    }
    for (const [id, b] of existingMap) {
        if (b.checkin !== todayStr && b.checkin !== tomorrowStr) continue;
        if (!newMap.has(id)) {
            changes.push({ type: 'cancelled', booking: b });
        }
    }

    if (changes.length > 0) {
        console.log(`${changes.length} change(s) detected for imminent check-ins — sending alert`);
        if (GMAIL_USER && GMAIL_APP_PASSWORD) {
            const transport = nodemailer.createTransport({
                host: 'smtp.gmail.com', port: 587, secure: false,
                auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
            });
            await transport.sendMail({
                from:    `"Hours Tracker" <${GMAIL_USER}>`,
                to:      EVERYONE.join(', '),
                subject: `⚠️ Airbnb calendar change — guest arriving within 24h`,
                html:    buildAlertEmail(changes, todayStr, tomorrowStr),
            });
            console.log('  Alert email sent');
        } else {
            console.warn('  GMAIL credentials not set — skipping email');
        }
    } else {
        console.log('No changes to imminent bookings');
    }

    // Remove stale past bookings and upsert fresh data
    const { error: delErr } = await supabase
        .from('airbnb_bookings')
        .delete()
        .lt('checkout', todayStr);
    if (delErr) console.warn('Delete old:', delErr.message);

    if (allBookings.length > 0) {
        const { error } = await supabase
            .from('airbnb_bookings')
            .upsert(allBookings, { onConflict: 'id' });
        if (error) throw new Error(`Upsert failed: ${error.message}`);
    }

    console.log(`Done — ${allBookings.length} bookings synced`);

    // Check for unnotified maintenance issues and send alert email
    if (GMAIL_USER && GMAIL_APP_PASSWORD) {
        const transport2 = nodemailer.createTransport({
            host: 'smtp.gmail.com', port: 587, secure: false,
            auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
        });

        const { data: newIssues } = await supabase
            .from('maintenance_issues')
            .select('*')
            .eq('notified', false)
            .eq('resolved', false);

        if (newIssues && newIssues.length > 0) {
            console.log(`Sending maintenance alert for ${newIssues.length} unnotified issue(s)`);
            await transport2.sendMail({
                from:    `"Hours Tracker" <${GMAIL_USER}>`,
                to:      EVERYONE.join(', '),
                subject: `Maintenance Issue${newIssues.length > 1 ? 's' : ''} Reported — ${newIssues.length} item${newIssues.length > 1 ? 's' : ''}`,
                html:    buildMaintenanceAlertEmail(newIssues),
            });
            await supabase.from('maintenance_issues')
                .update({ notified: true })
                .in('id', newIssues.map(i => i.id));
            console.log('  Maintenance alert sent and issues marked notified');
        }

    }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
