require("dotenv").config();

const key = process.env.GEMINI_API_KEY;

fetch(`https://generativelanguage.googleapis.com/v1/models?key=${encodeURIComponent(key)}`)
  .then(r => r.json())
  .then(d => {
    if (d.models) {
      console.log("Available models:");
      d.models.slice(0, 10).forEach(m => console.log("-", m.name));
    } else {
      console.log("Error:", d.error?.message || JSON.stringify(d).slice(0, 200));
    }
  })
  .catch(e => console.log("Network error:", e.message));
