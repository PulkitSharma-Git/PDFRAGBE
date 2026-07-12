import dotenv from "dotenv";
dotenv.config({ override: true });

let redisConnection;

if (process.env.REDIS_HOST) {
    if (process.env.REDIS_HOST.startsWith('redis://') || process.env.REDIS_HOST.startsWith('rediss://')) {
        const parsed = new URL(process.env.REDIS_HOST);
        redisConnection = {
            host: parsed.hostname,
            port: parsed.port ? parseInt(parsed.port) : 6379,
            username: parsed.username || undefined,
            password: parsed.password || undefined,
            tls: process.env.REDIS_TLS === "true" || process.env.REDIS_HOST.startsWith('rediss://') ? {} : undefined,
            maxRetriesPerRequest: null,
        };
    } else {
        redisConnection = {
            host: process.env.REDIS_HOST || "localhost",
            port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT) : 6379,
            password: process.env.REDIS_PASSWORD || undefined,
            tls: process.env.REDIS_TLS === "true" ? {} : undefined,
            maxRetriesPerRequest: null,
        };
    }
} else {
    redisConnection = {
        host: "localhost",
        port: 6379,
        maxRetriesPerRequest: null,
    };
}

export default redisConnection;