import dotenv from "dotenv";
dotenv.config();

let redisConnection;
if (process.env.REDIS_HOST && process.env.REDIS_HOST.startsWith('redis')) { // if cloud redis
    redisConnection = {
        url: process.env.REDIS_HOST,
        tls: process.env.REDIS_TLS === "true" ? {} : undefined,
    };
} else {
    redisConnection = { // if locally hosted redis
        host: process.env.REDIS_HOST || "localhost",
        port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT) : 6379,
        password: process.env.REDIS_PASSWORD || undefined,
        tls: process.env.REDIS_TLS === "true" ? {} : undefined,
    };
}

export default redisConnection;