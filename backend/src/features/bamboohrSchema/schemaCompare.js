const desired = require('./desiredFields');
const keywordHints = require('./keywordHints');

function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function flattenDesired() {
  const out = [];
  for (const [group, fields] of Object.entries(desired)) {
    for (const f of fields) out.push({ group, field: f });
  }
  return out;
}

function indexMetaFields(metaFields) {
  const fields = Array.isArray(metaFields)
    ? metaFields
    : (metaFields && metaFields.fields) ? metaFields.fields : [];

  const byAlias = new Map();
  const byName = new Map();
  const all = [];

  for (const f of fields) {
    const alias = f.alias ? String(f.alias) : null;
    const name = f.name ? String(f.name) : null;
    const id = f.id;

    all.push({ id, name, alias, type: f.type });

    if (alias) byAlias.set(normalize(alias), { id, name, alias, type: f.type });
    if (name) byName.set(normalize(name), { id, name, alias, type: f.type });
  }

  return { all, byAlias, byName };
}

function indexDirectoryFields(directoryData) {
  const fields = directoryData && directoryData.fields ? directoryData.fields : [];
  const byId = new Map();
  const byName = new Map();
  const hasEmployeeRecordId = directoryData && Array.isArray(directoryData.employees) && directoryData.employees.length > 0
    && Object.prototype.hasOwnProperty.call(directoryData.employees[0], 'id');

  for (const f of fields) {
    if (f.id) byId.set(normalize(f.id), f);
    if (f.name) byName.set(normalize(f.name), f);
  }

  return { fields, byId, byName, hasEmployeeRecordId };
}

function scoreMetaCandidate(metaField, keywords) {
  const name = normalize(metaField.name);
  const alias = normalize(metaField.alias);
  let score = 0;
  for (const kw of keywords) {
    const k = normalize(kw);
    if (!k) continue;
    if (name.includes(k)) score += 3;
    if (alias && alias.includes(k)) score += 4;
  }
  // Prefer fields with aliases because they are easier to request.
  if (metaField.alias) score += 1;
  return score;
}

function findMetaCandidates(metaIndex, desiredField) {
  const hints = keywordHints[desiredField];
  if (!hints || hints.length === 0) return [];

  const scored = metaIndex.all
    .map((f) => ({ f, score: scoreMetaCandidate(f, hints) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((x) => x.f);

  return scored;
}

function suggestMapping({ desiredField, metaIndex, directoryIndex }) {
  const key = normalize(desiredField);

  // Special case: employeeId concept maps to the directory employee record `id`.
  // It's not part of directory `fields[]` list, but exists on each employee object.
  if (key === 'employeeid' && directoryIndex.hasEmployeeRecordId) {
    return { source: 'directory.employee.id', match: { id: 'id', type: 'string', name: 'Employee Id (directory record id)' } };
  }

  // 1) direct alias match
  if (metaIndex.byAlias.has(key)) {
    const m = metaIndex.byAlias.get(key);
    return { source: 'meta.alias', match: m };
  }

  // 2) directory field id match
  if (directoryIndex.byId.has(key)) {
    const d = directoryIndex.byId.get(key);
    return { source: 'directory.id', match: d };
  }

  // 3) directory name match
  if (directoryIndex.byName.has(key)) {
    const d = directoryIndex.byName.get(key);
    return { source: 'directory.name', match: d };
  }

  // 4) meta name match
  if (metaIndex.byName.has(key)) {
    const m = metaIndex.byName.get(key);
    return { source: 'meta.name', match: m };
  }

  // 5) heuristic synonyms (minimal and safe)
  const synonyms = new Map([
    ['employeeid', ['id']],
    ['manager', ['supervisor']],
    ['salaryband', ['payband']],
    ['finaldate', ['terminationdate']],
  ]);

  if (synonyms.has(key)) {
    for (const syn of synonyms.get(key)) {
      const synKey = normalize(syn);
      if (metaIndex.byAlias.has(synKey)) return { source: 'meta.alias(syn)', match: metaIndex.byAlias.get(synKey) };
      if (directoryIndex.byId.has(synKey)) return { source: 'directory.id(syn)', match: directoryIndex.byId.get(synKey) };
      if (metaIndex.byName.has(synKey)) return { source: 'meta.name(syn)', match: metaIndex.byName.get(synKey) };
    }
  }

  return null;
}

function compareSchema({ metaFields, directoryData }) {
  const desiredList = flattenDesired();
  const metaIndex = indexMetaFields(metaFields);
  const directoryIndex = indexDirectoryFields(directoryData);

  const matches = [];
  const missing = [];
  const missingCandidates = [];

  for (const item of desiredList) {
    const suggestion = suggestMapping({
      desiredField: item.field,
      metaIndex,
      directoryIndex
    });

    if (suggestion) {
      matches.push({
        group: item.group,
        desired: item.field,
        matchedFrom: suggestion.source,
        matched: suggestion.match
      });
    } else {
      missing.push(item);
      const candidates = findMetaCandidates(metaIndex, item.field);
      if (candidates.length > 0) {
        missingCandidates.push({
          group: item.group,
          desired: item.field,
          candidates
        });
      }
    }
  }

  return {
    desired: desired,
    directoryFields: directoryIndex.fields,
    metaFieldCount: metaIndex.all.length,
    matches,
    missing,
    missingCandidates,
    notes: [
      'employeeId is available as employees[].id in employees/directory (mapped as directory.employee.id).',
      'manager in directory is available as supervisor (manager display name); managerId may require additional employee detail fields or name-to-id resolution.',
      'Many HRMS concepts (comp/performance/leave) may exist as custom fields or separate modules; use /api/bamboohr/schema/search to discover candidates by keyword.'
    ]
  };
}

module.exports = { compareSchema };
