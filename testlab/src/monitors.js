// Prints the test monitors as JSON, to pipe into the backend's importer:
//   docker compose exec -T testlab node src/monitors.js | docker compose exec -T api node dist/cli/importMonitors.js <email>
import { monitorList } from './catalogue.js';
import { loadConfig } from './config.js';

const { publicUrl, password } = loadConfig();
process.stdout.write(JSON.stringify(monitorList(publicUrl, password)));
