import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Flag rooms whose console stopped sending heartbeats.
crons.interval("mark rooms without signal", { seconds: 30 }, internal.sessions.markStale, {});

export default crons;
