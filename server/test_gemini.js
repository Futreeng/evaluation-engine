require("dotenv").config();

const key = process.env.GEMINI_API_KEY;

// Try with older gemini-pro model
fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent?key=${encodeURIComponent(key)}`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    contents: [{ role: "user", parts: [{ text: "Say 'Gemini works' in 2 words exactly" }] }],
  }),
})
  .then(r => r.json())
  .then(d => {
    if (d.candidates?.[0]?.content?.parts?.[0]?.text) {
      console.log("✓ Gemini works! Response:", d.candidates[0].content.parts[0].text);
    } else if (d.error?.message) {
      console.log("✗ Gemini error:", d.error.message);
    } else {
      console.log("✗ Unexpected:", JSON.stringify(d).slice(0, 300));
    }
  })
  .catch(e => console.log("✗ Network error:", e.message));
