/** Jest config for the API — e2e tests run against an in-memory SQLite database
 * (no Postgres needed for the test suite; production runs on PostgreSQL). */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.e2e-spec.ts'],
  moduleNameMapper: {
    '^@pulse/engine$': '<rootDir>/../../packages/engine/src/index.ts',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  setupFiles: ['<rootDir>/test/setup-env.cjs'],
  testTimeout: 60000,
};
