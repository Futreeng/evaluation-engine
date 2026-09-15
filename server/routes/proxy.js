const express = require("express");
const { Readable } = require("stream");
const { requireAuth } = require("../middleware/auth");
const db = require("../db");
const { decrypt } = require("../crypto");

const router = express.Router();
router.use(requireAuth);

function getDecryptedKeys(userId){
  const rec = db.getApiKeysRecord(userId);
  return {
    claudeKey: rec?.claudeKeyEnc ? decrypt(rec.claudeKeyEnc, process.env.ENCRYPTION_KEY) : null,
    claudeWorkspaceId: rec?.claudeWorkspaceId || null,
    geminiKey: rec?.geminiKeyEnc ? decrypt(rec.geminiKeyEnc, process.env.ENCRYPTION_KEY) : null,
    groqKey: rec?.groqKeyEnc ? decrypt(rec.groqKeyEnc, process.env.ENCRYPTION_KEY) : null,
  };
}

function pipeUpstream(upstream, res){
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const nodeStream = Readable.fromWeb(upstream.body);
  nodeStream.pipe(res);
  nodeStream.on("error", () => { try{ res.end(); }catch(e){} });
}

router.post("/claude/stream", async (req, res) => {
  const { claudeKey, claudeWorkspaceId } = getDecryptedKeys(req.user.id);
  if(!claudeKey) return res.status(400).json({ error: "No Claude API key saved for this account yet." });

  const { model, system, messages } = req.body || {};
  if(!model || !Array.isArray(messages)){
    return res.status(400).json({ error: "model and messages are required." });
  }

  const controller = new AbortController();
  req.on("close", () => controller.abort());

  try{
    const headers = {
      "content-type": "application/json",
      "x-api-key": claudeKey,
      "anthropic-version": "2023-06-01",
    };
    if(claudeWorkspaceId) headers["anthropic-workspace-id"] = claudeWorkspaceId;

    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers,
      body: JSON.stringify({ model, max_tokens: 4096, system: system || undefined, messages, stream: true }),
    });
    if(!upstream.ok || !upstream.body){
      const detail = await upstream.text().catch(() => "");
      return res.status(upstream.status || 502).json({ error: `Claude API error ${upstream.status}: ${detail.slice(0,400)}`, source: "upstream", provider: "claude" });
    }
    pipeUpstream(upstream, res);
  }catch(err){
    if(err.name === "AbortError") return;
    if(!res.headersSent) res.status(502).json({ error: err.message, source: "upstream", provider: "claude" });
    else try{ res.end(); }catch(e){}
  }
});

router.post("/gemini/stream", async (req, res) => {
  const { geminiKey } = getDecryptedKeys(req.user.id);
  if(!geminiKey) return res.status(400).json({ error: "No Gemini API key saved for this account yet." });

  const { model, systemInstruction, contents } = req.body || {};
  if(!model || !Array.isArray(contents)){
    return res.status(400).json({ error: "model and contents are required." });
  }

  const controller = new AbortController();
  req.on("close", () => controller.abort());

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(geminiKey)}`;
  const body = { contents };
  if(systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] };

  try{
    const upstream = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if(!upstream.ok || !upstream.body){
      const detail = await upstream.text().catch(() => "");
      return res.status(upstream.status || 502).json({ error: `Gemini API error ${upstream.status}: ${detail.slice(0,400)}`, source: "upstream", provider: "gemini" });
    }
    pipeUpstream(upstream, res);
  }catch(err){
    if(err.name === "AbortError") return;
    if(!res.headersSent) res.status(502).json({ error: err.message, source: "upstream", provider: "gemini" });
    else try{ res.end(); }catch(e){}
  }
});

router.post("/groq/stream", async (req, res) => {
  const { groqKey } = getDecryptedKeys(req.user.id);
  if(!groqKey) return res.status(400).json({ error: "No Groq API key saved for this account yet." });

  const { model, system, messages } = req.body || {};
  if(!model || !Array.isArray(messages)){
    return res.status(400).json({ error: "model and messages are required." });
  }

  // Groq's chat-completions API is OpenAI-compatible: system prompt is just
  // another message with role "system", prepended to the conversation.
  const groqMessages = system ? [{ role: "system", content: system }, ...messages] : messages;

  const controller = new AbortController();
  req.on("close", () => controller.abort());

  try{
    const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model,
        messages: groqMessages,
        stream: true,
        stream_options: { include_usage: true },
      }),
    });
    if(!upstream.ok || !upstream.body){
      const detail = await upstream.text().catch(() => "");
      return res.status(upstream.status || 502).json({ error: `Groq API error ${upstream.status}: ${detail.slice(0,400)}`, source: "upstream", provider: "groq" });
    }
    pipeUpstream(upstream, res);
  }catch(err){
    if(err.name === "AbortError") return;
    if(!res.headersSent) res.status(502).json({ error: err.message, source: "upstream", provider: "groq" });
    else try{ res.end(); }catch(e){}
  }
});

/* -------------------------------------------------------------- */
/* Model availability checks — list-models calls only (no tokens   */
/* spent, no actual generation) so the UI can verify a saved key   */
/* + selected model combination actually works before the person   */
/* tries to use it and hits an error mid-conversation.             */
/* -------------------------------------------------------------- */

router.get("/claude/models", async (req, res) => {
  const { claudeKey, claudeWorkspaceId } = getDecryptedKeys(req.user.id);
  if(!claudeKey) return res.status(400).json({ error: "No Claude API key saved for this account yet." });
  try{
    const headers = { "x-api-key": claudeKey, "anthropic-version": "2023-06-01" };
    if(claudeWorkspaceId) headers["anthropic-workspace-id"] = claudeWorkspaceId;
    const upstream = await fetch("https://api.anthropic.com/v1/models?limit=1000", { headers });
    const body = await upstream.json().catch(() => null);
    if(!upstream.ok){
      return res.status(upstream.status).json({ error: body?.error?.message || `Claude API error ${upstream.status}` });
    }
    res.json({ models: (body?.data || []).map(m => m.id) });
  }catch(err){
    res.status(502).json({ error: err.message });
  }
});

router.get("/gemini/models", async (req, res) => {
  const { geminiKey } = getDecryptedKeys(req.user.id);
  if(!geminiKey) return res.status(400).json({ error: "No Gemini API key saved for this account yet." });
  try{
    const upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(geminiKey)}`);
    const body = await upstream.json().catch(() => null);
    if(!upstream.ok){
      return res.status(upstream.status).json({ error: body?.error?.message || `Gemini API error ${upstream.status}` });
    }
    // names come back as "models/gemini-2.5-flash" — strip the prefix.
    res.json({ models: (body?.models || []).map(m => (m.name || "").replace(/^models\//, "")) });
  }catch(err){
    res.status(502).json({ error: err.message });
  }
});

router.get("/groq/models", async (req, res) => {
  const { groqKey } = getDecryptedKeys(req.user.id);
  if(!groqKey) return res.status(400).json({ error: "No Groq API key saved for this account yet." });
  try{
    const upstream = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { "authorization": `Bearer ${groqKey}` },
    });
    const body = await upstream.json().catch(() => null);
    if(!upstream.ok){
      return res.status(upstream.status).json({ error: body?.error?.message || `Groq API error ${upstream.status}` });
    }
    res.json({ models: (body?.data || []).map(m => m.id) });
  }catch(err){
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;