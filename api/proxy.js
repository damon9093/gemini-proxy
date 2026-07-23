export default async function handler(req, res) {
  console.log('METHOD:', req.method);
  console.log('URL:', req.url);
  console.log('BODY:', JSON.stringify(req.body));

  const targetUrl = 'https://generativelanguage.googleapis.com' + req.url;

  const headers = {};
  if (req.headers['content-type']) 
    headers['content-type'] = req.headers['content-type'];
  if (req.headers['authorization']) 
    headers['authorization'] = req.headers['authorization'];
  if (req.headers['x-goog-api-key']) 
    headers['x-goog-api-key'] = req.headers['x-goog-api-key'];

  let body = undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = JSON.stringify(req.body);
  }

  const response = await fetch(targetUrl, {
    method: req.method,
    headers,
    body,
  });

  const data = await response.json();
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  
  res.status(response.status).json(data);
}