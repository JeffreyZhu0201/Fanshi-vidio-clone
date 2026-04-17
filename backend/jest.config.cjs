module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/__tests__/**/*.test.js'],
  setupFiles: ['<rootDir>/test/setupEnv.cjs'],
  collectCoverageFrom: [
    '<rootDir>/controllers/**/*.js',
    '<rootDir>/middleware/**/*.js',
    '<rootDir>/routes/**/*.js'
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'lcov'],
  coverageThreshold: {
    global: {
      statements: 80,
      functions: 80,
      lines: 80
    }
  }
};
