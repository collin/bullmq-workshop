#!/usr/bin/env node
const { createBullBoard } = require("@bull-board/api");
const { BullMQAdapter } = require("@bull-board/api/bullMQAdapter");
const { ExpressAdapter } = require("@bull-board/express");
const { Queue } = require("bullmq");
const express = require("express");
const morgan = require("morgan");

const app = express();
app.use(morgan("dev"));
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/bullmq");
app.use("/bullmq", serverAdapter.getRouter());

const connection = {
  host: "redis",
  port: 6379,
  password: undefined,
};

createBullBoard({
  queues: [new BullMQAdapter(new Queue("send-email", { connection }))],
  serverAdapter,
});

app.listen(80, () => {
  console.log("Bull board is running.");
});
