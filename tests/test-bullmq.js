import { Queue } from "bullmq";
const queue = new Queue("file-upload-queue", { connection: { host: "localhost", port: 6379 } });
async function check() {
  console.log("Waiting:", await queue.getWaitingCount());
  console.log("Active:", await queue.getActiveCount());
  console.log("Failed:", await queue.getFailedCount());
  console.log("Completed:", await queue.getCompletedCount());
  process.exit(0);
}
check();
