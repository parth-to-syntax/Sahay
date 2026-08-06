const axios = require('axios');
const { HttpError } = require('../../shared/errors');

function redactEmails(text) {
  return String(text || '').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]');
}

function safeSnippet(value, maxLen = 240) {
  const redacted = redactEmails(value);
  const oneLine = redacted.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= maxLen) return oneLine;
  return `${oneLine.slice(0, maxLen)}…`;
}

function escapeXml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getBambooBase() {
  const apiBase = process.env.BAMBOOHR_API_BASE || 'https://api.bamboohr.com/api/gateway.php';
  const company = process.env.BAMBOOHR_COMPANY;
  return `${apiBase}/${company}/v1`;
}

function buildAuthHeader() {
  const apiKey = process.env.BAMBOOHR_API_KEY;
  // BambooHR uses Basic Auth: base64(apiKey + ":x")
  const token = Buffer.from(`${apiKey}:x`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

function createClient() {
  const baseURL = getBambooBase();
  const auth = buildAuthHeader();

  return axios.create({
    baseURL,
    headers: {
      Authorization: auth,
      Accept: 'application/json'
    },
    timeout: 20000
  });
}

function mapAxiosError(err) {
  if (err.response) {
    const status = err.response.status;
    let details = '';
    try {
      const data = err.response.data;
      if (typeof data === 'string' && data.trim() !== '') {
        details = safeSnippet(data);
      } else if (data && typeof data === 'object') {
        details = safeSnippet(JSON.stringify(data));
      }
    } catch (_) {
      // ignore
    }

    const message = details
      ? `BambooHR request failed (${status}): ${details}`
      : `BambooHR request failed (${status})`;
    throw new HttpError(status, message, 'BAMBOOHR_HTTP_ERROR');
  }
  if (err.code === 'ECONNABORTED') {
    throw new HttpError(504, 'BambooHR request timed out', 'BAMBOOHR_TIMEOUT');
  }
  throw new HttpError(502, 'BambooHR request failed', 'BAMBOOHR_NETWORK_ERROR');
}

async function getMetaFields() {
  const client = createClient();
  try {
    const res = await client.get('/meta/fields');
    return res.data;
  } catch (err) {
    mapAxiosError(err);
  }
}

async function getEmployeeDirectory() {
  const client = createClient();
  try {
    const res = await client.get('/employees/directory');
    return res.data;
  } catch (err) {
    mapAxiosError(err);
  }
}

async function getEmployeeById(employeeId, fieldsCsv) {
  const client = createClient();
  try {
    const params = {};
    if (fieldsCsv && String(fieldsCsv).trim() !== '') {
      params.fields = fieldsCsv;
    }
    const res = await client.get(`/employees/${encodeURIComponent(employeeId)}`, { params });
    return res.data;
  } catch (err) {
    mapAxiosError(err);
  }
}

async function createEmployee(payload) {
  const client = createClient();
  const extract = (res) => {
    const raw = typeof res.data === 'string' ? res.data.trim() : '';
    let employeeId = null;

    if (raw && /^\d+$/.test(raw)) {
      employeeId = raw;
    }

    if (!employeeId) {
      const location = res.headers && (res.headers.location || res.headers.Location);
      if (location && typeof location === 'string') {
        const match = location.match(/\/(\d+)(?:\D|$)/);
        if (match && match[1]) employeeId = match[1];
      }
    }

    return {
      employeeId,
      status: res.status,
      raw
    };
  };

  // Prefer XML body for legacy gateway API; many tenants return plain-text employeeId.
  try {
    const firstName = payload?.firstName;
    const lastName = payload?.lastName;
    const workEmail = payload?.workEmail;

    let xml = '<employee>';
    if (firstName) xml += `<firstName>${escapeXml(firstName)}</firstName>`;
    if (lastName) xml += `<lastName>${escapeXml(lastName)}</lastName>`;
    if (workEmail) xml += `<workEmail>${escapeXml(workEmail)}</workEmail>`;
    xml += '</employee>';

    const res = await client.post('/employees/', xml, {
      headers: {
        'Content-Type': 'application/xml',
        Accept: 'text/plain, application/json, */*'
      },
      transformResponse: [(data) => data]
    });

    return extract(res);
  } catch (err) {
    // If the tenant doesn't accept XML here, fall back to form-encoded.
    const status = err?.response?.status;
    if (status && status !== 400 && status !== 415) {
      mapAxiosError(err);
    }
  }

  try {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(payload || {})) {
      if (value === undefined || value === null) continue;
      const stringValue = String(value).trim();
      if (stringValue === '') continue;
      body.append(key, stringValue);
    }

    const res = await client.post('/employees/', body.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/plain, application/json, */*'
      },
      transformResponse: [(data) => data]
    });

    return extract(res);
  } catch (err) {
    mapAxiosError(err);
  }
}

module.exports = {
  getMetaFields,
  getEmployeeDirectory,
  getEmployeeById,
  createEmployee
};
