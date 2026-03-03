import db from './connection.js';

// ── Officials ──

export function getOfficialCount() {
  return db.prepare('SELECT COUNT(*) as count FROM officials').get().count;
}

export function getOfficialById(id) {
  return db.prepare('SELECT * FROM officials WHERE id = :id').get({ id });
}

export function patchOfficial(id, { notes, deal_stage }) {
  const fields = [];
  const params = { id };
  if (notes !== undefined) { fields.push('notes = :notes'); params.notes = notes; }
  if (deal_stage !== undefined) { fields.push('deal_stage = :deal_stage'); params.deal_stage = deal_stage; }
  if (fields.length === 0) return false;
  fields.push("updated_at = datetime('now')");
  db.prepare(`UPDATE officials SET ${fields.join(', ')} WHERE id = :id`).run(params);
  return true;
}

// Returns pairs of officials that look like duplicates (fuzzy name match)
export function getDuplicateCandidates() {
  const officials = db.prepare(
    'SELECT id, name, title, department, municipality, state, department_type, government_level, source, description, linkedin_url FROM officials ORDER BY name'
  ).all();
  const candidates = [];
  for (let i = 0; i < officials.length; i++) {
    for (let j = i + 1; j < officials.length; j++) {
      const a = officials[i], b = officials[j];
      if (nameSimilarity(a.name, b.name) > 0.75) {
        candidates.push({ a, b, score: nameSimilarity(a.name, b.name) });
        if (candidates.length >= 50) return candidates;
      }
    }
  }
  return candidates;
}

function nameSimilarity(a, b) {
  a = a.toLowerCase().replace(/[^a-z]/g, '');
  b = b.toLowerCase().replace(/[^a-z]/g, '');
  if (a === b) return 1;
  const bigrams = s => new Set([...Array(s.length - 1)].map((_, i) => s.slice(i, i + 2)));
  const ba = bigrams(a), bb = bigrams(b);
  let inter = 0;
  for (const bg of ba) if (bb.has(bg)) inter++;
  return inter / (ba.size + bb.size - inter);
}

export function mergeOfficials(keepId, deleteId) {
  db.prepare(`
    UPDATE officials SET
      description  = COALESCE(NULLIF(description, ''), (SELECT description FROM officials WHERE id = :del)),
      linkedin_url = COALESCE(linkedin_url, (SELECT linkedin_url FROM officials WHERE id = :del)),
      website      = COALESCE(website,      (SELECT website      FROM officials WHERE id = :del)),
      email        = COALESCE(email,        (SELECT email        FROM officials WHERE id = :del)),
      phone        = COALESCE(phone,        (SELECT phone        FROM officials WHERE id = :del)),
      notes        = CASE WHEN notes = '' OR notes IS NULL
                     THEN (SELECT notes FROM officials WHERE id = :del)
                     ELSE notes END,
      population   = CASE WHEN population < (SELECT population FROM officials WHERE id = :del)
                     THEN (SELECT population FROM officials WHERE id = :del)
                     ELSE population END,
      updated_at = datetime('now')
    WHERE id = :keep
  `).run({ keep: keepId, del: deleteId });
  db.prepare(`INSERT OR IGNORE INTO watchlist (official_id) SELECT :keep WHERE EXISTS (SELECT 1 FROM watchlist WHERE official_id = :del)`).run({ keep: keepId, del: deleteId });
  db.prepare(`DELETE FROM watchlist WHERE official_id = :del`).run({ del: deleteId });
  db.prepare(`DELETE FROM officials WHERE id = :del`).run({ del: deleteId });
  return true;
}

// For digest emails
export function getRecentOfficials(days = 7, limit = 10) {
  return db.prepare(`
    SELECT * FROM officials
    WHERE created_at >= datetime('now', '-' || :days || ' days')
    ORDER BY created_at DESC LIMIT :limit
  `).all({ days, limit });
}

export function getHighPopulationOfficials(limit = 5) {
  return db.prepare(`
    SELECT * FROM officials WHERE population > 0
    ORDER BY population DESC LIMIT :limit
  `).all({ limit });
}

export function searchOfficials({ search, department_type, government_level, state, source, sort, limit = 100, offset = 0, watchlistOnly = false }) {
  const conditions = [];
  const params = {};

  if (search) {
    conditions.push(`(
      LOWER(name) LIKE '%' || LOWER(:search) || '%' OR
      LOWER(municipality) LIKE '%' || LOWER(:search) || '%' OR
      LOWER(department) LIKE '%' || LOWER(:search) || '%' OR
      LOWER(title) LIKE '%' || LOWER(:search) || '%' OR
      LOWER(description) LIKE '%' || LOWER(:search) || '%'
    )`);
    params.search = search;
  }
  if (department_type && department_type !== 'all') {
    conditions.push('department_type = :department_type');
    params.department_type = department_type;
  }
  if (government_level && government_level !== 'all') {
    conditions.push('government_level = :government_level');
    params.government_level = government_level;
  }
  if (state && state !== 'all') {
    conditions.push('state = :state');
    params.state = state;
  }
  if (source && source !== 'all') {
    conditions.push('source = :source');
    params.source = source;
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const joinClause = watchlistOnly
    ? 'INNER JOIN watchlist w ON w.official_id = officials.id'
    : 'LEFT JOIN watchlist w ON w.official_id = officials.id';

  let orderBy;
  switch (sort) {
    case 'population': orderBy = 'population DESC'; break;
    case 'name':       orderBy = 'name ASC'; break;
    case 'updated':    orderBy = 'updated_at DESC'; break;
    case 'recent':
    default:           orderBy = 'discovered_date DESC, created_at DESC'; break;
  }

  const countSql = `SELECT COUNT(*) as total FROM officials ${joinClause} ${where}`;
  const { total } = db.prepare(countSql).get(params);

  const sql = `
    SELECT officials.*,
           CASE WHEN w.official_id IS NOT NULL THEN 1 ELSE 0 END as is_watchlisted
    FROM officials
    ${joinClause}
    ${where}
    ORDER BY ${orderBy}
    LIMIT :limit OFFSET :offset
  `;
  params.limit = limit;
  params.offset = offset;

  const rows = db.prepare(sql).all(params);
  return { total, officials: rows };
}

export function upsertOfficial(official) {
  // Check for existing by name + municipality + department_type (dedup key)
  const existing = db.prepare(
    'SELECT id, confidence_score, source FROM officials WHERE name = :name AND municipality = :municipality AND department_type = :department_type'
  ).get({ name: official.name, municipality: official.municipality || '', department_type: official.department_type || '' });

  if (existing) {
    let newConfidence = existing.confidence_score;
    if (official.source !== existing.source) {
      newConfidence = Math.min(0.95, existing.confidence_score + 0.2);
    }
    db.prepare(`
      UPDATE officials SET
        title = COALESCE(NULLIF(:title, ''), title),
        department = COALESCE(NULLIF(:department, ''), department),
        county = COALESCE(NULLIF(:county, ''), county),
        government_level = COALESCE(NULLIF(:government_level, ''), government_level),
        position_type = COALESCE(NULLIF(:position_type, ''), position_type),
        population = CASE WHEN :population > population THEN :population ELSE population END,
        description = COALESCE(NULLIF(:description, ''), description),
        email = COALESCE(:email, email),
        phone = COALESCE(:phone, phone),
        linkedin_url = COALESCE(:linkedin_url, linkedin_url),
        website = COALESCE(:website, website),
        source_url = COALESCE(:source_url, source_url),
        confidence_score = :confidence_score,
        updated_at = datetime('now')
      WHERE id = :id
    `).run({
      id: existing.id,
      title: official.title || '',
      department: official.department || '',
      county: official.county || '',
      government_level: official.government_level || '',
      position_type: official.position_type || '',
      population: official.population || 0,
      description: official.description || '',
      email: official.email || null,
      phone: official.phone || null,
      linkedin_url: official.linkedin_url || null,
      website: official.website || null,
      source_url: official.source_url || null,
      confidence_score: newConfidence,
    });
    return { action: 'updated', id: existing.id };
  }

  const result = db.prepare(`
    INSERT INTO officials (name, title, department, municipality, state, county,
      government_level, department_type, position_type, population, description,
      email, phone, linkedin_url, website, source, source_url, confidence_score, discovered_date)
    VALUES (:name, :title, :department, :municipality, :state, :county,
      :government_level, :department_type, :position_type, :population, :description,
      :email, :phone, :linkedin_url, :website, :source, :source_url, :confidence_score, :discovered_date)
  `).run({
    name: official.name,
    title: official.title || '',
    department: official.department || '',
    municipality: official.municipality || '',
    state: official.state || '',
    county: official.county || '',
    government_level: official.government_level || 'City',
    department_type: official.department_type || '',
    position_type: official.position_type || '',
    population: official.population || 0,
    description: official.description || '',
    email: official.email || null,
    phone: official.phone || null,
    linkedin_url: official.linkedin_url || null,
    website: official.website || null,
    source: official.source || 'exa',
    source_url: official.source_url || null,
    confidence_score: official.confidence_score || 0.5,
    discovered_date: official.discovered_date || new Date().toISOString().slice(0, 10),
  });
  return { action: 'inserted', id: result.lastInsertRowid };
}

export function getStats() {
  const byDepartment = db.prepare(
    "SELECT department_type, COUNT(*) as count FROM officials WHERE department_type != '' GROUP BY department_type ORDER BY count DESC"
  ).all();
  const byLevel = db.prepare(
    'SELECT government_level, COUNT(*) as count FROM officials GROUP BY government_level ORDER BY count DESC'
  ).all();
  const byState = db.prepare(
    "SELECT state, COUNT(*) as count FROM officials WHERE state != '' GROUP BY state ORDER BY count DESC LIMIT 20"
  ).all();
  const bySource = db.prepare(
    'SELECT source, COUNT(*) as count FROM officials GROUP BY source ORDER BY count DESC'
  ).all();
  const total = getOfficialCount();
  const watchlistCount = db.prepare('SELECT COUNT(*) as count FROM watchlist').get().count;

  return { total, watchlistCount, byDepartment, byLevel, byState, bySource };
}

// ── Watchlist ──

export function addToWatchlist(officialId) {
  try {
    db.prepare('INSERT OR IGNORE INTO watchlist (official_id) VALUES (:id)').run({ id: officialId });
    return true;
  } catch {
    return false;
  }
}

export function removeFromWatchlist(officialId) {
  db.prepare('DELETE FROM watchlist WHERE official_id = :id').run({ id: officialId });
  return true;
}

export function getWatchlistIds() {
  return db.prepare('SELECT official_id FROM watchlist').all().map(r => r.official_id);
}

export function getWatchlistCount() {
  return db.prepare('SELECT COUNT(*) as count FROM watchlist').get().count;
}

// ── Refresh Log ──

export function logRefreshStart(source) {
  const result = db.prepare(
    'INSERT INTO refresh_log (source, status) VALUES (:source, :status)'
  ).run({ source, status: 'running' });
  return result.lastInsertRowid;
}

export function logRefreshEnd(logId, recordsFound, recordsAdded, error = null) {
  db.prepare(`
    UPDATE refresh_log SET
      finished_at = datetime('now'),
      records_found = :found,
      records_added = :added,
      error = :error,
      status = :status
    WHERE id = :id
  `).run({
    id: logId,
    found: recordsFound,
    added: recordsAdded,
    error,
    status: error ? 'error' : 'completed',
  });
}

export function getLatestRefreshLogs(limit = 10) {
  return db.prepare(
    'SELECT * FROM refresh_log ORDER BY started_at DESC LIMIT :limit'
  ).all({ limit });
}
