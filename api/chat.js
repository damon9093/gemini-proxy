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

    const apiKey = req.headers['authorization']?.replace('Bearer ', '');
    if (!apiKey) return res.status(401).json({ error: 'No API key' });
    if (!rawBody) return res.status(400).json({ error: 'Empty body' });

    const body = JSON.parse(rawBody);
    const { model, messages, temperature, max_tokens, stream } = body;
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

    if (stream) {
      // Streaming mode
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:streamGenerateContent?alt=sse&key=${apiKey}`;

      const response = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiBody),
      });

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          try {
            const chunk = JSON.parse(jsonStr);
            const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const finishReason = chunk.candidates?.[0]?.finishReason;

            if (text) {
              const sseData = {
                id: 'chatcmpl-' + Date.now(),
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: geminiModel,
                choices: [{
                  index: 0,
                  delta: { role: 'assistant', content: text },
                  finish_reason: null
                }]
              };
              res.write(`data: ${JSON.stringify(sseData)}\n\n`);
            }

            if (finishReason === 'STOP') {
              const finalData = {
                id: 'chatcmpl-' + Date.now(),
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: geminiModel,
                choices: [{
                  index: 0,
                  delta: {},
                  finish_reason: 'stop'
                }]
              };
              res.write(`data: ${JSON.stringify(finalData)}\n\n`);
              res.write('data: [DONE]\n\n');
            }
          } catch (e) {
            // skip invalid JSON
          }
        }
      }

      return res.end();

    } else {
      // Non-streaming mode
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;

      const response = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiBody),
      });

      const responseText = await response.text();
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
    }

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}