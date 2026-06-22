export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { endpoint } = req.query;
  if (!endpoint) return res.status(400).json({ error: 'Missing endpoint param' });

  const allowed = [
    'https://data-api.polymarket.com/leaderboard',
    'https://data-api.polymarket.com/positions',
    'https://gamma-api.polymarket.com/markets',
  ];

  const base = endpoint.split('?')[0];
  if (!allowed.some(a => endpoint.startsWith(a))) {
    return res.status(403).json({ error: 'Endpoint not allowed' });
  }

  try {
    const upstream = await fetch(endpoint, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    });
    const data = await upstream.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
