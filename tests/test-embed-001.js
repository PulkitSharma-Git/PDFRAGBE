import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import * as dotenv from 'dotenv';
dotenv.config();

async function test() {
    try {
        const e = new GoogleGenerativeAIEmbeddings({
            model: "embedding-001",
            apiKey: process.env.GEMINI_API_KEY || ""
        });
        const res = await e.embedQuery("hello world");
        console.log("Success with embedding-001:", res.length);
    } catch(err) {
        console.log("Error:", err.message);
    }
}
test();
