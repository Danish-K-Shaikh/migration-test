const http = require('http');

const PORT = process.env.PORT || 3000;

const routes = {
  '/health': (res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
  },
  '/hello': (res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Hello, World!' }));
  },
};

const server = http.createServer((req, res) => {
  const handler = routes[req.url];
  if (handler) {
    handler(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  }
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
