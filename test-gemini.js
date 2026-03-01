import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import * as dotenv from 'dotenv';
dotenv.config();

async function test() {
    try {
        const llm = new ChatGoogleGenerativeAI({
            modelName: "gemini-2.5-flash",
            apiKey: process.env.GEMINI_API_KEY
        });
        const res = await llm.invoke("Hello");
        console.log("Success:", res.content);
    } catch(e) {
        console.error("Failed:", e);
    }
}
test();
