require("dotenv").config();

const models = [
  "llama-3.1-405b-reasoning",
  "llama-3.1-70b-versatile",
  "llama-3.1-8b-instant",
  "mixtral-8x7b-32768",
  "llama3-70b-8192",
  "llama3-8b-8192"
];

async function testModel(model) {
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 5,
      }),
    });
    const data = await res.json();
    if (data.choices) {
      console.log(`✓ ${model}`);
      return true;
    } else if (data.error?.message?.includes("decommissioned")) {
      console.log(`✗ ${model} - decommissioned`);
    } else {
      console.log(`✗ ${model} - ${data.error?.message?.slice(0, 50) || 'unknown error'}`);
    }
  } catch (e) {
    console.log(`✗ ${model} - ${e.message}`);
  }
}

(async () => {
  for (const model of models) {
    await testModel(model);
  }
})();
