require("dotenv").config();

console.log("Testing Groq API directly...");
console.log("Key exists:", !!process.env.GROQ_API_KEY);

fetch("https://api.groq.com/openai/v1/chat/completions", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "authorization": `Bearer ${process.env.GROQ_API_KEY}`,
  },
  body: JSON.stringify({
    model: "groq/compound",
    messages: [
      { role: "system", content: "You are helpful" },
      { role: "user", content: "Say 'Groq works'" },
    ],
    max_tokens: 20,
  }),
})
  .then(r => r.json())
  .then(d => {
    if (d.choices?.[0]?.message?.content) {
      console.log("✓ SUCCESS:", d.choices[0].message.content);
    } else if (d.error) {
      console.log("✗ ERROR:", d.error.code, "-", d.error.message);
    } else {
      console.log("✗ UNEXPECTED:", JSON.stringify(d).slice(0, 300));
    }
  })
  .catch(e => console.log("✗ NETWORK:", e.message));
