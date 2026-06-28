const http = require("http");

const PORT = process.env.PORT || 3000;

const routes = {
  "/health": (res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }),
    );
  },
  "/hello": (res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Good afternoon, World!" }));
  },
};

const server = http.createServer((req, res) => {
  const handler = routes[req.url];
  const timestamp = new Date().toISOString();
  if (handler) {
    console.log(`[${timestamp}] ${req.method} ${req.url} - 200`);
    handler(res);
  } else {
    console.log(`[${timestamp}] ${req.method} ${req.url} - 404`);
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not Found" }));
  }
});

throw new Error("Random Errors");
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
