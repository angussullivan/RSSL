// Syncs manually-added cleaning blocks from Supabase to Google Calendar.
// Blocks auto-generated for Airbnb checkout days (id ending in '-auto') are excluded.
// Runs on a 2-hour cron. Uses a Google service account — share jennangusplan@gmail.com
// calendar with the service account email (editor access) before first run.

import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, GOOGLE_SERVICE_ACCOUNT_JSON } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
    process.exit(1);
}
if (!GOOGLE_SERVICE_ACCOUNT_JSON) {
    console.error('Missing GOOGLE_SERVICE_ACCOUNT_JSON');
    process.exit(1);
}

const supabase    = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const CALENDAR_ID = 'jennangusplan@gmail.com';

const serviceAccount = JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON);
const auth = new google.auth.JWT(
    serviceAccount.client_email,
    null,
    serviceAccount.private_key,
    ['https://www.googleapis.com/auth/calendar']
);
const calendar = google.calendar({ version: 'v3', auth });

// Sydney today
const sydneyNow  = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
const todayStr   = `${sydneyNow.getFullYear()}-${String(sydneyNow.getMonth()+1).padStart(2,'0')}-${String(sydneyNow.getDate()).padStart(2,'0')}`;
// UTC equivalent of Sydney midnight (handles both AEST and AEDT)
const secsSinceMidnight = sydneyNow.getHours() * 3600 + sydneyNow.getMinutes() * 60 + sydneyNow.getSeconds();
const sydneyMidnightUTC = new Date(Date.now() - secsSinceMidnight * 1000);

function buildEventBody(block) {
    return {
        summary: 'SYSTEM GEN: House clean /app',
        description: block.notes || '',
        start: { dateTime: `${block.date}T${block.start_time}:00`, timeZone: 'Australia/Sydney' },
        end:   { dateTime: `${block.date}T${block.end_time}:00`,   timeZone: 'Australia/Sydney' },
        extendedProperties: { private: { cleaningBlockId: block.id } },
    };
}

async function main() {
    // 1. Fetch upcoming cleaning blocks and exclude auto-generated Airbnb checkout blocks.
    //    Auto-blocks come in two formats depending on when they were created:
    //      - Old format: plain date "YYYY-MM-DD" (length === 10), no suffix
    //      - New format: "YYYY-MM-DD-auto"
    //    Manually-added blocks always have a random 8-char suffix, e.g. "YYYY-MM-DD-mq0b2kh0".
    const { data: allBlocks, error: sbErr } = await supabase
        .from('cleaning_blocks')
        .select('*')
        .gte('date', todayStr);
    if (sbErr) throw new Error(`Supabase fetch failed: ${sbErr.message}`);

    const manual = (allBlocks || []).filter(b => b.id.length > 10 && !b.id.endsWith('-auto'));
    console.log(`${(allBlocks || []).length} total block(s) in Supabase, ${manual.length} manual (excluding auto-generated)`);


    // 2. Fetch all future events from the calendar that this script manages
    //    (tagged via extendedProperties.private.cleaningBlockId)
    const listRes = await calendar.events.list({
        calendarId:   CALENDAR_ID,
        timeMin:      sydneyMidnightUTC.toISOString(),
        maxResults:   2500,
        singleEvents: true,
        orderBy:      'startTime',
    });
    const managed = (listRes.data.items || []).filter(e =>
        e.extendedProperties?.private?.cleaningBlockId
    );
    const eventByBlockId = new Map(managed.map(e => [e.extendedProperties.private.cleaningBlockId, e]));
    console.log(`${managed.length} managed calendar event(s) found`);

    const blockIds = new Set(manual.map(b => b.id));

    // 3. Create new events / update changed ones
    for (const block of manual) {
        const existing = eventByBlockId.get(block.id);
        const body     = buildEventBody(block);
        if (!existing) {
            await calendar.events.insert({ calendarId: CALENDAR_ID, requestBody: body });
            console.log(`  Created: ${block.date} ${block.start_time}–${block.end_time} (${block.id})`);
        } else {
            // Compare times and notes; update only if something changed
            const existStart  = (existing.start?.dateTime || '').slice(0, 19);
            const existEnd    = (existing.end?.dateTime   || '').slice(0, 19);
            const wantStart   = `${block.date}T${block.start_time}:00`;
            const wantEnd     = `${block.date}T${block.end_time}:00`;
            const notesSame   = (existing.description || '') === (block.notes || '');
            if (existStart !== wantStart || existEnd !== wantEnd || !notesSame) {
                await calendar.events.update({ calendarId: CALENDAR_ID, eventId: existing.id, requestBody: body });
                console.log(`  Updated: ${block.date} (${block.id})`);
            }
        }
    }

    // 4. Delete calendar events whose blocks have been removed from the app,
    //    or that were wrongly created for auto-generated Airbnb blocks (both formats).
    for (const [blockId, event] of eventByBlockId) {
        const isAutoBlock = blockId.length <= 10 || blockId.endsWith('-auto');
        if (!blockIds.has(blockId) || isAutoBlock) {
            await calendar.events.delete({ calendarId: CALENDAR_ID, eventId: event.id });
            console.log(`  Deleted ${isAutoBlock ? 'auto-block' : 'orphaned'} event for block ${blockId}`);
        }
    }

    console.log('Calendar sync complete.');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
