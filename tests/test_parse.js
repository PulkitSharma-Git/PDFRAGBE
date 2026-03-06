import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

(async () => {
    try {
        const fileBuffer = fs.readFileSync('/tmp/real_dummy2.pdf');
        console.log("Buffer Length:", fileBuffer.length);
        const data = await pdfParse(fileBuffer);
        console.log("Success! Parsed text:", data.text);
    } catch (err) {
        console.error("Parse error:", err);
    }
})();
