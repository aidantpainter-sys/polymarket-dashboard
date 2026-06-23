export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // POST = AI analysis request
  if (req.method === 'POST') {
    try {
      const { markets } = req.body;
      if (!markets || !markets.length) return res.status(400).json({ error: 'No markets provided' });

      const prompt = `You are an expert prediction market analyst. Analyze the following consensus trades from Polymarket's top 50 all-time traders and provide a confidence assessment for each.

For each market, consider:
1. How many top traders agree (out of 50 tracked)
2. The direction (YES/NO) and current market price
3. Whether the price has moved significantly since traders entered (suggesting smart money moved it)
4. The nature of the market (politics, sports, crypto, etc.) and how predictable it is

Markets to analyze:
${markets.map((m, i) => `
${i+1}. "${m.title}"
   - Direction: ${m.isBull ? 'YES' : 'NO'}
   - Traders agreeing: ${m.count} out of 50
   - Avg entry price: ${m.entryPct}¢
   - Current live price: ${m.livePct}¢
   - Price movement since entry: ${m.move > 0 ? '+' : ''}${m.move}¢
   - Closes: ${m.closes || 'unknown'}
`).join('')}

Respond ONLY with a valid JSON array, no markdown, no explanation, just the array. Each object must have:
- "index": number (1-based, matching the market number above)
- "confidence": string, one of: "Low", "Medium", "High", "Very High"
- "reasoning": string, 1-2 sentences max explaining the confidence level

Example format:
[{"index":1,"confidence":"High","reasoning":"5 top traders agree with strong position sizes. Price has moved 12¢ since entry suggesting smart money led the market."}]`;

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
        parsed = [];
      }
      return res.status(200).json(parsed);
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
