// Syncs manually-added cleaning blocks from Supabase to Google Calendar.
// Blocks auto-generated for Airbnb checkout days (id ending in '-auto') are excluded.
// Runs on a 2-hour cron. Uses a Google service account — share jennangusplan@gmail.com
// calendar with the service account email (editor access) before first run.
//
// Uses Node.js built-in fetch + crypto (no googleapis/node-fetch dependency).

import { createClient } from '@supabase/supabase-js';
import { createSign } from 'crypto';

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, GOOGLE_SERVICE_ACCOUNT_JSON } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
    process.exit(1);
}
if (!GOOGLE_SERVICE_ACCOUNT_JSON) {
    console.error('Missing GOOGLE_SERVICE_ACCOUNT_JSON');
    process.exit(1);
}

const supabase       = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const serviceAccount = JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON);
const CALENDAR_ID    = 'jennangusplan@gmail.com';

// Sydney today
const sydneyNow  = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
const todayStr   = `${sydneyNow.getFullYear()}-${String(sydneyNow.getMonth()+1).padStart(2,'0')}-${String(sydneyNow.getDate()).padStart(2,'0')}`;
const secsSinceMidnight = sydneyNow.getHours() * 3600 + sydneyNow.getMinutes() * 60 + sydneyNow.getSeconds();
const sydneyMidnightUTC = new Date(Date.now() - secsSinceMidnight * 1000);

async function getAccessToken() {
    const now     = Math.floor(Date.now() / 1000);
    const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
        iss:   serviceAccount.client_email,
        scope: 'https://www.googleapis.com/auth/calendar',
        aud:   'https://oauth2.googleapis.com/token',
        exp:   now + 3600,
        iat:   now,
    })).toString('base64url');
    const sign = createSign('RSA-SHA256');
    sign.update(`${header}.${payload}`);
    const sig = sign.sign(serviceAccount.private_key, 'base64url');
    const jwt = `${header}.${payload}.${sig}`;

    const res  = await fetch('https://oauth2.googleapis.com/token', {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion:  jwt,
        }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`OAuth token error: ${data.error}: ${data.error_description}`);
    return data.access_token;
}

async function calFetch(token, path, method = 'GET', body = null, attempt = 1) {
    const opts = {
        method,
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    const res  = await fetch(`https://www.googleapis.com/calendar/v3${path}`, opts);
    if (res.status === 204) return null;
    const data = await res.json();
    if (!res.ok) {
        const msg = data.error?.message || JSON.stringify(data);
        if ((res.status >= 500 || res.status === 429) && attempt < 4) {
            const delay = res.status === 429 ? 10000 : attempt * 3000;
            console.warn(`Calendar API ${method} ${path} returned ${res.status} — retrying in ${delay/1000}s`);
            await new Promise(r => setTimeout(r, delay));
            return calFetch(token, path, method, body, attempt + 1);
        }
        throw new Error(`Calendar API ${method} ${path}: ${msg}`);
    }
    return data;
}

function buildEventBody(block) {
    return {
        summary:     'SYSTEM GEN: House clean /app',
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

    const token = await getAccessToken();

    // 2. Fetch all future events from the calendar that this script manages
    const calId   = encodeURIComponent(CALENDAR_ID);
    const params  = new URLSearchParams({
        timeMin:      sydneyMidnightUTC.toISOString(),
        maxResults:   '2500',
        singleEvents: 'true',
        orderBy:      'startTime',
    });
    const listData = await calFetch(token, `/calendars/${calId}/events?${params}`);
    const managed  = (listData.items || []).filter(e => e.extendedProperties?.private?.cleaningBlockId);
    const eventByBlockId = new Map(managed.map(e => [e.extendedProperties.private.cleaningBlockId, e]));
    console.log(`${managed.length} managed calendar event(s) found`);

    const blockIds = new Set(manual.map(b => b.id));

    // 3. Create new events / update changed ones
    for (const block of manual) {
        const existing = eventByBlockId.get(block.id);
        const body     = buildEventBody(block);
        if (!existing) {
            await calFetch(token, `/calendars/${calId}/events`, 'POST', body);
            console.log(`  Created: ${block.date} ${block.start_time}–${block.end_time} (${block.id})`);
        } else {
            const existStart = (existing.start?.dateTime || '').slice(0, 19);
            const existEnd   = (existing.end?.dateTime   || '').slice(0, 19);
            const wantStart  = `${block.date}T${block.start_time}:00`;
            const wantEnd    = `${block.date}T${block.end_time}:00`;
            const notesSame  = (existing.description || '') === (block.notes || '');
            if (existStart !== wantStart || existEnd !== wantEnd || !notesSame) {
                await calFetch(token, `/calendars/${calId}/events/${existing.id}`, 'PUT', body);
                console.log(`  Updated: ${block.date} (${block.id})`);
            }
        }
    }

    // 4. Delete calendar events whose blocks have been removed from the app,
    //    or that were wrongly created for auto-generated Airbnb blocks (both formats).
    for (const [blockId, event] of eventByBlockId) {
        const isAutoBlock = blockId.length <= 10 || blockId.endsWith('-auto');
        if (!blockIds.has(blockId) || isAutoBlock) {
            await calFetch(token, `/calendars/${calId}/events/${event.id}`, 'DELETE');
            console.log(`  Deleted ${isAutoBlock ? 'auto-block' : 'orphaned'} event for block ${blockId}`);
        }
    }

    console.log('Calendar sync complete.');
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
