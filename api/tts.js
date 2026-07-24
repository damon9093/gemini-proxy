export const config = {
  api: { bodyParser: false },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const rawBody = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => { data += chunk; });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });

    const apiKey = req.query.key || req.headers['x-goog-api-key'];
    if (!apiKey) return res.status(401).json({ error: 'No API key' });

    // مدل TTS رو به نسخه درست تغییر بده
    let targetPath = req.url;
    targetPath = targetPath.replace(
      'gemini-2.5-flash-preview-tts',
      'gemini-3.1-flash-tts-preview'
    );

    const targetUrl = `https://generativelanguage.googleapis.com${targetPath}`;

    console.log('TTS URL:', targetUrl);

    const response = await fetch(targetUrl, {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
      body: rawBody || undefined,
    });

    console.log('TTS Status:', response.status);

    const contentType = response.headers.get('content-type') || 'application/json';
    res.setHeader('Content-Type', contentType);
    res.status(response.status);

    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    return res.end();

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}