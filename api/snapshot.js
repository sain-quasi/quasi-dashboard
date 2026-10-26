// Quasi dashboard — team snapshot endpoint (Vercel serverless function, stored in Vercel Blob).
//   GET  /api/snapshot            -> { ok, teamSnapshot, publishedAt, publishedBy }
//   GET  /api/snapshot?meta=1     -> { ok, publishedAt, publishedBy }   (cheap check used for auto-refresh)
//   POST /api/snapshot            -> body { by, snapshot }; stores it. If the PUBLISH_KEY env var is set,
//                                    the request must carry it in the x-publish-key header.
// Needs a Vercel Blob store connected to the project (sets BLOB_READ_WRITE_TOKEN automatically).
const { put, list } = require('@vercel/blob');

const PATHNAME = 'quasi/team-snapshot.json';
const MAX_BYTES = 3.5 * 1024 * 1024; // Vercel functions accept ~4.5 MB bodies

async function readStored() {
  const { blobs } = await list({ prefix: PATHNAME, limit: 5 });
  const hit = blobs.find(b => b.pathname === PATHNAME);
  if (!hit) return null;
  const r = await fetch(hit.url + (hit.url.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error('Stored snapshot could not be read (HTTP ' + r.status + ')');
  return r.json();
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      const data = await readStored();
      const publishedAt = data && data.snapshot && data.snapshot.publishedAt || null;
      const publishedBy = data && data.by || '';
      if (req.query && req.query.meta) return res.status(200).json({ ok: true, publishedAt, publishedBy });
      return res.status(200).json({ ok: true, teamSnapshot: data ? data.snapshot : null, publishedAt, publishedBy });
    }
    if (req.method === 'POST') {
      const need = process.env.PUBLISH_KEY;
      if (need && req.headers['x-publish-key'] !== need) return res.status(401).json({ ok: false, error: 'Wrong or missing publish key' });
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
      if (!body || typeof body.snapshot !== 'object' || !body.snapshot || !body.snapshot.publishedAt) {
        return res.status(400).json({ ok: false, error: 'Body must be { by, snapshot } with snapshot.publishedAt' });
      }
      const json = JSON.stringify({ by: String(body.by || '').slice(0, 80), snapshot: body.snapshot });
      if (Buffer.byteLength(json) > MAX_BYTES) return res.status(413).json({ ok: false, error: 'Snapshot is too large' });
      await put(PATHNAME, json, {
        access: 'public', addRandomSuffix: false, allowOverwrite: true,
        contentType: 'application/json', cacheControlMaxAge: 60,
      });
      return res.status(200).json({ ok: true });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err && err.message || err) });
  }
};
