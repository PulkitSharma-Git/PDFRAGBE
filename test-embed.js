import { GoogleGenAI } from "@google/genai";
import * as dotenv from 'dotenv';
dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function run() {
    try {
        const response = await ai.models.embedContent({
            model: 'text-embedding-004',
            contents: 'Hello world',
        });
        console.log("Success! Embedding length:", response.embeddings[0].values.length);
    } catch(e) {
        console.error("Failed Native:", e);
    }
}
run();
