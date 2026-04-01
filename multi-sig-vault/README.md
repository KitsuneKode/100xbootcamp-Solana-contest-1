# Multi-Sig Vault

Standalone REST API for a multi-signature Solana-style vault with M-of-N signer thresholds, PDA-derived vault addresses, proposal execution, and a governed key-value store.

## Result

- Judge result: `47/47`
- Runtime: Node.js + TypeScript
- Stack: Express, `@solana/web3.js`, Node `crypto`, `tweetnacl`, `bs58`, `zod`

## Challenge Summary

This project implements:

- multi-sig vault creation with signer-set uniqueness
- PDA vault derivation from sorted signer hashes
- proposal creation, approval, auto-execution, and cancellation
- threshold-controlled key-value data updates
- signer signature verification for approval and cancellation flows

## API Surface

- `POST /api/vault/create`
- `GET /api/vault/:vaultId`
- `POST /api/vault/:vaultId/propose`
- `POST /api/vault/:vaultId/proposals/:proposalId/approve`
- `GET /api/vault/:vaultId/proposals`
- `GET /api/vault/:vaultId/proposals/:proposalId`
- `POST /api/vault/:vaultId/proposals/:proposalId/cancel`
- `GET /api/vault/:vaultId/data`

## Key Behavior

- Derives vault addresses as PDAs using the system program and a SHA-256 hash of sorted signer addresses.
- Enforces M-of-N thresholds for execution.
- Auto-executes proposals once the approval threshold is reached.
- Supports `transfer`, `set_data`, and `memo` proposal types.
- Restricts cancellation to the original proposer while the proposal is still pending.

## Run Locally

```bash
npm install
npm start
```

The server listens on port `3000`.
