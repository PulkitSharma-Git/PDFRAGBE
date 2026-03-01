import fetch from "node-fetch";

async function run() {
    const res = await fetch("http://localhost:8000/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: "What is the name of the company and when was it founded?" })
    });
    const data = await res.json();
    console.log(data);
}
run();
