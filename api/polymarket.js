export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Debug: confirm API key is present
  if (req.query.debug === '1') {
    return res.status(200).json({ hasKey: !!process.env.ANTHROPIC_API_KEY, keyPrefix: process.env.ANTHROPIC_API_KEY?.slice(0,10) });
  }

  // POST = AI analysis request
  if (req.method === 'POST') {
    try {
      const { markets } = req.body;
      if (!markets || !markets.length) return res.status(400).json({ error: 'No markets provided' });

      const m = markets[0];
      const prompt = `You are an expert prediction market analyst. Analyze this single consensus trade from Polymarket's top 50 all-time traders.

Market: "${m.title}"
- Direction: ${m.isBull ? 'YES' : 'NO'}
- Traders agreeing: ${m.count} out of 50
- Avg entry price: ${m.entryPct}¢
- Current live price: ${m.livePct}¢
- Price movement since entry: ${m.move > 0 ? '+' : ''}${m.move}¢
- Closes: ${m.closes || 'unknown'}

Consider: number of top traders agreeing, price movement since entry (smart money signal), and market predictability.

Respond ONLY with a single JSON object, no markdown:
{"confidence":"High","reasoning":"1-2 sentences explaining the rating."}`;

      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      const aiData = await aiRes.json();
      const text = aiData.content?.[0]?.text || '[]';
      let parsed;
      try {
        parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
      } catch {
        parsed = { confidence: 'Low', reasoning: 'Analysis unavailable.' };
      }
      return res.status(200).json([{ index: 1, ...parsed }]);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // GET = proxy to Polymarket APIs
  const { endpoint } = req.query;
  if (!endpoint) return res.status(400).json({ error: 'Missing endpoint param' });

  const allowed = [
    'https://data-api.polymarket.com/v1/leaderboard',
    'https://data-api.polymarket.com/v1/positions',
    'https://data-api.polymarket.com/positions',
    'https://gamma-api.polymarket.com/markets',
  ];

  if (!allowed.some(a => endpoint.startsWith(a))) {
    return res.status(403).json({ error: 'Endpoint not allowed', endpoint });
  }

  try {
    const upstream = await fetch(endpoint, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': 'https://polymarket.com',
        'Referer': 'https://polymarket.com/',
      }
    });

    const text = await upstream.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(502).json({ error: 'Non-JSON response', status: upstream.status, raw: text.slice(0, 500) });
    }
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
