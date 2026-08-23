const path = require('path');
const fs = require('fs');

function loadConfig() {
  // Load .env with a couple of sensible fallbacks.
  // Safe even if .env doesn't exist (dotenv will just do nothing)
  const candidates = [
    path.join(process.cwd(), '.env'),
    // When node is started from the repository root, resolve the gateway .env
    path.join(__dirname, '..', '..', '.env'),
    // When node is started from the backend package, resolve the repo root .env
    path.join(__dirname, '..', '..', '..', '..', '..', '.env')
  ];

  // eslint-disable-next-line global-require
  const dotenv = require('dotenv');

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      dotenv.config({ path: p });
      return;
    }
  }

  // Fall back to default behavior (current working directory)
  dotenv.config();
}

module.exports = { loadConfig };
