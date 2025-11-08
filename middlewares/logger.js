export function logRequestResponse(req, res, next) {
  console.log(`\n=== [${req.method}] ${req.originalUrl} ===`);

  // Log request body
  if (req.body && Object.keys(req.body).length > 0)
    console.log('🟦 Request Body:', req.body);
  else
    console.log('🟦 Request Body: <empty>');

  // Monkey patch res.send to capture response
  const oldSend = res.send;
  res.send = function (body) {
    try {
      const contentType = res.get('Content-Type');
      if (contentType && contentType.includes('application/json')) {
        console.log('🟩 Response Body:', JSON.parse(body));
      } else {
        console.log('🟩 Response Body:', body);
      }
    } catch (err) {
      console.log('🟩 Response Body:', body);
    }

    return oldSend.apply(res, arguments);
  };

  next();
}