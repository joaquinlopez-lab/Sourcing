import db from './connection.js';

export function upsertNewsItem(item) {
  return db.prepare(`
    INSERT OR IGNORE INTO govtech_news (title, url, source_name, source_type, summary, category, published_at, image_url)
    VALUES (:title, :url, :source_name, :source_type, :summary, :category, :published_at, :image_url)
  `).run({
    title: item.title,
    url: item.url,
    source_name: item.source_name,
    source_type: item.source_type || 'rss',
    summary: item.summary || null,
    category: item.category || 'general',
    published_at: item.published_at || null,
    image_url: item.image_url || null,
  });
}

export function searchNews({ category, search, source_type, exclude_type, limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const params = {};

  if (category && category !== 'all') {
    conditions.push('category = :category');
    params.category = category;
  }
  if (source_type) {
    conditions.push('source_type = :source_type');
    params.source_type = source_type;
  }
  if (exclude_type) {
    conditions.push('source_type != :exclude_type');
    params.exclude_type = exclude_type;
  }
  if (search) {
    conditions.push(`(
      LOWER(title) LIKE '%' || LOWER(:search) || '%' OR
      LOWER(summary) LIKE '%' || LOWER(:search) || '%' OR
      LOWER(source_name) LIKE '%' || LOWER(:search) || '%'
    )`);
    params.search = search;
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const { total } = db.prepare(`SELECT COUNT(*) as total FROM govtech_news ${where}`).get(params);

  params.limit = Math.min(limit, 200);
  params.offset = offset;

  const items = db.prepare(`
    SELECT * FROM govtech_news ${where}
    ORDER BY published_at DESC
    LIMIT :limit OFFSET :offset
  `).all(params);

  return { total, items };
}

export function getRecentNews(limit = 5) {
  return db.prepare(
    "SELECT * FROM govtech_news ORDER BY published_at DESC LIMIT :limit"
  ).all({ limit });
}

export function getNewsHighlights(hours = 24, limit = 6) {
  return db.prepare(`
    SELECT * FROM govtech_news
    WHERE published_at >= datetime('now', '-' || :hours || ' hours')
    ORDER BY published_at DESC
    LIMIT :limit
  `).all({ hours, limit });
}

export function getNewsCount() {
  return db.prepare('SELECT COUNT(*) as count FROM govtech_news').get().count;
}

export function cleanOldNews(days = 90) {
  const result = db.prepare(
    "DELETE FROM govtech_news WHERE fetched_at < datetime('now', '-' || :days || ' days')"
  ).run({ days });
  return result.changes;
}
