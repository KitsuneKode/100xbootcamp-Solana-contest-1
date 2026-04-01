# Solana Contest 1 Solutions

A compact collection of three Solana-focused backend challenge solutions built with Node.js, TypeScript, Express, and `@solana/web3.js`.

Each folder contains a standalone API service with its own implementation and project-level README. The challenge statement for each problem has been rewritten into the local `README.md` instead of being published as raw prompt files.

## Results

| Project | Difficulty | Result |
| --- | --- | --- |
| `address-book` | Easy | `30/30` |
| `multi-sig-vault` | Hard | `47/47` |
| `pda-registry` | Medium | `36/37` |

## Projects

### `address-book`
- Solana address book API with CRUD operations, wallet vs PDA detection, ATA derivation, ownership verification, and PDA derivation.
- Result: `30/30`.

### `multi-sig-vault`
- Multi-signature vault API with M-of-N signer thresholds, PDA-derived vault addresses, proposal approval and cancellation, and a governed key-value store.
- Result: `47/47`.

### `pda-registry`
- PDA-based name registry API for top-level names, sub-names, transfer-by-signature, and PDA verification.
- Result: `36/37`.
- Current state: near-complete implementation with one remaining hidden edge case on the judge.

## Local Verification

Each project is standalone.

```bash
cd address-book
npm install
npm start
```

```bash
cd multi-sig-vault
npm install
npm start
```

```bash
cd pda-registry
npm install
npm start
```

All projects listen on port `3000`, so run them one at a time.

## Repository Notes

- Planning and prompt artifacts such as `PLAN.md`, `Question.md`, and `SPECIFICATION.md` are intentionally excluded from version control.
- The published repo is focused on the working solutions, their challenge summaries, and how to run or review them.

## License

This repository is released under the MIT License. See [LICENSE](./LICENSE).
