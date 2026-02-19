import db from './connection.js';

// ── Parse raised string to numeric amount ──
function parseRaisedAmount(str) {
  if (!str) return 0;
  const clean = str.replace(/[$,]/g, '');
  if (clean.endsWith('M')) return parseFloat(clean) * 1_000_000;
  if (clean.endsWith('K')) return parseFloat(clean) * 1_000;
  return parseFloat(clean) || 0;
}

// ── Founders ──

export function getFounderCount() {
  return db.prepare('SELECT COUNT(*) as count FROM founders').get().count;
}

export function getFounderById(id) {
  return db.prepare('SELECT * FROM founders WHERE id = :id').get({ id });
}

export function patchFounder(id, { notes, deal_stage }) {
  const fields = [];
  const params = { id };
  if (notes !== undefined) { fields.push('notes = :notes'); params.notes = notes; }
  if (deal_stage !== undefined) { fields.push('deal_stage = :deal_stage'); params.deal_stage = deal_stage; }
  if (fields.length === 0) return false;
  fields.push("updated_at = datetime('now')");
  db.prepare(`UPDATE founders SET ${fields.join(', ')} WHERE id = :id`).run(params);
  return true;
}

// Returns pairs of founders that look like duplicates (fuzzy name + same sector)
export function getDuplicateCandidates() {
  const founders = db.prepare('SELECT id, name, role, company, sector, stage, raised, source, funded_date, description, linkedin_url FROM founders ORDER BY name').all();
  const candidates = [];
  for (let i = 0; i < founders.length; i++) {
    for (let j = i + 1; j < founders.length; j++) {
      const a = founders[i], b = founders[j];
      if (nameSimilarity(a.name, b.name) > 0.75) {
        candidates.push({ a, b, score: nameSimilarity(a.name, b.name) });
        if (candidates.length >= 50) return candidates; // cap at 50 pairs
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

export function mergeFounders(keepId, deleteId) {
  // Copy non-null fields from deleteId to keepId where keepId has nulls
  db.prepare(`
    UPDATE founders SET
      description = COALESCE(description, (SELECT description FROM founders WHERE id = :del)),
      linkedin_url = COALESCE(linkedin_url, (SELECT linkedin_url FROM founders WHERE id = :del)),
      website      = COALESCE(website,      (SELECT website      FROM founders WHERE id = :del)),
      github_url   = COALESCE(github_url,   (SELECT github_url   FROM founders WHERE id = :del)),
      avatar_url   = COALESCE(avatar_url,   (SELECT avatar_url   FROM founders WHERE id = :del)),
      notes        = CASE WHEN notes = '' OR notes IS NULL
                     THEN (SELECT notes FROM founders WHERE id = :del)
                     ELSE notes END,
      raised_amount = CASE WHEN raised_amount < (SELECT raised_amount FROM founders WHERE id = :del)
                      THEN (SELECT raised_amount FROM founders WHERE id = :del)
                      ELSE raised_amount END,
      updated_at = datetime('now')
    WHERE id = :keep
  `).run({ keep: keepId, del: deleteId });
  // Move watchlist if needed
  db.prepare(`INSERT OR IGNORE INTO watchlist (founder_id) SELECT :keep WHERE EXISTS (SELECT 1 FROM watchlist WHERE founder_id = :del)`).run({ keep: keepId, del: deleteId });
  db.prepare(`DELETE FROM watchlist WHERE founder_id = :del`).run({ del: deleteId });
  db.prepare(`DELETE FROM founders WHERE id = :del`).run({ del: deleteId });
  return true;
}

// For daily digest
export function getRecentFounders(days = 7, limit = 5) {
  return db.prepare(`
    SELECT * FROM founders
    WHERE created_at >= datetime('now', '-' || :days || ' days')
    ORDER BY created_at DESC LIMIT :limit
  `).all({ days, limit });
}

export function getTopRaisedFounders(limit = 3) {
  return db.prepare(`
    SELECT * FROM founders WHERE raised_amount > 0
    ORDER BY raised_amount DESC LIMIT :limit
  `).all({ limit });
}

export function getStealthFounders(limit = 3) {
  return db.prepare(`
    SELECT * FROM founders WHERE is_stealth = 1
    ORDER BY created_at DESC LIMIT :limit
  `).all({ limit });
}

export function searchFounders({ search, sector, stage, source, sort, limit = 100, offset = 0, watchlistOnly = false }) {
  const conditions = [];
  const params = {};

  if (search) {
    conditions.push(`(
      LOWER(name) LIKE '%' || LOWER(:search) || '%' OR
      LOWER(company) LIKE '%' || LOWER(:search) || '%' OR
      LOWER(description) LIKE '%' || LOWER(:search) || '%' OR
      LOWER(sector) LIKE '%' || LOWER(:search) || '%' OR
      LOWER(role) LIKE '%' || LOWER(:search) || '%'
    )`);
    params.search = search;
  }
  if (sector && sector !== 'all') {
    conditions.push('sector = :sector');
    params.sector = sector;
  }
  if (stage && stage !== 'all') {
    conditions.push('stage = :stage');
    params.stage = stage;
  }
  if (source && source !== 'all') {
    conditions.push('source = :source');
    params.source = source;
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  // Single watchlist join: INNER when filtering by watchlist, LEFT otherwise
  const joinClause = watchlistOnly
    ? 'INNER JOIN watchlist w ON w.founder_id = founders.id'
    : 'LEFT JOIN watchlist w ON w.founder_id = founders.id';

  let orderBy;
  switch (sort) {
    case 'amount':  orderBy = 'raised_amount DESC'; break;
    case 'name':    orderBy = 'name ASC'; break;
    case 'updated': orderBy = 'updated_at DESC'; break;
    case 'recent':
    default:        orderBy = 'funded_date DESC'; break;
  }

  const countSql = `SELECT COUNT(*) as total FROM founders ${joinClause} ${where}`;
  const { total } = db.prepare(countSql).get(params);

  const sql = `
    SELECT founders.*,
           CASE WHEN w.founder_id IS NOT NULL THEN 1 ELSE 0 END as is_watchlisted
    FROM founders
    ${joinClause}
    ${where}
    ORDER BY ${orderBy}
    LIMIT :limit OFFSET :offset
  `;
  params.limit = limit;
  params.offset = offset;

  const rows = db.prepare(sql).all(params);
  return { total, founders: rows };
}

export function upsertFounder(founder) {
  const raisedAmount = parseRaisedAmount(founder.raised);

  // Check for existing by name + company (dedup key)
  const existing = db.prepare(
    'SELECT id, confidence_score, source FROM founders WHERE name = :name AND company = :company'
  ).get({ name: founder.name, company: founder.company });

  if (existing) {
    // Update confidence if seen from another source
    let newConfidence = existing.confidence_score;
    if (founder.source !== existing.source) {
      newConfidence = Math.min(0.95, existing.confidence_score + 0.2);
    }
    db.prepare(`
      UPDATE founders SET
        role = COALESCE(:role, role),
        description = COALESCE(:description, description),
        sector = COALESCE(:sector, sector),
        stage = COALESCE(:stage, stage),
        raised = COALESCE(:raised, raised),
        raised_amount = CASE WHEN :raised_amount > raised_amount THEN :raised_amount ELSE raised_amount END,
        linkedin_url = COALESCE(:linkedin_url, linkedin_url),
        website = COALESCE(:website, website),
        github_url = COALESCE(:github_url, github_url),
        avatar_url = COALESCE(:avatar_url, avatar_url),
        funded_date = COALESCE(:funded_date, funded_date),
        is_stealth = :is_stealth,
        confidence_score = :confidence_score,
        updated_at = datetime('now')
      WHERE id = :id
    `).run({
      id: existing.id,
      role: founder.role || null,
      description: founder.description || null,
      sector: founder.sector || null,
      stage: founder.stage || null,
      raised: founder.raised || null,
      raised_amount: raisedAmount,
      linkedin_url: founder.linkedin_url || null,
      website: founder.website || null,
      github_url: founder.github_url || null,
      avatar_url: founder.avatar_url || null,
      funded_date: founder.funded_date || null,
      is_stealth: founder.is_stealth ? 1 : 0,
      confidence_score: newConfidence,
    });
    return { action: 'updated', id: existing.id };
  }

  const result = db.prepare(`
    INSERT INTO founders (name, role, company, description, sector, stage, raised, raised_amount,
      location, linkedin_url, website, github_url, avatar_url, source, funded_date, is_stealth, confidence_score)
    VALUES (:name, :role, :company, :description, :sector, :stage, :raised, :raised_amount,
      :location, :linkedin_url, :website, :github_url, :avatar_url, :source, :funded_date, :is_stealth, :confidence_score)
  `).run({
    name: founder.name,
    role: founder.role || 'Founder',
    company: founder.company || '',
    description: founder.description || '',
    sector: founder.sector || '',
    stage: founder.stage || '',
    raised: founder.raised || '',
    raised_amount: raisedAmount,
    location: founder.location || 'New York, NY',
    linkedin_url: founder.linkedin_url || null,
    website: founder.website || null,
    github_url: founder.github_url || null,
    avatar_url: founder.avatar_url || null,
    source: founder.source || 'unknown',
    funded_date: founder.funded_date || null,
    is_stealth: founder.is_stealth ? 1 : 0,
    confidence_score: founder.confidence_score || 0.5,
  });
  return { action: 'inserted', id: result.lastInsertRowid };
}

export function getStats() {
  const bySector = db.prepare(
    'SELECT sector, COUNT(*) as count FROM founders GROUP BY sector ORDER BY count DESC'
  ).all();
  const byStage = db.prepare(
    'SELECT stage, COUNT(*) as count FROM founders GROUP BY stage ORDER BY count DESC'
  ).all();
  const bySource = db.prepare(
    'SELECT source, COUNT(*) as count FROM founders GROUP BY source ORDER BY count DESC'
  ).all();
  const total = getFounderCount();
  const stealthCount = db.prepare('SELECT COUNT(*) as count FROM founders WHERE is_stealth = 1').get().count;
  const watchlistCount = db.prepare('SELECT COUNT(*) as count FROM watchlist').get().count;

  return { total, stealthCount, watchlistCount, bySector, byStage, bySource };
}

// ── Watchlist ──

export function addToWatchlist(founderId) {
  try {
    db.prepare('INSERT OR IGNORE INTO watchlist (founder_id) VALUES (:id)').run({ id: founderId });
    return true;
  } catch {
    return false;
  }
}

export function removeFromWatchlist(founderId) {
  db.prepare('DELETE FROM watchlist WHERE founder_id = :id').run({ id: founderId });
  return true;
}

export function getWatchlistIds() {
  return db.prepare('SELECT founder_id FROM watchlist').all().map(r => r.founder_id);
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
