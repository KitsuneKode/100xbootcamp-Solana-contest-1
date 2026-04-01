# Solana Address Book (Easy)

Build a REST API for managing a Solana address book. Store contacts with auto-detected address types (wallet vs PDA), derive Associated Token Accounts, verify address ownership via ed25519 signatures, and derive PDAs.

## Requirements

### Contacts CRUD

- **POST /api/contacts** — Add a contact
  - Body: `{ name: string, address: string }`
  - Validate `address` is a valid base58-encoded 32-byte Solana public key
  - Auto-detect `type`: `"wallet"` if the address is on the Ed25519 curve, `"pda"` if off-curve
  - Response `201`: `{ id: number, name, address, type, createdAt: string }`
  - Response `400`: missing or invalid fields
  - Response `409`: address already exists

- **GET /api/contacts** — List all contacts
  - Query param: `?type=wallet` or `?type=pda` (optional filter)
  - Response `200`: array of contacts sorted by id ascending

- **GET /api/contacts/:id** — Get a contact by ID
  - Response `200`: contact object
  - Response `404`: `{ error: "Contact not found" }`

- **PUT /api/contacts/:id** — Update a contact's name
  - Body: `{ name: string }`
  - Response `200`: updated contact
  - Response `400`: missing name
  - Response `404`: not found

- **DELETE /api/contacts/:id** — Delete a contact
  - Response `200`: `{ message: "Contact deleted" }`
  - Response `404`: not found

### ATA Derivation

- **POST /api/contacts/:id/derive-ata** — Derive Associated Token Account for a contact
  - Body: `{ mintAddress: string }`
  - ATA = `PublicKey.findProgramAddressSync([ownerPubkey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintPubkey.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID)`
  - TOKEN_PROGRAM_ID: `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`
  - ASSOCIATED_TOKEN_PROGRAM_ID: `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL`
  - Response `200`: `{ ata: string, owner: string, mint: string }`
  - Response `400`: invalid mint address
  - Response `404`: contact not found

### Signature Verification

- **POST /api/verify-ownership** — Verify ed25519 signature
  - Body: `{ address: string, message: string, signature: string }` (address and signature are base58)
  - Verify using `nacl.sign.detached.verify` on the UTF-8 message bytes
  - Response `200`: `{ valid: boolean }`
  - Response `400`: missing fields or invalid inputs

### PDA Derivation

- **POST /api/derive-pda** — Derive a PDA
  - Body: `{ programId: string, seeds: string[] }` (seeds are UTF-8 strings)
  - Response `200`: `{ pda: string, bump: number }`
  - Response `400`: invalid programId, missing seeds, any seed exceeds 32 bytes

## Tech Stack

- **Runtime**: Node.js with TypeScript (tsx)
- **Framework**: Express.js
- **Libraries**: `@solana/web3.js`, `bs58`, `tweetnacl`
- **Storage**: In-memory (no database)

## Start Command

```
npm install && npm start
```

The server must listen on port **3000**. No database is needed — all data is stored in memory.

## Notes

- Use `PublicKey.isOnCurve(pubkey.toBytes())` to check if an address is a wallet (on-curve) or PDA (off-curve)
- All cryptographic operations are performed locally — no network calls needed
- Secret keys and signatures use base58 encoding

## Additional Information

- Judge result: `30/30`
