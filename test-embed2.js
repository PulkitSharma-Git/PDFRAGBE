import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import * as dotenv from 'dotenv';
dotenv.config();

const getEmbeddingsParams = () => {
    return new GoogleGenerativeAIEmbeddings({
        model: "text-embedding-004",
        taskType: "RETRIEVAL_QUERY", // We are querying now
        apiKey: process.env.GEMINI_API_KEY || ""
    });
};

async function test() {
    const ai = getEmbeddingsParams();
    try {
        const res = await ai.embedQuery("hello world");
        console.log("Success with text-embedding-004:", res.length);
    } catch(e) { console.log(e); }
}
test();
