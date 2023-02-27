#!/usr/bin/env node
const { createBullBoard } = require("@bull-board/api");
const { BullMQAdapter } = require("@bull-board/api/bullMQAdapter");
const { ExpressAdapter } = require("@bull-board/express");
const { Queue } = require("bullmq");
const express = require("express");
const morgan = require("morgan");
const { allQueues } = require("./queues");

const app = express();
app.use(morgan("dev"));

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath(process.env.BASE_PATH);
app.use(process.env.BASE_PATH, serverAdapter.getRouter());



createBullBoard({
  queues: allQueues.map((queue) => new BullMQAdapter(queue)),
  serverAdapter,
});

app.listen(80, () => {
  console.log("Bull board is running.");
});
