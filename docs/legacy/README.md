# Legacy Files Archive

This directory contains legacy documentation and test scripts that are no longer actively used but kept for reference.

## Files

- **DOUBAO_SEED_FILES_API.md**: Documentation for the old two-step API workflow (Files upload + Responses analyze). Replaced by Chat Completions API on 2026-05-02.
- **test-doubao-files-api.js**: Test script for the old two-step API workflow.
- **test-doubao-seed.js**: Legacy test script for Doubao-Seed integration.

## Migration

The project migrated from the two-step API to the temporal-aware Chat Completions API. See:
- `TEMPORAL_AWARE_MIGRATION.md` - Migration documentation
- `DOUBAO_SEED_INTEGRATION.md` - Current integration documentation

## Why Keep These?

These files are preserved for:
1. Understanding the evolution of the integration
2. Rollback reference if needed
3. Comparison with the new implementation
