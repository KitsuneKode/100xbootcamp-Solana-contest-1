# Solana Address Book

Standalone REST API for managing a Solana address book with contact storage, wallet vs PDA classification, ATA derivation, ownership verification, and PDA derivation.

## Result

- Judge result: `30/30`
- Runtime: Node.js + TypeScript
- Stack: Express, `@solana/web3.js`, `tweetnacl`, `bs58`, `zod`

## Challenge Summary

This project implements:

- contact CRUD endpoints
- automatic address type detection
- associated token account derivation
- Ed25519 ownership verification
- PDA derivation from UTF-8 seeds

## API Surface

- `POST /api/contacts`
- `GET /api/contacts`
- `GET /api/contacts/:id`
- `PUT /api/contacts/:id`
- `DELETE /api/contacts/:id`
- `POST /api/contacts/:id/derive-ata`
- `POST /api/verify-ownership`
- `POST /api/derive-pda`

## Key Behavior

- Validates Solana public keys for stored contacts.
- Detects whether a contact address is on-curve (`wallet`) or off-curve (`pda`).
- Derives the Associated Token Account using the standard token and associated token program IDs.
- Verifies Ed25519 signatures locally from UTF-8 message bytes.
- Derives PDAs from UTF-8 seed strings without any network calls.

## Run Locally

```bash
npm install
npm start
```

The server listens on port `3000`.
