const express = require("express");
const morgan = require("morgan");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();

app.use(morgan("dev"));

app.use(
  "/redis/",
  createProxyMiddleware({
    target: "http://redis-commander:80",
    changeOrigin: true,
  })
);

app.use(
  "/bullmq",
  createProxyMiddleware({
    target: "http://bull-board:80/",
    changeOrigin: true,
  })
);

app.listen(80);
