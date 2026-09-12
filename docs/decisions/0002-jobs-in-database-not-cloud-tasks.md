# 0002. Background jobs in the database, not Cloud Tasks (V1)

**Date:** 11 September 2026 · **Stage:** planning · **Status:** Accepted

## Decision

Model background work as rows in a `jobs` table, processed by a worker built
into the engine. Cloud Tasks and Cloud Scheduler are not used in V1.

## Why

The founder asked to minimise the number of services to manage and to avoid
over-engineering for traffic that does not exist. A database-backed queue with
attempt counts and heartbeats is enough for launch volumes and removes two
services from the setup.

## Consequences

Work is dispatched through a small "job dispatcher" boundary so Cloud Tasks can
replace the implementation later without touching the comparison engine. Cloud
Run must use the billing mode that keeps the CPU active for background work.
