import * as dotenv from 'dotenv';
dotenv.config();

async function test() {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=" + process.env.GEMINI_API_KEY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: "models/gemini-embedding-001",
            content: { parts: [{ text: "Hello" }] }
        })
    });
    console.log(response.status);
    console.log(await response.json());
}
test();
