// Automated email script — run by GitHub Actions on schedule
// Triggered at 9pm and 9:30pm Sydney time (covers both AEST and AEDT)

import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

// ── ENV VALIDATION ──────────────────────────────────────────
const { SUPABASE_URL, SUPABASE_SERVICE_KEY, GMAIL_USER, GMAIL_APP_PASSWORD, CRON_SCHEDULE, MANUAL_TYPE } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !GMAIL_USER || !GMAIL_APP_PASSWORD) {
    console.error('Missing required environment variables (SUPABASE_URL, SUPABASE_SERVICE_KEY, GMAIL_USER, GMAIL_APP_PASSWORD)');
    process.exit(1);
}

const supabase  = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const transport = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
});

// ── CONFIG ──────────────────────────────────────────────────
const ANGELICA  = 'angelicasuesscun@icloud.com';
const OWNERS    = ['angussullivan@gmail.com', 'jenna4134@gmail.com'];
const EVERYONE  = ['angussullivan@gmail.com', 'jenna4134@gmail.com', 'angelicasuesscun@icloud.com'];
const WEEKLY_TARGET = 35;
const LOCS = {
    airbnb:   'Reservoir St Airbnb Rooms',
    laundry:  'Reservoir St Laundry',
    tamarama: 'Tamarama Home',
};
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// ── SYDNEY TIME ─────────────────────────────────────────────
// Get the current date/time in Sydney (handles AEST/AEDT automatically)
const sydneyNow  = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
const sydneyHour = sydneyNow.getHours();
const sydneyMin  = sydneyNow.getMinutes();
const todayStr   = sydneyNow.toISOString().slice(0, 10);
const dayOfWeek  = sydneyNow.getDay(); // 0=Sun
const isSunday   = dayOfWeek === 0;
const daysInThisMonth = new Date(sydneyNow.getFullYear(), sydneyNow.getMonth() + 1, 0).getDate();
const isLastDayOfMonth = sydneyNow.getDate() === daysInThisMonth;

// Determine which action to run
// The workflow fires at 10:00, 10:30, 11:00, 11:30 UTC to cover both AEST and AEDT.
// We use the actual Sydney time to decide what to do.
const is9pm   = MANUAL_TYPE === 'reminder' || (sydneyHour === 21 && sydneyMin < 30);
// Accept 9:30pm–10:59pm so a late-firing or backup cron still sends the summary.
const is930pm = ['daily','weekly','monthly'].includes(MANUAL_TYPE) ||
                (sydneyHour === 21 && sydneyMin >= 30) ||
                sydneyHour === 22;

console.log(`Sydney time: ${sydneyNow.toLocaleTimeString('en-AU')}, date: ${todayStr}`);
console.log(`isSunday: ${isSunday}, isLastDayOfMonth: ${isLastDayOfMonth}`);
console.log(`Action: ${is9pm ? '9pm-reminder-check' : is930pm ? '9:30pm-summaries' : 'none (wrong time, skipping)'}`);

if (!is9pm && !is930pm) {
    console.log('Not the right Sydney time — nothing to do.');
    process.exit(0);
}

// ── HELPERS ─────────────────────────────────────────────────
function fh(h) {
    if (h === 0) return '0';
    return Number.isInteger(h) ? `${h}` : parseFloat(h).toFixed(1);
}

function fmtDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return `${d} ${MONTH_NAMES[m - 1].slice(0, 3)}`;
}

function fmtDateFull(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    return `${days[date.getDay()]} ${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

function getWeekDates(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const day  = date.getDay();
    const off  = day === 0 ? -6 : 1 - day;
    return Array.from({ length: 7 }, (_, i) => {
        const dd = new Date(y, m - 1, d + off + i);
        return `${dd.getFullYear()}-${String(dd.getMonth()+1).padStart(2,'0')}-${String(dd.getDate()).padStart(2,'0')}`;
    });
}

function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }

// ── EMAIL TEMPLATE WRAPPER ───────────────────────────────────
function wrap(title, body) {
    return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f7f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:580px;margin:24px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.07)">
  <div style="background:linear-gradient(135deg,#1B4965,#2d6b8a);padding:22px 28px">
    <h2 style="margin:0;color:#fff;font-size:1.05rem;font-weight:700">${title}</h2>
    <p style="margin:4px 0 0;color:rgba(255,255,255,0.6);font-size:0.8rem">Hours Tracker · Reservoir St &amp; Tamarama</p>
  </div>
  <div style="padding:24px 28px">${body}</div>
  <div style="padding:14px 28px;background:#f9f9f9;border-top:1px solid #eee;font-size:0.72rem;color:#aaa;text-align:center">
    Sent automatically by Hours Tracker · <a href="https://www.reservoirlaundry.com.au/cleaner.html" style="color:#62B6CB">Open app</a>
  </div>
</div></body></html>`;
}

function statBox(label, value, sub, color='#1B4965') {
    return `<div style="flex:1;background:#f8f9fa;border-radius:10px;padding:14px;text-align:center">
        <div style="font-size:0.72rem;color:#888;margin-bottom:4px">${label}</div>
        <div style="font-size:1.6rem;font-weight:700;color:${color}">${value}</div>
        ${sub ? `<div style="font-size:0.72rem;color:#aaa;margin-top:2px">${sub}</div>` : ''}
    </div>`;
}

function pill(text, color) {
    return `<span style="background:${color};color:#fff;padding:6px 14px;border-radius:100px;font-size:0.8rem;font-weight:700;white-space:nowrap">${text}</span>`;
}

// ── EMAIL BUILDERS ───────────────────────────────────────────
function buildReminder() {
    return wrap('Reminder: Log today\'s hours', `
        <p style="color:#2C3E50">Hi Angelica,</p>
        <p style="color:#5D7285">It looks like no hours have been logged yet for today:</p>
        <p style="text-align:center;margin:20px 0">
            <strong style="font-size:1.1rem;color:#1B4965">${fmtDateFull(todayStr)}</strong>
        </p>
        <p style="text-align:center;margin:20px 0">
            <a href="https://www.reservoirlaundry.com.au/cleaner.html"
               style="display:inline-block;background:#1B4965;color:#fff;padding:13px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:0.95rem">
               Log Hours Now →
            </a>
        </p>
        <p style="color:#aaa;font-size:0.82rem">If you didn't work today, you can ignore this reminder.</p>
    `);
}

function buildDailySummary(entries) {
    const total = entries.reduce((a, e) => a + parseFloat(e.hours), 0);
    const date  = fmtDateFull(todayStr);

    let locRows = LOCS;
    let tableRows = '';
    Object.entries(LOCS).forEach(([id, name]) => {
        const h = entries.filter(e => e.location === id).reduce((a, e) => a + parseFloat(e.hours), 0);
        if (h > 0) {
            tableRows += `<tr>
                <td style="padding:9px 0;border-bottom:1px solid #f0f0f0;color:#2C3E50">${name}</td>
                <td style="padding:9px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:600;color:#1B4965">${fh(h)}h</td>
            </tr>`;
        }
    });

    const body = total === 0
        ? `<p style="color:#5D7285">No hours were logged today (${date}).</p>`
        : `<table style="width:100%;border-collapse:collapse;margin:16px 0">
            ${tableRows}
            <tr>
                <td style="padding:11px 0;font-weight:700;color:#1B4965">Total today</td>
                <td style="padding:11px 0;text-align:right;font-weight:700;font-size:1.15rem;color:#1B4965">${fh(total)}h</td>
            </tr>
           </table>`;

    return wrap(`Daily Summary — ${date}`, `<p style="color:#5D7285;margin-top:0">${date}</p>${body}`);
}

function buildWeeklySummary(entries, weekDates) {
    const total = entries.reduce((a, e) => a + parseFloat(e.hours), 0);
    const delta = total - WEEKLY_TARGET;
    const deltaColor = delta >= 0 ? '#27AE60' : Math.abs(delta) <= 3 ? '#E67E22' : '#E74C3C';
    const deltaText  = delta >= 0 ? `+${fh(delta)}h over` : `${fh(Math.abs(delta))}h under`;

    const dayNames = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    let dayRows = '';
    weekDates.forEach((ds, i) => {
        const de    = entries.filter(e => e.date === ds);
        const dt    = de.reduce((a, e) => a + parseFloat(e.hours), 0);
        const color = dt > 0 ? '#2C3E50' : '#ccc';
        dayRows += `<tr>
            <td style="padding:7px 0;border-bottom:1px solid #f5f5f5;color:${color};font-size:0.9rem">${dayNames[i]}, ${fmtDate(ds)}</td>
            <td style="padding:7px 0;border-bottom:1px solid #f5f5f5;text-align:right;font-weight:${dt > 0 ? 600 : 400};color:${color};font-size:0.9rem">${dt > 0 ? fh(dt) + 'h' : '—'}</td>
        </tr>`;
    });

    let locRows = '';
    Object.entries(LOCS).forEach(([id, name]) => {
        const h = entries.filter(e => e.location === id).reduce((a, e) => a + parseFloat(e.hours), 0);
        if (h > 0) locRows += `<tr>
            <td style="padding:6px 0;border-bottom:1px solid #f5f5f5;color:#5D7285;font-size:0.85rem">${name}</td>
            <td style="padding:6px 0;border-bottom:1px solid #f5f5f5;text-align:right;color:#5D7285;font-size:0.85rem">${fh(h)}h</td>
        </tr>`;
    });

    return wrap(`Weekly Summary — ${fmtDate(weekDates[0])}–${fmtDate(weekDates[6])} ${sydneyNow.getFullYear()}`, `
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px">${dayRows}</table>
        ${locRows ? `<table style="width:100%;border-collapse:collapse;margin-bottom:20px">
            <tr><td colspan="2" style="padding:8px 0 4px;font-size:0.7rem;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#aaa">By Location</td></tr>
            ${locRows}
        </table>` : ''}
        <div style="display:flex;gap:10px;align-items:center;background:#f8f9fa;border-radius:10px;padding:14px">
            <div style="flex:1">
                <div style="font-size:0.72rem;color:#888">Weekly total</div>
                <div style="font-size:1.7rem;font-weight:700;color:#1B4965">${fh(total)}h</div>
                <div style="font-size:0.75rem;color:#aaa">target ${WEEKLY_TARGET}h</div>
            </div>
            ${pill(deltaText, deltaColor)}
        </div>
    `);
}

function buildMonthlySummary(entries, year, month) {
    const total   = entries.reduce((a, e) => a + parseFloat(e.hours), 0);
    const mDays   = daysInMonth(year, month);
    const target  = Math.round(WEEKLY_TARGET * mDays / 7 * 10) / 10;
    const delta   = total - target;
    const deltaColor = delta >= 0 ? '#27AE60' : Math.abs(delta) <= 5 ? '#E67E22' : '#E74C3C';
    const deltaText  = delta >= 0 ? `+${fh(delta)}h over` : `${fh(Math.abs(delta))}h under`;

    // Week rows
    let weekRows = '';
    let wd = new Date(year, month, 1);
    const firstDay = wd.getDay();
    wd.setDate(wd.getDate() - (firstDay === 0 ? 6 : firstDay - 1));
    let wkNum = 1;
    while (wd.getMonth() <= month && wd.getFullYear() === year || wd.getFullYear() < year) {
        if (wd.getFullYear() > year || (wd.getFullYear() === year && wd.getMonth() > month)) break;
        const wDates = Array.from({ length: 7 }, (_, i) => {
            const dd = new Date(wd); dd.setDate(dd.getDate() + i);
            return `${dd.getFullYear()}-${String(dd.getMonth()+1).padStart(2,'0')}-${String(dd.getDate()).padStart(2,'0')}`;
        });
        const wTotal = entries.filter(e => wDates.includes(e.date)).reduce((a, e) => a + parseFloat(e.hours), 0);
        const wColor = wTotal >= WEEKLY_TARGET ? '#27AE60' : wTotal >= WEEKLY_TARGET * 0.8 ? '#E67E22' : '#E74C3C';
        weekRows += `<tr>
            <td style="padding:7px 0;border-bottom:1px solid #f5f5f5;font-size:0.88rem;color:#2C3E50">Week ${wkNum} (${fmtDate(wDates[0])}–${fmtDate(wDates[6])})</td>
            <td style="padding:7px 0;border-bottom:1px solid #f5f5f5;text-align:right;font-weight:600;color:${wColor};font-size:0.88rem">${fh(wTotal)}h</td>
        </tr>`;
        wd.setDate(wd.getDate() + 7);
        wkNum++;
    }

    // Location rows
    let locRows = '';
    Object.entries(LOCS).forEach(([id, name]) => {
        const h = entries.filter(e => e.location === id).reduce((a, e) => a + parseFloat(e.hours), 0);
        locRows += `<tr>
            <td style="padding:6px 0;border-bottom:1px solid #f5f5f5;color:#5D7285;font-size:0.85rem">${name}</td>
            <td style="padding:6px 0;border-bottom:1px solid #f5f5f5;text-align:right;color:#5D7285;font-size:0.85rem">${fh(h)}h</td>
        </tr>`;
    });

    return wrap(`Monthly Summary — ${MONTH_NAMES[month]} ${year}`, `
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
            <tr><td colspan="2" style="padding:8px 0 4px;font-size:0.7rem;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#aaa">Week by Week</td></tr>
            ${weekRows}
        </table>
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
            <tr><td colspan="2" style="padding:8px 0 4px;font-size:0.7rem;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#aaa">By Location</td></tr>
            ${locRows}
        </table>
        <div style="display:flex;gap:10px;align-items:center;background:#f8f9fa;border-radius:10px;padding:14px">
            <div style="flex:1">
                <div style="font-size:0.72rem;color:#888">Monthly total</div>
                <div style="font-size:1.7rem;font-weight:700;color:#1B4965">${fh(total)}h</div>
                <div style="font-size:0.75rem;color:#aaa">target ${fh(target)}h</div>
            </div>
            ${pill(deltaText, deltaColor)}
        </div>
    `);
}

// ── SEND HELPER ──────────────────────────────────────────────
async function send({ to, cc, subject, html }) {
    const info = await transport.sendMail({
        from: `"Hours Tracker" <${GMAIL_USER}>`,
        to: Array.isArray(to) ? to.join(', ') : to,
        ...(cc ? { cc: Array.isArray(cc) ? cc.join(', ') : cc } : {}),
        subject,
        html,
    });
    console.log(`  Sent "${subject}" → ${info.messageId}`);
}

// ── MAIN ─────────────────────────────────────────────────────
async function main() {
    // ── 9pm: reminder if no entries today ───────────────────
    if (is9pm) {
        const { data: todayEntries, error } = await supabase
            .from('hours_entries')
            .select('id')
            .eq('date', todayStr);
        if (error) throw error;

        if (todayEntries.length === 0) {
            console.log('No entries today — sending reminder to Angelica');
            await send({
                to: ANGELICA,
                cc: OWNERS,
                subject: `Reminder: log today's hours (${fmtDateFull(todayStr)})`,
                html: buildReminder(),
            });
        } else {
            console.log(`${todayEntries.length} entries found today — no reminder needed`);
        }
    }

    // ── 9:30pm: daily summary ────────────────────────────────
    if (is930pm) {
        const { data: todayEntries, error: e1 } = await supabase
            .from('hours_entries')
            .select('*')
            .eq('date', todayStr);
        if (e1) throw e1;

        console.log(`Sending daily summary (${todayEntries.length} entries)`);
        await send({
            to: EVERYONE,
            subject: `Daily hours summary — ${fmtDateFull(todayStr)}`,
            html: buildDailySummary(todayEntries),
        });

        // ── Sunday: weekly summary ───────────────────────────
        if (isSunday || MANUAL_TYPE === 'weekly') {
            const weekDates = getWeekDates(todayStr);
            const { data: weekEntries, error: e2 } = await supabase
                .from('hours_entries')
                .select('*')
                .in('date', weekDates);
            if (e2) throw e2;

            console.log(`Sending weekly summary (${weekEntries.length} entries)`);
            await send({
                to: EVERYONE,
                subject: `Weekly hours summary — ${fmtDate(weekDates[0])}–${fmtDate(weekDates[6])} ${sydneyNow.getFullYear()}`,
                html: buildWeeklySummary(weekEntries, weekDates),
            });
        }

        // ── Last day of month: monthly summary ───────────────
        if (isLastDayOfMonth || MANUAL_TYPE === 'monthly') {
            const y = sydneyNow.getFullYear();
            const m = sydneyNow.getMonth();
            const prefix = `${y}-${String(m + 1).padStart(2, '0')}-`;
            const { data: monthEntries, error: e3 } = await supabase
                .from('hours_entries')
                .select('*')
                .like('date', `${prefix}%`);
            if (e3) throw e3;

            console.log(`Sending monthly summary (${monthEntries.length} entries)`);
            await send({
                to: EVERYONE,
                subject: `Monthly hours summary — ${MONTH_NAMES[m]} ${y}`,
                html: buildMonthlySummary(monthEntries, y, m),
            });
        }

        console.log('All done.');
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
