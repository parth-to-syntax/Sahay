const axios = require('axios');
const { HttpError } = require('../../shared/errors');

const FIREFLIES_GRAPHQL_URL = 'https://api.fireflies.ai/graphql';

const DEFAULT_TRANSCRIPTS_QUERY = `
query FetchTranscripts($limit: Int, $skip: Int, $fromDate: DateTime, $toDate: DateTime) {
  transcripts(limit: $limit, skip: $skip, fromDate: $fromDate, toDate: $toDate) {
    id
    title
    date
    duration
    meeting_link
    host_email
    organizer_email
    participants
    sentences {
      text
      speaker_name
      start_time
      end_time
    }
  }
}
`;

function getFirefliesApiKey() {
  const key = process.env.FIREFLIES_API_KEY;
  if (!key || String(key).trim() === '') {
    throw new HttpError(500, 'Missing FIREFLIES_API_KEY', 'FIREFLIES_MISSING_API_KEY');
  }
  return String(key).trim();
}

function createClient() {
  const apiKey = getFirefliesApiKey();
  return axios.create({
    baseURL: FIREFLIES_GRAPHQL_URL,
    timeout: 30000,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }
  });
}

function mapAxiosError(err) {
  const status = err?.response?.status;
  const data = err?.response?.data;

  if (Array.isArray(data?.errors) && data.errors.length > 0) {
    const msg = String(data.errors[0]?.message || 'GraphQL error').slice(0, 300);
    throw new HttpError(status || 502, `Fireflies GraphQL failed: ${msg}`, 'FIREFLIES_GRAPHQL_ERROR');
  }

  if (status) {
    throw new HttpError(status, `Fireflies request failed (${status})`, 'FIREFLIES_HTTP_ERROR');
  }

  if (err?.code === 'ECONNABORTED') {
    throw new HttpError(504, 'Fireflies request timed out', 'FIREFLIES_TIMEOUT');
  }

  throw new HttpError(502, 'Fireflies request failed', 'FIREFLIES_NETWORK_ERROR');
}

async function executeGraphql({ query, variables = {} }) {
  const client = createClient();
  try {
    const res = await client.post('', { query, variables });
    if (Array.isArray(res?.data?.errors) && res.data.errors.length > 0) {
      const msg = String(res.data.errors[0]?.message || 'GraphQL error').slice(0, 300);
      throw new HttpError(502, `Fireflies GraphQL failed: ${msg}`, 'FIREFLIES_GRAPHQL_ERROR');
    }
    return res?.data?.data || {};
  } catch (err) {
    if (err instanceof HttpError) throw err;
    mapAxiosError(err);
  }
}

async function fetchTranscripts({ limit = 25, skip = 0, fromDate, toDate } = {}) {
  const query = process.env.FIREFLIES_TRANSCRIPTS_QUERY || DEFAULT_TRANSCRIPTS_QUERY;
  const variables = {
    limit: Number.isFinite(limit) ? limit : 25,
    skip: Number.isFinite(skip) ? skip : 0,
    fromDate: fromDate || null,
    toDate: toDate || null
  };

  const data = await executeGraphql({ query, variables });
  const transcripts = Array.isArray(data?.transcripts) ? data.transcripts : [];
  return { transcripts, raw: data };
}

module.exports = {
  fetchTranscripts,
  executeGraphql
};