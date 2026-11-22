import { createLab } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const server = createLab(config).listen(config.port, () => console.log(`Test lab listening on ${config.port}`));

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
  });
}
