
import * as dotenv from 'dotenv';
dotenv.config();

const url = `${process.env.QDRANT_URL}/collections/pdf_docs/index`;
const apiKey = process.env.QDRANT_API_KEY;

async function run() {
    const res = await fetch(url, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            "api-key": apiKey
        },
        body: JSON.stringify({
            field_name: "metadata.source_filename",
            field_schema: "keyword"
        })
    });
    console.log(`Status: ${res.status}`);
    console.log(`Response: ${await res.text()}`);
}
run();
