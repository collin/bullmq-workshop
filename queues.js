const { Queue } = require("bullmq");
const { redisConnection } = require("./redisConnection");

module.exports.sayHelloQueue = new Queue("say-hello", { connection: redisConnection, sharedConnection: true });

module.exports.allQueues = [this.sayHelloQueue];

Object.assign(global, module.exports);
