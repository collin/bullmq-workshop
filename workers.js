const { Worker } = require("bullmq");
const { redisConnection } = require("./redisConnection");

module.exports.sayHelloWorker = new Worker(
  "say-hello",
  async (job) => {
    if (job.data.crash) {
      throw new Error("Crashed on purpose");
    }
    await job.log("Hello from job logger");
    return "Hello returned";
  },
  { connection: redisConnection }
);

