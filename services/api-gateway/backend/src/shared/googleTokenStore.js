const fs = require('fs/promises');
const path = require('path');

function getTokenFilePath() {
  const configured = process.env.GOOGLE_TOKEN_PATH;
  if (configured && String(configured).trim() !== '') return String(configured).trim();
  // Default: backend root
  return path.join(process.cwd(), '.google_tokens.json');
}

async function readTokens() {
  const filePath = getTokenFilePath();
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return null;
    throw err;
  }
}

async function writeTokens(tokens) {
  const filePath = getTokenFilePath();
  const payload = JSON.stringify(tokens, null, 2);
  await fs.writeFile(filePath, payload, 'utf8');
}

async function clearTokens() {
  const filePath = getTokenFilePath();
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if (err && err.code === 'ENOENT') return;
    throw err;
  }
}

module.exports = {
  getTokenFilePath,
  readTokens,
  writeTokens,
  clearTokens
};
