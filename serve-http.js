const fs = require("fs");
const express = require("express");
const morgan = require("morgan");
const YAML = require("yaml");

const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();
app.use(morgan("dev"));

console.log(process.cwd());
const { services } = YAML.parse(
  fs.readFileSync("/workspace/.devcontainer/docker-compose.yml", "utf-8")
);

for (const [name, service] of Object.entries(services)) {
  const proxyPath = service.labels?.["org.example.proxyPath"];
  if (proxyPath) {
    console.log("Proxying", proxyPath, `http://${name}:80`);
    app.use(
      proxyPath,
      createProxyMiddleware({
        target: `http://${name}:80`,
        ws: true,
        secure: false,
        changeOrigin: true,
        headers: { Connection: "keep-alive" },
      })
    );
  }
}

app.listen(80);
