// Fetches Airbnb iCal feeds for all 3 rooms and upserts upcoming bookings into Supabase.
// Run daily via GitHub Actions.

import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
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

function parseDate(s) {
    // s is YYYYMMDD
    return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
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
        uid:     e.uid,
        summary: e.summary || '',
        checkin:  parseDate(e.dtstart),
        checkout: parseDate(e.dtend),
    }));
}

async function main() {
    const todayStr = new Date().toISOString().slice(0, 10);
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
                id:       `${room.name.replace(' ','').toLowerCase()}-${e.uid}`,
                room:     room.name,
                checkin:  e.checkin,
                checkout: e.checkout,
                summary:  e.summary,
                fetched_at: new Date().toISOString(),
            });
        }
    }

    // Remove stale past bookings
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
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
