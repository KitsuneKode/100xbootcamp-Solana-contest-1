# PDA Name Registry

Standalone REST API for a PDA-backed name registry with top-level names, hierarchical sub-names, ownership transfer through Ed25519 signatures, and PDA verification.

## Result

- Judge result: `36/37`
- Runtime: Node.js + TypeScript
- Stack: Express, `@solana/web3.js`, `tweetnacl`, `bs58`, `zod`

## Challenge Summary

This project implements:

- top-level name registration
- sub-name registration under parent names
- top-level and sub-name resolution
- ownership transfer through signed messages
- PDA verification from seed strings
- listing of names and child sub-names

## API Surface

- `POST /api/registry/register`
- `GET /api/registry/resolve/:programId/:name`
- `POST /api/registry/sub/register`
- `GET /api/registry/sub/resolve/:programId/:parentName/:subName`
- `POST /api/registry/transfer`
- `POST /api/registry/verify`
- `GET /api/registry/list/:programId`
- `GET /api/registry/list/:programId/:name/subs`

## Key Behavior

- Derives top-level PDAs from `["name", name]`.
- Derives sub-name PDAs from `["sub", parentPda, subName]`.
- Verifies transfer messages with `nacl.sign.detached.verify`.
- Stores all registrations in memory with program-level separation.
- Returns near-complete judged behavior with one remaining hidden edge case.

## Run Locally

```bash
npm install
npm start
```

The server listens on port `3000`.
