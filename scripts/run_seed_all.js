/* eslint-disable no-console */

// Node.js replacement for scripts/run_seed_all.ps1
// Runs ingestion + demo seeding via HTTP APIs.

function getArg(name, defaultValue) {
  const idx = process.argv.findIndex((a) => String(a).toLowerCase() === String(name).toLowerCase());
  if (idx === -1) return defaultValue;
  const next = process.argv[idx + 1];
  if (next === undefined) return defaultValue;
  return String(next);
}

function hasFlag(name) {
  const needle = String(name).toLowerCase();
  return process.argv.some((a) => String(a).toLowerCase() === needle);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function httpJson(url, { method = 'GET', headers, body } = {}) {
  const resp = await fetch(url, {
    method,
    headers: {
      ...(headers || {}),
      ...(body ? { 'content-type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await resp.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // ignore
  }

  if (!resp.ok) {
    const msg = json?.error?.message || text || `HTTP ${resp.status}`;
    const code = json?.error?.code || 'HTTP_ERROR';
    const err = new Error(`${code}: ${msg}`);
    err.status = resp.status;
    err.body = json || text;
    throw err;
  }

  return json;
}

function extractEmployeeIdsFromDirectoryResponse(dirResp) {
  const data = dirResp?.data ?? dirResp;

  let employees = null;
  if (data?.employees) employees = data.employees;
  else if (Array.isArray(data)) employees = data;
  else if (dirResp?.employees) employees = dirResp.employees;

  if (!Array.isArray(employees)) return [];

  const ids = new Set();
  for (const e of employees) {
    const id = e?.id ?? e?.employeeId ?? e?.employee_id;
    if (id === undefined || id === null) continue;
    const s = String(id).trim();
    if (s) ids.add(s);
  }
  return Array.from(ids);
}

async function main() {
  const baseUrl = getArg('--baseUrl', 'http://localhost:4002');
  const orgId = getArg('--orgId', 'demo');
  const snapshotAt = getArg('--snapshotAt', new Date().toISOString().slice(0, 10));
  const sleepMs = Number.parseInt(getArg('--sleepMs', '200'), 10);

  const seedDocumentsAndMemory = hasFlag('--seedDocumentsAndMemory')
    ? true
    : String(getArg('--seedDocumentsAndMemory', 'true')).toLowerCase() === 'true';

  const seedDemoCollections = hasFlag('--seedDemoCollections')
    ? true
    : String(getArg('--seedDemoCollections', 'true')).toLowerCase() === 'true';

  const ingestSlackMessages = hasFlag('--ingestSlackMessages')
    ? true
    : String(getArg('--ingestSlackMessages', 'true')).toLowerCase() === 'true';

  const slackDaysBack = Number.parseInt(getArg('--slackDaysBack', '7'), 10);
  const slackChannelLimit = Number.parseInt(getArg('--slackChannelLimit', '10'), 10);

  const headers = { 'x-org-id': orgId };

  console.log(`[run_seed_all.js] baseUrl=${baseUrl} orgId=${orgId} snapshotAt=${snapshotAt}`);

  // 0) Ensure directory ingested (creates employees + snapshots)
  await httpJson(`${baseUrl}/api/ingest/bamboohr/directory?snapshotAt=${encodeURIComponent(snapshotAt)}&incremental=true`, {
    method: 'POST',
    headers
  });
  console.log('[run_seed_all.js] bamboohr directory ingested');

  // 1) Fetch directory IDs (probe endpoint)
  const dir = await httpJson(`${baseUrl}/api/bamboohr/employees/directory`, { headers });
  const ids = extractEmployeeIdsFromDirectoryResponse(dir);
  if (!ids.length) throw new Error('No employee IDs found in directory response.');
  console.log(`[run_seed_all.js] employees=${ids.length}`);

  // 2) Ingest per-employee detail
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    try {
      await httpJson(`${baseUrl}/api/ingest/bamboohr/employees/${encodeURIComponent(id)}?snapshotAt=${encodeURIComponent(snapshotAt)}`, {
        method: 'POST',
        headers
      });
      ok += 1;
    } catch (err) {
      fail += 1;
      console.warn(`[run_seed_all.js] bamboohr employee ingest failed id=${id} error=${err.message}`);
    }

    if (sleepMs > 0) await sleep(sleepMs);
  }
  console.log(`[run_seed_all.js] bamboohr_ingest_ok=${ok} bamboohr_ingest_fail=${fail}`);

  // 3) Slack users
  try {
    await httpJson(`${baseUrl}/api/ingest/slack/users?snapshotAt=${encodeURIComponent(snapshotAt)}&incremental=true`, {
      method: 'POST',
      headers
    });
    console.log('[run_seed_all.js] slack users ingested');
  } catch (err) {
    console.warn(`[run_seed_all.js] slack users ingest skipped (error=${err.message})`);
  }

  // 4) Slack channels + messages (timestamp incremental)
  if (ingestSlackMessages) {
    try {
      const channelsResp = await httpJson(
        `${baseUrl}/api/ingest/slack/channels?snapshotAt=${encodeURIComponent(snapshotAt)}&incremental=true&limit=200`,
        { method: 'POST', headers }
      );

      const channelIds = channelsResp?.data?.channelIds || [];
      const limited = channelIds.slice(0, Math.max(0, Math.min(slackChannelLimit, channelIds.length)));
      console.log(`[run_seed_all.js] slack channels=${channelIds.length} ingestingMessagesFor=${limited.length} daysBack=${slackDaysBack}`);

      for (const ch of limited) {
        try {
          await httpJson(
            `${baseUrl}/api/ingest/slack/channels/${encodeURIComponent(ch)}/messages?incremental=true&daysBack=${encodeURIComponent(
              String(slackDaysBack)
            )}&includeReplies=false`,
            { method: 'POST', headers }
          );
          console.log(`[run_seed_all.js] slack messages ok channel=${ch}`);
        } catch (err) {
          console.warn(`[run_seed_all.js] slack messages failed channel=${ch} error=${err.message}`);
        }

        if (sleepMs > 0) await sleep(sleepMs);
      }
    } catch (err) {
        const msg = String(err?.message || 'unknown_error');
        if (msg.includes('missing_scope')) {
          console.warn(
            `[run_seed_all.js] slack channels/messages skipped (error=${msg}). ` +
              'Your Slack token is missing scopes required for channels + messages ingestion. ' +
              'Common required scopes: conversations:read, channels:history (and groups:history for private channels).'
          );
        } else {
          console.warn(`[run_seed_all.js] slack channels/messages skipped (error=${msg})`);
        }
    }
  }

  // 5) Seed documents + chunks + memory events (via API)
  if (seedDocumentsAndMemory) {
    let docOk = 0;
    let docFail = 0;
    let memOk = 0;
    let memFail = 0;

    for (const id of ids) {
      const externalId = `seed:transcript:${id}:${snapshotAt}`;
      let documentId = null;

      try {
        const docResp = await httpJson(`${baseUrl}/api/ingest/documents`, {
          method: 'POST',
          headers,
          body: {
            documentType: 'meeting_transcript',
            sourceSystem: 'seed',
            externalId,
            metadata: { employeeId: id, seeded: true },
            content: `Seed transcript for employee ${id}`,
            sensitivity: 'standard',
            chunks: [
              {
                chunkIndex: 0,
                employeeId: id,
                text: `Summary: employee ${id} is tracking priorities and blockers.`,
                tokenCount: 14
              },
              {
                chunkIndex: 1,
                employeeId: id,
                text: 'Actions: follow up on open items; schedule 1:1.',
                tokenCount: 12
              }
            ]
          }
        });

        documentId = docResp?.data?.documentId || null;
        docOk += 1;
      } catch (err) {
        docFail += 1;
        console.warn(`[run_seed_all.js] doc seed failed employeeId=${id} error=${err.message}`);
      }

      if (documentId) {
        try {
          await httpJson(`${baseUrl}/api/memory/events`, {
            method: 'POST',
            headers,
            body: {
              employeeId: id,
              eventType: 'meeting_summary',
              eventTime: new Date().toISOString(),
              summary: `Seeded memory event for employee ${id}`,
              sourceDocumentId: String(documentId),
              confidence: 0.8,
              sensitivity: 'standard'
            }
          });
          memOk += 1;
        } catch (err) {
          memFail += 1;
          console.warn(`[run_seed_all.js] memory seed failed employeeId=${id} error=${err.message}`);
        }
      }

      if (sleepMs > 0) await sleep(sleepMs);
    }

    console.log(
      `[run_seed_all.js] documents_seed_ok=${docOk} documents_seed_fail=${docFail} memory_seed_ok=${memOk} memory_seed_fail=${memFail}`
    );
  }

  // 6) Seed demo-only collections (audit_logs + survey_responses + organizations)
  if (seedDemoCollections) {
    try {
      const { spawnSync } = require('node:child_process');
      const result = spawnSync('node', ['src/scripts/seedDemoData.js', '--orgId', orgId, '--name', 'Demo Organization'], {
      cwd: require('node:path').join(__dirname, '..', 'services', 'api-gateway', 'backend'),
        stdio: 'inherit'
      });
      if (result.status !== 0) {
        console.warn(`[run_seed_all.js] db:seed-demo exited with code ${result.status}`);
      }
    } catch (err) {
      console.warn(`[run_seed_all.js] db:seed-demo skipped (error=${err.message})`);
    }
  }

  console.log('[run_seed_all.js] done');
}

main().catch((err) => {
  console.error('[run_seed_all.js] failed:', err?.message || err);
  process.exit(1);
});
