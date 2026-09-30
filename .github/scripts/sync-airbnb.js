// Fetches Airbnb iCal feeds for all 3 rooms and upserts upcoming bookings into Supabase.
// "Airbnb (Not available)" system/owner blocks are filtered out — only actual guest
// reservations (summary != "not available") are stored and shown in the app.
// If any reservation with a check-in within the next 24h has changed, sends an alert email.

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
    // Unfold RFC 5545 line continuations (line ending + whitespace = one logical line)
    const unfolded = text.replace(/\r\n[ \t]/g, '').replace(/\r[ \t]/g, '').replace(/\n[ \t]/g, '');
    const events = [];
    const lines  = unfolded.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    let current  = null;
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
        const when = b.checkin === todayStr ? 'TODAY' : 'TOMORROW';
        let badge, detail;
        if (c.type === 'new') {
            badge = `<span style="background:#27AE60;color:#fff;padding:3px 10px;border-radius:6px;font-size:0.75rem;font-weight:700">NEW BOOKING</span>`;
            detail = `Check-in ${when} (${fmtDate(b.checkin)}) · Check-out ${fmtDate(b.checkout)}`;
        } else if (c.type === 'cancelled') {
            badge = `<span style="background:#C0392B;color:#fff;padding:3px 10px;border-radius:6px;font-size:0.75rem;font-weight:700">CANCELLED</span>`;
            detail = `Was checking in ${when} (${fmtDate(b.checkin)}) · Checking out ${fmtDate(b.checkout)}`;
        } else {
            badge = `<span style="background:#E67E22;color:#fff;padding:3px 10px;border-radius:6px;font-size:0.75rem;font-weight:700">CHANGED</span>`;
            detail = `Was ${fmtDate(c.previous.checkin)} → ${fmtDate(c.previous.checkout)}<br>Now ${fmtDate(b.checkin)} → ${fmtDate(b.checkout)}`;
        }
        return `<div style="background:#fff5f5;border:1px solid #f5c6c6;border-radius:10px;padding:14px;margin-bottom:10px">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
                ${badge}
                <span style="font-weight:700;color:#C0392B;font-size:0.92rem">${b.room}</span>
            </div>
            <div style="font-size:0.85rem;color:#5D7285;line-height:1.5">${detail}</div>
        </div>`;
    }).join('');

    return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f7f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:580px;margin:24px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 16px rgba(192,57,43,0.25);border:2px solid #E74C3C">
  <div style="background:linear-gradient(135deg,#C0392B,#E74C3C);padding:22px 28px">
    <div style="display:inline-block;background:rgba(255,255,255,0.25);color:#fff;padding:4px 12px;border-radius:100px;font-size:0.72rem;font-weight:800;letter-spacing:0.6px;margin-bottom:8px">🚨 ACTION NEEDED</div>
    <h2 style="margin:0;color:#fff;font-size:1.15rem;font-weight:800">Airbnb Check-in Changed — Within 24 Hours</h2>
    <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:0.82rem">A guest arrival is changing very soon — please check now</p>
  </div>
  <div style="padding:24px 28px">
    <p style="color:#C0392B;font-weight:700;margin-top:0">A booking has changed for a guest arriving within the next 24 hours:</p>
    ${rows}
    <p style="margin-top:16px;text-align:center">
        <a href="https://angussullivan.github.io/cleaner-app/cleaner.html"
           style="display:inline-block;background:#C0392B;color:#fff;padding:13px 28px;border-radius:10px;text-decoration:none;font-weight:800;font-size:0.95rem">
           View Schedule Now →
        </a>
    </p>
  </div>
  <div style="padding:14px 28px;background:#f9f9f9;border-top:1px solid #eee;font-size:0.72rem;color:#aaa;text-align:center">
    Sent automatically by Hours Tracker · <a href="https://angussullivan.github.io/cleaner-app/cleaner.html" style="color:#62B6CB">Open app</a>
  </div>
</div></body></html>`;
}

async function main() {
    const sydneyNow   = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
    const todayStr    = `${sydneyNow.getFullYear()}-${String(sydneyNow.getMonth()+1).padStart(2,'0')}-${String(sydneyNow.getDate()).padStart(2,'0')}`;
    const tomorrow    = new Date(sydneyNow); tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth()+1).padStart(2,'0')}-${String(tomorrow.getDate()).padStart(2,'0')}`;

    // Fetch existing bookings from Supabase for change detection and stale cleanup
    const { data: existing } = await supabase
        .from('airbnb_bookings')
        .select('*')
        .gte('checkout', todayStr);
    const existingMap = new Map((existing || []).map(b => [b.id, b]));

    // Fetch fresh iCal data with per-room isolation — one failure won't abort the others
    const allBookings    = [];
    const successfulRooms = new Set();
    for (const room of ROOMS) {
        try {
            console.log(`Fetching ${room.name}...`);
            const controller = new AbortController();
            const fetchTimer = setTimeout(() => controller.abort(), 15000);
            let res;
            try {
                res = await fetch(room.url, { signal: controller.signal });
            } finally {
                clearTimeout(fetchTimer);
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const text   = await res.text();
            const events = parseIcal(text);
            // Filter out "Airbnb (Not available)" system/owner blocks — only store actual reservations
            const upcoming = events.filter(e =>
                e.checkout >= todayStr && !/not available/i.test(e.summary)
            );
            const filtered = events.filter(e => e.checkout >= todayStr).length - upcoming.length;
            console.log(`  ${upcoming.length} reservation(s)${filtered ? ` (${filtered} system block(s) filtered)` : ''}`);
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
            successfulRooms.add(room.name);
        } catch (err) {
            console.error(`  FAILED ${room.name}: ${err.message}`);
        }
    }

    if (successfulRooms.size === 0) {
        throw new Error('All room iCal fetches failed — aborting to preserve Supabase data');
    }
    if (successfulRooms.size < ROOMS.length) {
        const failed = ROOMS.map(r => r.name).filter(n => !successfulRooms.has(n));
        console.warn(`Partial fetch — skipping stale cleanup for failed rooms: ${failed.join(', ')}`);
    }

    const newMap = new Map(allBookings.map(b => [b.id, b]));

    // Log imminent events (check-in or check-out within 3 days) for observability
    const threeDaysOut = new Date(sydneyNow); threeDaysOut.setDate(threeDaysOut.getDate() + 3);
    const threeDaysStr = `${threeDaysOut.getFullYear()}-${String(threeDaysOut.getMonth()+1).padStart(2,'0')}-${String(threeDaysOut.getDate()).padStart(2,'0')}`;
    const imminent = allBookings.filter(b => b.checkin <= threeDaysStr || b.checkout <= threeDaysStr);
    if (imminent.length > 0) {
        console.log('Imminent events (next 3 days):');
        imminent.forEach(b => console.log(`  [${b.room}] checkin=${b.checkin} checkout=${b.checkout} summary="${b.summary?.slice(0,50)}"`));
    }

    // Detect changes for reservations with check-in within 24h (today or tomorrow)
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

    // Single transport reused for all emails this run
    const transport = (GMAIL_USER && GMAIL_APP_PASSWORD)
        ? nodemailer.createTransport({ host: 'smtp.gmail.com', port: 587, secure: false, auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } })
        : null;

    if (changes.length > 0) {
        console.log(`${changes.length} change(s) detected for imminent check-ins — sending alert`);
        if (transport) {
            const hasCancellation = changes.some(c => c.type === 'cancelled');
            const subject = hasCancellation
                ? `🚨 URGENT: Airbnb booking CANCELLED — guest was arriving within 24h`
                : `🚨 URGENT: Airbnb check-in changed — action needed within 24h`;
            await transport.sendMail({
                from:    `"Hours Tracker" <${GMAIL_USER}>`,
                to:      EVERYONE.join(', '),
                subject,
                html:    buildAlertEmail(changes, todayStr, tomorrowStr),
            });
            console.log('  Alert email sent');
        } else {
            console.warn('  GMAIL credentials not set — skipping email');
        }
    } else {
        console.log('No changes to imminent bookings');
    }

    // Remove past bookings (checkout before today)
    const { error: delErr } = await supabase
        .from('airbnb_bookings')
        .delete()
        .lt('checkout', todayStr);
    if (delErr) console.warn('Delete old:', delErr.message);

    // Remove cancelled/stale future bookings — only for rooms that were successfully fetched,
    // to avoid accidentally wiping valid data when a room's iCal was temporarily unreachable.
    // Batched in groups of 100 to stay within Supabase .in() limits.
    const staleIds = [...existingMap.values()]
        .filter(b => successfulRooms.has(b.room) && !newMap.has(b.id))
        .map(b => b.id);
    if (staleIds.length > 0) {
        for (let i = 0; i < staleIds.length; i += 100) {
            const chunk = staleIds.slice(i, i + 100);
            const { error } = await supabase.from('airbnb_bookings').delete().in('id', chunk);
            if (error) console.warn(`Delete stale (batch ${Math.floor(i/100)+1}):`, error.message);
        }
        console.log(`Deleted ${staleIds.length} stale/cancelled booking(s)`);
    }

    // Upsert fresh data
    if (allBookings.length > 0) {
        const { error } = await supabase
            .from('airbnb_bookings')
            .upsert(allBookings, { onConflict: 'id' });
        if (error) throw new Error(`Upsert failed: ${error.message}`);
    }

    console.log(`Done — ${allBookings.length} booking(s) synced across ${successfulRooms.size}/${ROOMS.length} room(s)`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
