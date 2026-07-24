if (stream) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let doneSent = false;

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
        const part = chunk.candidates?.[0]?.content?.parts?.[0];
        const finishReason = chunk.candidates?.[0]?.finishReason;

        if (part?.functionCall) {
          const sseData = {
            id: 'chatcmpl-' + Date.now(),
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: geminiModel,
            choices: [{
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [{
                  index: 0,
                  id: 'call_' + Date.now(),
                  type: 'function',
                  function: {
                    name: part.functionCall.name,
                    arguments: JSON.stringify(part.functionCall.args)
                  }
                }]
              },
              finish_reason: null
            }]
          };
          res.write(`data: ${JSON.stringify(sseData)}\n\n`);
        } else if (part?.text) {
          const sseData = {
            id: 'chatcmpl-' + Date.now(),
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: geminiModel,
            choices: [{
              index: 0,
              delta: { role: 'assistant', content: part.text },
              finish_reason: null
            }]
          };
          res.write(`data: ${JSON.stringify(sseData)}\n\n`);
        }

        if (finishReason && !doneSent) {
          const fr = finishReason === 'FUNCTION_CALL' ? 'tool_calls' : 'stop';
          const finalData = {
            id: 'chatcmpl-' + Date.now(),
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: geminiModel,
            choices: [{ index: 0, delta: {}, finish_reason: fr }]
          };
          res.write(`data: ${JSON.stringify(finalData)}\n\n`);
          res.write('data: [DONE]\n\n');
          doneSent = true;
        }
      } catch (e) { /* skip */ }
    }
  }

  // fallback اگه [DONE] فرستاده نشده
  if (!doneSent) {
    const finalData = {
      id: 'chatcmpl-' + Date.now(),
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: geminiModel,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
    };
    res.write(`data: ${JSON.stringify(finalData)}\n\n`);
    res.write('data: [DONE]\n\n');
  }

  return res.end();
}