// Convergence Client
// Bridge between Growth Engine backend and Convergence dual-LLM app
// Can run Convergence as subprocess, HTTP client, or embedded

const fetch = require("node-fetch");

class ConvergenceClient {
  constructor(convergenceUrl = "http://localhost:3002") {
    this.convergenceUrl = convergenceUrl;
  }

  // Create a new Convergence session
  async createSession(userId, sessionId, mode = "audit") {
    console.log(`Creating Convergence session ${sessionId} (mode: ${mode})`);

    return {
      sessionId,
      userId,
      mode,
      status: "active",
      turns: [],
      createdAt: new Date().toISOString(),
    };
  }

  // Send a prompt to Convergence for dual analysis
  async sendPrompt(sessionId, prompt, options = {}) {
    const { mode = "parallel" } = options;

    console.log(`Sending prompt to Convergence session ${sessionId} (mode: ${mode})`);

    // Call Convergence API endpoint
    try {
      const response = await fetch(`${this.convergenceUrl}/api/sessions/${sessionId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          mode, // "parallel" | "sequential" | "dialogue"
          leftProvider: "anthropic",
          rightProvider: "gemini",
        }),
      });

      if (!response.ok) {
        throw new Error(`Convergence API error: ${response.status}`);
      }

      const result = await response.json();
      return result; // { claude: {...}, gemini: {...}, critique: ... }
    } catch (err) {
      console.error("Convergence API error:", err);
      // Fallback: if Convergence not available, return placeholder
      return {
        claude: { text: "Analysis pending", status: "error" },
        gemini: { text: "Analysis pending", status: "error" },
      };
    }
  }

  // Get session transcript
  async getSession(sessionId) {
    try {
      const response = await fetch(`${this.convergenceUrl}/api/sessions/${sessionId}`);
      if (!response.ok) throw new Error(`Session not found: ${sessionId}`);
      return await response.json();
    } catch (err) {
      console.error("Error fetching session:", err);
      return null;
    }
  }

  // Export session as JSON
  async exportSession(sessionId, format = "json") {
    try {
      const response = await fetch(
        `${this.convergenceUrl}/api/sessions/${sessionId}/export?format=${format}`
      );
      if (!response.ok) throw new Error("Export failed");
      return await response.buffer(); // Returns file buffer
    } catch (err) {
      console.error("Export error:", err);
      return null;
    }
  }
}

module.exports = ConvergenceClient;
