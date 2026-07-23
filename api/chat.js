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

    console.log('RAW BODY:', rawBody);

    const apiKey = req.headers['authorization']?.replace('Bearer ', '');
    if (!apiKey) return res.status(401).json({ error: 'No API key' });
    if (!rawBody) return res.status(400).json({ error: 'Empty body' });

    const body = JSON.parse(rawBody);
    const { model, messages, temperature, max_tokens } = body;
    const geminiModel = (model && model.includes('gemini')) ? model : 'gemini-3.5-flash';

    const systemMsg = messages.find(m => m.role === 'system');
    const otherMessages = messages.filter(m => m.role !== 'system');

    const geminiBody = {
      contents: otherMessages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }]
      })),
      generationConfig: {
        temperature: temperature || 0.7,
        maxOutputTokens: max_tokens || 8192,
      }
    };

    if (systemMsg) {
      geminiBody.systemInstruction = { parts: [{ text: systemMsg.content }] };
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;

    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiBody),
    });

    const responseText = await response.text();
    console.log('GEMINI RAW:', response.status, responseText.slice(0, 500));

    let data;
    try {
      data = JSON.parse(responseText);
    } catch(e) {
      return res.status(500).json({ error: 'Invalid JSON from Google', raw: responseText.slice(0, 200) });
    }

    if (!response.ok) return res.status(response.status).json(data);

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    return res.status(200).json({
      id: 'chatcmpl-' + Date.now(),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: geminiModel,
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: data.usageMetadata?.promptTokenCount || 0,
        completion_tokens: data.usageMetadata?.candidatesTokenCount || 0,
        total_tokens: data.usageMetadata?.totalTokenCount || 0,
      }
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}