require("dotenv").config();

const key = process.env.GEMINI_API_KEY;

const models = [
  "gemini-3.6-flash-lite",
  "gemini-3.5-flash",
  "gemini-pro"
];

async function testModel(model) {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "say hi" }] }],
      }),
    });
    const data = await res.json();
    if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
      console.log(`✓ ${model} works`);
      return true;
    } else if (data.error?.code === 503) {
      console.log(`⏳ ${model} - temporarily overloaded`);
    } else if (data.error?.message?.includes("no longer available")) {
      console.log(`✗ ${model} - deprecated`);
    } else {
      console.log(`✗ ${model} - ${data.error?.message?.slice(0, 60) || 'error'}`);
    }
  } catch (e) {
    console.log(`✗ ${model} - ${e.message}`);
  }
}

(async () => {
  for (const m of models) await testModel(m);
})();
