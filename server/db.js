const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

function ensureDb(){
  if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if(!fs.existsSync(DB_FILE)){
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], apiKeys: [], sessions: [] }, null, 2));
  }
}
ensureDb();

function readDb(){
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}
function writeDb(data){
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  const MAX_ATTEMPTS = 5;
  for(let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++){
    try{
      fs.renameSync(tmp, DB_FILE);
      return;
    }catch(err){
      const retryable = err.code === "EPERM" || err.code === "EBUSY" || err.code === "EACCES";
      if(!retryable || attempt === MAX_ATTEMPTS){
        try{ fs.unlinkSync(tmp); }catch(e){}
        throw err;
      }
      const waitUntil = Date.now() + attempt * 50;
      while(Date.now() < waitUntil){}
    }
  }
}

function uid(){ return crypto.randomBytes(12).toString("hex"); }

function createUser(email, passwordHash){
  const db = readDb();
  if(db.users.some(u => u.email.toLowerCase() === email.toLowerCase())){
    throw new Error("An account with that email already exists.");
  }
  const user = { id: uid(), email, passwordHash, createdAt: Date.now() };
  db.users.push(user);
  writeDb(db);
  return user;
}
function getUserByEmail(email){
  const db = readDb();
  return db.users.find(u => u.email.toLowerCase() === email.toLowerCase()) || null;
}
function getUserById(id){
  const db = readDb();
  return db.users.find(u => u.id === id) || null;
}

function getApiKeysRecord(userId){
  const db = readDb();
  return db.apiKeys.find(k => k.userId === userId) || null;
}
function upsertApiKeys(userId, patch){
  const db = readDb();
  let rec = db.apiKeys.find(k => k.userId === userId);
  if(!rec){
    rec = { userId, claudeKeyEnc: null, geminiKeyEnc: null, updatedAt: Date.now() };
    db.apiKeys.push(rec);
  }
  Object.assign(rec, patch, { updatedAt: Date.now() });
  writeDb(db);
  return rec;
}
function deleteApiKey(userId, which){
  const db = readDb();
  const rec = db.apiKeys.find(k => k.userId === userId);
  if(!rec) return;
  if(which === "claude") rec.claudeKeyEnc = null;
  if(which === "gemini") rec.geminiKeyEnc = null;
  if(which === "groq") rec.groqKeyEnc = null;
  rec.updatedAt = Date.now();
  writeDb(db);
}

function getUserKeys(userId){
  const record = getApiKeysRecord(userId);
  if(!record) return {};
  return {
    claudeKey: record.claudeKey || record.claudeKeyEnc || null,
    googleKey: record.googleKey || record.geminiKeyEnc || null,
    groqKey: record.groqKey || record.groqKeyEnc || null,
    workspaceId: record.workspaceId || record.claudeWorkspaceId || null,
  };
}

function saveUserKeys(userId, patch){
  return upsertApiKeys(userId, patch);
}

function deleteUserKey(userId, which){
  return deleteApiKey(userId, which);
}

function listSessions(userId){
  const db = readDb();
  return db.sessions
    .filter(s => s.userId === userId)
    .map(s => ({
      id: s.id,
      name: s.name,
      updatedAt: s.updatedAt,
      turnCount: (s.turns?.length || 0) + (s.dialogue?.length || 0),
    }))
    .sort((a,b) => b.updatedAt - a.updatedAt);
}
function getSession(userId, id){
  const db = readDb();
  return db.sessions.find(s => s.userId === userId && s.id === id) || null;
}
function createSession(userId, name){
  const db = readDb();
  const session = {
    id: uid(), userId, name: name || "Session",
    turns: [], dialogue: [], settings: {},
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  db.sessions.push(session);
  writeDb(db);
  return session;
}
function updateSession(userId, id, patch){
  const db = readDb();
  const session = db.sessions.find(s => s.userId === userId && s.id === id);
  if(!session) return null;
  Object.assign(session, patch, { updatedAt: Date.now() });
  writeDb(db);
  return session;
}
function deleteSession(userId, id){
  const db = readDb();
  const before = db.sessions.length;
  db.sessions = db.sessions.filter(s => !(s.userId === userId && s.id === id));
  writeDb(db);
  return db.sessions.length < before;
}

module.exports = {
  createUser, getUserByEmail, getUserById,
  getApiKeysRecord, upsertApiKeys, deleteApiKey,
  getUserKeys, saveUserKeys, deleteUserKey,
  listSessions, getSession, createSession, updateSession, deleteSession,
};
