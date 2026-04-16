import {
  closeDatabaseConnection,
  connectDatabase,
  getDatabaseStatus,
  sequelize,
  syncDatabaseSchema
} from '../config/database.js';
import { initializeModels, modelRegistry } from '../models/index.js';

const args = new Set(process.argv.slice(2));

const printHelp = () => {
  console.log(`Usage:
  node utils/dbInit.js           Initialize models and sync schema
  node utils/dbInit.js --alter   Sync schema with alter mode
  node utils/dbInit.js --force   Recreate all tables
  node utils/dbInit.js --help    Show this help message`);
};

const main = async () => {
  if (args.has('--help')) {
    printHelp();
    return;
  }

  const force = args.has('--force');
  const alter = args.has('--alter');

  initializeModels();

  const database = await connectDatabase({ force: true });

  if (!database.connected) {
    throw new Error(database.errorMessage || 'Database connection is not available.');
  }

  await syncDatabaseSchema({ force, alter });

  const tables = await sequelize.getQueryInterface().showAllTables();

  console.log(
    `Database schema initialized successfully for models: ${Object.keys(modelRegistry).join(', ')}`
  );
  console.log(`Available tables: ${tables.join(', ')}`);
};

try {
  await main();
} catch (error) {
  console.error(`Database initialization failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  const database = getDatabaseStatus();

  if (database.connected) {
    await closeDatabaseConnection();
  }
}
