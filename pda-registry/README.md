# PDA Name Registry (Medium)

Build a REST API for a PDA-based name registry system. Users register human-readable names that map to Program Derived Addresses (PDAs), create hierarchical sub-names, transfer ownership via ed25519 signature verification, and verify PDA derivations. All data is stored in memory.

## Requirements

### Registration

- **POST /api/registry/register** — Register a top-level name
  - Body: `{ name: string, programId: string, owner: string }`
  - PDA = `PublicKey.findProgramAddressSync([Buffer.from("name"), Buffer.from(name)], new PublicKey(programId))`
  - Response `201`: `{ id, name, programId, pda, owner, bump, createdAt }`
  - Response `400`: missing fields, invalid programId or owner (not valid base58 32-byte keys), empty name
  - Response `409`: name already registered for this programId

### Resolve

- **GET /api/registry/resolve/:programId/:name** — Resolve name to PDA
  - Response `200`: `{ id, name, programId, pda, owner, bump, createdAt }`
  - Response `404`: `{ error: "Name not found" }`

### Sub-names

- **POST /api/registry/sub/register** — Register a sub-name under an existing parent
  - Body: `{ parentName: string, subName: string, programId: string, owner: string }`
  - Look up parent by programId + parentName (top-level only)
  - PDA = `PublicKey.findProgramAddressSync([Buffer.from("sub"), new PublicKey(parentPda).toBuffer(), Buffer.from(subName)], new PublicKey(programId))`
  - Response `201`: `{ id, name: subName, parentName, parentPda, programId, pda, owner, bump, createdAt }`
  - Response `400`: missing fields, invalid inputs, empty subName
  - Response `404`: parent name not found
  - Response `409`: sub-name already exists under this parent

- **GET /api/registry/sub/resolve/:programId/:parentName/:subName** — Resolve sub-name
  - Response `200`: `{ id, name, parentName, parentPda, programId, pda, owner, bump, createdAt }`
  - Response `404`: not found

### Transfer Ownership

- **POST /api/registry/transfer** — Transfer name ownership
  - Body: `{ programId: string, name: string, newOwner: string, signature: string, message: string }`
  - `message` must exactly equal `"transfer:<name>:to:<newOwner>"`
  - Verify ed25519 signature of UTF-8 message bytes against the current owner's public key
  - Response `200`: updated registration with new owner
  - Response `400`: message doesn't match expected format, invalid newOwner, missing fields
  - Response `403`: `{ error: "Invalid signature" }` — signature doesn't verify against current owner
  - Response `404`: name not found

### Verify PDA

- **POST /api/registry/verify** — Verify a PDA derivation
  - Body: `{ address: string, programId: string, seeds: string[] }`
  - Each seed is a UTF-8 string converted to a Buffer
  - Response `200`: `{ valid: boolean, expectedPda: string, bump: number }`
  - Response `400`: invalid programId or address, missing fields

### List

- **GET /api/registry/list/:programId** — List all top-level names for a program
  - Query: `?owner=<address>` (optional filter)
  - Returns only top-level names (where parentPda is null)
  - Response `200`: array of registrations

- **GET /api/registry/list/:programId/:name/subs** — List sub-names of a parent
  - Response `200`: array of sub-registrations
  - Response `404`: parent name not found

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

- PDA seeds for top-level names: `[Buffer.from("name"), Buffer.from(name)]`
- PDA seeds for sub-names: `[Buffer.from("sub"), parentPda.toBuffer(), Buffer.from(subName)]`
- Signature verification uses `nacl.sign.detached.verify`

## Additional Information

- Judge result: `36/37`
