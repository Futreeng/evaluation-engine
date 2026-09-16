require("dotenv").config();

console.log("Testing Groq API with llama3-8b-8192...");

fetch("https://api.groq.com/openai/v1/chat/completions", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "authorization": `Bearer ${process.env.GROQ_API_KEY}`,
  },
  body: JSON.stringify({
    model: "llama3-8b-8192",
    messages: [
      { role: "user", content: "Say 'Groq works' in 2 words exactly." },
    ],
    max_tokens: 20,
  }),
})
  .then(r => r.json())
  .then(d => {
    if (d.choices?.[0]?.message?.content) {
      console.log("✓ Groq works! Response:", d.choices[0].message.content);
      process.exit(0);
    } else {
      console.log("✗ Error:", d.error?.message || JSON.stringify(d).slice(0, 300));
      process.exit(1);
    }
  })
  .catch(e => {
    console.log("✗ Network error:", e.message);
    process.exit(1);
  });
