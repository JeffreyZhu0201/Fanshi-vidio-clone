import {
  checkDatabaseHealth,
  closeDatabaseConnection,
  getDatabaseStatus
} from '../config/database.js';

const main = async () => {
  const database = await checkDatabaseHealth();

  if (!database.connected) {
    console.error(
      `MySQL connection failed: ${database.errorMessage || 'Unknown database error'}`
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `MySQL connection successful: ${database.database} @ ${database.host}:${database.port}`
  );
};

try {
  await main();
} finally {
  const database = getDatabaseStatus();

  if (database.connected) {
    await closeDatabaseConnection();
  }
}
