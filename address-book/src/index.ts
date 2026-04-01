import express, { Request, Response } from "express";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { z } from "zod";

const app = express();
app.use(express.json());

// --- Constants ---
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

// --- Models ---
interface Contact {
  id: number;
  name: string;
  address: string;
  type: "wallet" | "pda";
  createdAt: string;
}

let nextId = 1;
const contacts: Contact[] = [];

// --- Validation Schemas ---
const AddContactSchema = z.object({
  name: z.string({ required_error: "name is required" }).min(1, "name cannot be empty"),
  address: z.string({ required_error: "address is required" }).min(1, "address cannot be empty"),
});

const UpdateContactSchema = z.object({
  name: z.string({ required_error: "name is required" }).min(1, "name cannot be empty"),
});

const DeriveAtaSchema = z.object({
  mintAddress: z.string({ required_error: "mintAddress is required" }).min(1, "mintAddress cannot be empty"),
});

const VerifyOwnershipSchema = z.object({
  address: z.string({ required_error: "address is required" }).min(1, "address cannot be empty"),
  message: z.string({ required_error: "message is required" }),
  signature: z.string({ required_error: "signature is required" }).min(1, "signature cannot be empty"),
});

const DerivePdaSchema = z.object({
  programId: z.string({ required_error: "programId is required" }).min(1, "programId cannot be empty"),
  seeds: z.array(z.string(), { required_error: "seeds is required" }),
});

// --- Utility Functions ---
function parsePublicKey(address: string): PublicKey | null {
  try {
    return new PublicKey(address);
  } catch {
    return null;
  }
}

// --- Routes ---

// 1. Add a contact
app.post("/api/contacts", (req: Request, res: Response) => {
  const parsed = AddContactSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0].message });
  }

  const { name, address } = parsed.data;

  const pubkey = parsePublicKey(address);
  if (!pubkey) {
    return res.status(400).json({ error: "Invalid Solana address format" });
  }

  const exists = contacts.find((c) => c.address === address);
  if (exists) {
    return res.status(409).json({ error: "Address already exists" });
  }

  const isWallet = PublicKey.isOnCurve(pubkey.toBytes());
  const type: "wallet" | "pda" = isWallet ? "wallet" : "pda";

  const newContact: Contact = {
    id: nextId++,
    name,
    address,
    type,
    createdAt: new Date().toISOString(),
  };

  contacts.push(newContact);
  return res.status(201).json(newContact);
});

// 2. List all contacts
app.get("/api/contacts", (req: Request, res: Response) => {
  const { type } = req.query;
  
  let result = [...contacts];
  if (type === "wallet" || type === "pda") {
    result = result.filter((c) => c.type === type);
  }

  result.sort((a, b) => a.id - b.id);
  return res.status(200).json(result);
});

// 3. Get a contact by ID
app.get("/api/contacts/:id", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(404).json({ error: "Contact not found" });

  const contact = contacts.find((c) => c.id === id);
  if (!contact) {
    return res.status(404).json({ error: "Contact not found" });
  }

  return res.status(200).json(contact);
});

// 4. Update a contact
app.put("/api/contacts/:id", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(404).json({ error: "Contact not found" });

  const contact = contacts.find((c) => c.id === id);
  if (!contact) {
    return res.status(404).json({ error: "Contact not found" });
  }

  const parsed = UpdateContactSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0].message });
  }

  contact.name = parsed.data.name;
  return res.status(200).json(contact);
});

// 5. Delete a contact
app.delete("/api/contacts/:id", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(404).json({ error: "Contact not found" });

  const index = contacts.findIndex((c) => c.id === id);
  if (index === -1) {
    return res.status(404).json({ error: "Contact not found" });
  }

  contacts.splice(index, 1);
  return res.status(200).json({ message: "Contact deleted" });
});

// 6. ATA Derivation
app.post("/api/contacts/:id/derive-ata", (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(404).json({ error: "Contact not found" });

  const contact = contacts.find((c) => c.id === id);
  if (!contact) {
    return res.status(404).json({ error: "Contact not found" });
  }

  const parsed = DeriveAtaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0].message });
  }

  const mintPubkey = parsePublicKey(parsed.data.mintAddress);
  if (!mintPubkey) {
    return res.status(400).json({ error: "Invalid mint address" });
  }

  const ownerPubkey = new PublicKey(contact.address);
  const [ata] = PublicKey.findProgramAddressSync(
    [ownerPubkey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintPubkey.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  return res.status(200).json({
    ata: ata.toBase58(),
    owner: contact.address,
    mint: parsed.data.mintAddress,
  });
});

// 7. Signature Verification
app.post("/api/verify-ownership", (req: Request, res: Response) => {
  const parsed = VerifyOwnershipSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0].message });
  }

  const { address, message, signature } = parsed.data;

  const pubkey = parsePublicKey(address);
  if (!pubkey) {
    return res.status(400).json({ error: "Invalid public key" });
  }

  let signatureBytes: Uint8Array;
  try {
    signatureBytes = bs58.decode(signature);
  } catch {
    return res.status(400).json({ error: "Invalid signature (must be base58)" });
  }

  if (signatureBytes.length !== 64) {
    return res.status(400).json({ error: "Invalid signature length" });
  }

  const messageBytes = Buffer.from(message, "utf8");
  const isValid = nacl.sign.detached.verify(messageBytes, signatureBytes, pubkey.toBytes());

  return res.status(200).json({ valid: isValid });
});

// 8. PDA Derivation
app.post("/api/derive-pda", (req: Request, res: Response) => {
  const parsed = DerivePdaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0].message });
  }

  const { programId, seeds } = parsed.data;

  const progPubkey = parsePublicKey(programId);
  if (!progPubkey) {
    return res.status(400).json({ error: "Invalid programId" });
  }

  const seedBuffers: Buffer[] = [];
  for (const seed of seeds) {
    const buf = Buffer.from(seed, "utf8");
    if (buf.length > 32) {
      return res.status(400).json({ error: "Seed cannot exceed 32 bytes" });
    }
    seedBuffers.push(buf);
  }

  try {
    const [pda, bump] = PublicKey.findProgramAddressSync(seedBuffers, progPubkey);
    return res.status(200).json({ pda: pda.toBase58(), bump });
  } catch (err) {
    return res.status(400).json({ error: "Failed to derive PDA" });
  }
});

app.listen(3000, () => {
  console.log("Server listening on port 3000");
});

export default app;