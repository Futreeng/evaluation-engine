const crypto = require("crypto");

// Derives a stable 32-byte key from whatever ENCRYPTION_KEY the operator set,
// so the env var can be a plain passphrase rather than requiring exact hex.
function deriveKey(secret){
  return crypto.createHash("sha256").update(String(secret)).digest();
}

function encrypt(plaintext, secret){
  if(plaintext == null) return null;
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Pack iv + authTag + ciphertext into one base64 blob.
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

function decrypt(blob, secret){
  if(!blob) return null;
  const key = deriveKey(secret);
  const raw = Buffer.from(blob, "base64");
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

module.exports = { encrypt, decrypt };
