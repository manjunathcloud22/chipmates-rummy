const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const port = Number(process.env.PORT) || 4173;
const root = __dirname;
const games = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/api/games" && req.method === "POST") {
      const id = crypto.randomBytes(4).toString("hex");
      games.set(id, await readJson(req));
      return sendJson(res, 201, { id });
    }

    const gameMatch = url.pathname.match(/^\/api\/games\/([a-f0-9]{8})$/);
    if (gameMatch && req.method === "GET") {
      const game = games.get(gameMatch[1]);
      return game ? sendJson(res, 200, game) : sendJson(res, 404, { error: "Game not found" });
    }

    if (gameMatch && req.method === "PUT") {
      games.set(gameMatch[1], await readJson(req));
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname.startsWith("/api/")) {
      return sendJson(res, 404, { error: "Not found" });
    }

    const filePath = safePath(url.pathname);
    fs.readFile(filePath, (error, data) => {
      if (error) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }

      res.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
      res.end(data);
    });
  } catch (error) {
    sendJson(res, 500, { error: "Server error" });
  }
});

function safePath(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split("?")[0]);
  const requested = cleanPath === "/" ? "/index.html" : cleanPath;
  const resolved = path.resolve(root, `.${requested}`);
  if (!resolved.startsWith(root)) {
    return path.join(root, "index.html");
  }
  return resolved;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 200_000) {
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

server.listen(port, "0.0.0.0", () => {
  console.log(`Rummy Scorekeeper running at http://localhost:${port}`);
});
