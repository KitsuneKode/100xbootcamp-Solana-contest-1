import express, { Request, Response } from "express";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import crypto from "crypto";
import { z } from "zod";

const app = express();
app.use(express.json());

// System Program ID — used for vault PDA derivation only
const PROGRAM_ID = new PublicKey("11111111111111111111111111111111");

// Types
interface Vault {
  id: number;
  label: string;
  address: string;
  threshold: number;
  bump: number;
  signers: string[];          // stored sorted lexicographically
  createdAt: string;
  data: Record<string, string>;
}

interface ProposalSignature {
  signer: string;
  createdAt: string;
}

interface Proposal {
  id: number;
  vaultId: number;
  proposer: string;
  action: "transfer" | "set_data" | "memo";
  params: Record<string, any>;
  status: "pending" | "executed" | "cancelled";
  signatures: ProposalSignature[];
  createdAt: string;
  executedAt?: string;
}

// In-memory stores
const vaults: Vault[] = [];
const proposals: Proposal[] = [];
let nextVaultId = 1;
let nextProposalId = 1;

// Zod Schemas
const CreateVaultSchema = z.object({
  signers: z.array(z.string().min(1)).min(2, "At least 2 signers required"),
  threshold: z.number().int("Threshold must be an integer").min(1, "Threshold must be at least 1"),
  label: z.string().min(1, "label is required"),
});

const ProposeSchema = z.object({
  proposer: z.string().min(1, "proposer is required"),
  action: z.enum(["transfer", "set_data", "memo"], {
    message: "action must be transfer, set_data, or memo",
  }),
  params: z.record(z.string(), z.unknown()),
});

const ApproveSchema = z.object({
  signer: z.string().min(1, "signer is required"),
  signature: z.string().min(1, "signature is required"),
});

const CancelSchema = z.object({
  signer: z.string().min(1, "signer is required"),
  signature: z.string().min(1, "signature is required"),
});

// Helper: validate Solana public key
function parsePublicKey(address: string): PublicKey | null {
  try {
    return new PublicKey(address);
  } catch {
    return null;
  }
}

// Helper: verify ed25519 signature
function verifySignature(message: string, signature: string, signerAddress: string): boolean {
  const pubkey = parsePublicKey(signerAddress);
  if (!pubkey) return false;
  let sigBytes: Uint8Array;
  try {
    sigBytes = bs58.decode(signature);
  } catch {
    return false;
  }
  if (sigBytes.length !== 64) return false;
  return nacl.sign.detached.verify(Buffer.from(message, "utf8"), sigBytes, pubkey.toBytes());
}

// Helper: format proposal for response (only include executedAt when set)
function formatProposal(p: Proposal): Record<string, any> {
  const r: Record<string, any> = {
    id: p.id,
    vaultId: p.vaultId,
    proposer: p.proposer,
    action: p.action,
    params: p.params,
    status: p.status,
    signatures: p.signatures,
    createdAt: p.createdAt,
  };
  if (p.executedAt !== undefined) r.executedAt = p.executedAt;
  return r;
}

// POST /api/vault/create — Create a multi-sig vault
app.post("/api/vault/create", (req: Request, res: Response) => {
  const parsed = CreateVaultSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation failed" });
  }
  const { signers, threshold, label } = parsed.data;

  if (threshold > signers.length) {
    return res.status(400).json({ error: "Threshold cannot exceed number of signers" });
  }

  // Validate each signer is a valid pubkey
  for (const signer of signers) {
    if (!parsePublicKey(signer)) {
      return res.status(400).json({ error: `Invalid signer: ${signer}` });
    }
  }

  // Check for duplicate signers
  if (new Set(signers).size !== signers.length) {
    return res.status(400).json({ error: "Duplicate signers not allowed" });
  }

  // Derive vault PDA using SHA256 of sorted signers joined by ":"
  const sortedSigners = [...signers].sort();
  const sha256Hash = crypto.createHash("sha256").update(sortedSigners.join(":")).digest();

  let vaultAddress: string;
  let bump: number;
  try {
    const [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), sha256Hash],
      PROGRAM_ID
    );
    vaultAddress = vaultPda.toBase58();
    bump = vaultBump;
  } catch {
    return res.status(400).json({ error: "Failed to derive vault PDA" });
  }

  // Duplicate vault check (same signer set = same PDA)
  if (vaults.some((v) => v.address === vaultAddress)) {
    return res.status(409).json({ error: "Vault with this signer set already exists" });
  }

  const vault: Vault = {
    id: nextVaultId++,
    label,
    address: vaultAddress,
    threshold,
    bump,
    signers: sortedSigners,
    createdAt: new Date().toISOString(),
    data: {},
  };
  vaults.push(vault);

  return res.status(201).json({
    id: vault.id,
    label: vault.label,
    address: vault.address,
    threshold: vault.threshold,
    bump: vault.bump,
    signers: vault.signers,
    createdAt: vault.createdAt,
  });
});

// GET /api/vault/:vaultId — Get vault details with proposalCount
app.get("/api/vault/:vaultId", (req: Request, res: Response) => {
  const vaultId = parseInt(req.params.vaultId, 10);
  if (isNaN(vaultId)) return res.status(404).json({ error: "Vault not found" });
  const vault = vaults.find((v) => v.id === vaultId);
  if (!vault) return res.status(404).json({ error: "Vault not found" });
  const proposalCount = proposals.filter((p) => p.vaultId === vault.id).length;
  return res.status(200).json({
    id: vault.id,
    label: vault.label,
    address: vault.address,
    threshold: vault.threshold,
    bump: vault.bump,
    signers: vault.signers,
    proposalCount,
    createdAt: vault.createdAt,
  });
});

// POST /api/vault/:vaultId/propose — Create a proposal
app.post("/api/vault/:vaultId/propose", (req: Request, res: Response) => {
  const vaultId = parseInt(req.params.vaultId, 10);
  if (isNaN(vaultId)) return res.status(404).json({ error: "Vault not found" });
  const vault = vaults.find((v) => v.id === vaultId);
  if (!vault) return res.status(404).json({ error: "Vault not found" });

  const parsed = ProposeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation failed" });
  }
  const { proposer, action, params } = parsed.data;

  if (!vault.signers.includes(proposer)) {
    return res.status(403).json({ error: "Not a vault signer" });
  }

  // Validate action-specific params
  if (action === "transfer") {
    const to = params.to as string | undefined;
    const amount = params.amount as number | undefined;
    if (!to || typeof to !== "string") {
      return res.status(400).json({ error: "transfer requires 'to' address" });
    }
    if (!parsePublicKey(to)) {
      return res.status(400).json({ error: "Invalid 'to' address" });
    }
    if (typeof amount !== "number" || amount <= 0) {
      return res.status(400).json({ error: "transfer requires amount > 0" });
    }
  } else if (action === "set_data") {
    const key = params.key as string | undefined;
    const value = params.value as string | undefined;
    if (!key || typeof key !== "string") {
      return res.status(400).json({ error: "set_data requires non-empty 'key'" });
    }
    if (value === undefined || value === null || typeof value !== "string" || value === "") {
      return res.status(400).json({ error: "set_data requires non-empty 'value'" });
    }
  } else if (action === "memo") {
    const content = params.content as string | undefined;
    if (!content || typeof content !== "string") {
      return res.status(400).json({ error: "memo requires non-empty 'content'" });
    }
  }

  const proposal: Proposal = {
    id: nextProposalId++,
    vaultId: vault.id,
    proposer,
    action,
    params: params as Record<string, any>,
    status: "pending",
    signatures: [],
    createdAt: new Date().toISOString(),
  };
  proposals.push(proposal);
  return res.status(201).json(formatProposal(proposal));
});

// POST /api/vault/:vaultId/proposals/:proposalId/approve — Approve a proposal
app.post(
  "/api/vault/:vaultId/proposals/:proposalId/approve",
  (req: Request, res: Response) => {
    const vaultId = parseInt(req.params.vaultId, 10);
    const proposalId = parseInt(req.params.proposalId, 10);
    if (isNaN(vaultId)) return res.status(404).json({ error: "Vault not found" });
    if (isNaN(proposalId)) return res.status(404).json({ error: "Proposal not found" });

    const vault = vaults.find((v) => v.id === vaultId);
    if (!vault) return res.status(404).json({ error: "Vault not found" });

    const proposal = proposals.find((p) => p.id === proposalId && p.vaultId === vaultId);
    if (!proposal) return res.status(404).json({ error: "Proposal not found" });

    const parsed = ApproveSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation failed" });
    }
    const { signer, signature } = parsed.data;

    // 403: signer must be in vault
    if (!vault.signers.includes(signer)) {
      return res.status(403).json({ error: "Not a vault signer" });
    }

    // 409: check proposal status
    if (proposal.status === "executed") {
      return res.status(409).json({ error: "Proposal already executed" });
    }
    if (proposal.status === "cancelled") {
      return res.status(409).json({ error: "Proposal already cancelled" });
    }

    // 409: check double-sign
    if (proposal.signatures.some((s) => s.signer === signer)) {
      return res.status(409).json({ error: "Already signed" });
    }

    // 400: verify signature — message is "approve:<proposalId>"
    if (!verifySignature(`approve:${proposalId}`, signature, signer)) {
      return res.status(400).json({ error: "Invalid signature" });
    }

    // Add signature
    proposal.signatures.push({ signer, createdAt: new Date().toISOString() });

    // Auto-execute when threshold reached
    if (proposal.signatures.length >= vault.threshold) {
      proposal.status = "executed";
      proposal.executedAt = new Date().toISOString();
      if (proposal.action === "set_data") {
        vault.data[proposal.params.key as string] = proposal.params.value as string;
      }
      // transfer and memo: simulated — marked executed above
    }

    return res.status(200).json(formatProposal(proposal));
  }
);

// GET /api/vault/:vaultId/proposals — List proposals (optional ?status filter)
app.get("/api/vault/:vaultId/proposals", (req: Request, res: Response) => {
  const vaultId = parseInt(req.params.vaultId, 10);
  if (isNaN(vaultId)) return res.status(404).json({ error: "Vault not found" });
  const vault = vaults.find((v) => v.id === vaultId);
  if (!vault) return res.status(404).json({ error: "Vault not found" });

  const { status } = req.query;
  let result = proposals.filter((p) => p.vaultId === vaultId);
  if (status === "pending" || status === "executed" || status === "cancelled") {
    result = result.filter((p) => p.status === status);
  }
  return res.status(200).json(result.map(formatProposal));
});

// GET /api/vault/:vaultId/proposals/:proposalId — Get proposal details
app.get(
  "/api/vault/:vaultId/proposals/:proposalId",
  (req: Request, res: Response) => {
    const vaultId = parseInt(req.params.vaultId, 10);
    const proposalId = parseInt(req.params.proposalId, 10);
    if (isNaN(vaultId)) return res.status(404).json({ error: "Vault not found" });
    if (isNaN(proposalId)) return res.status(404).json({ error: "Proposal not found" });

    const vault = vaults.find((v) => v.id === vaultId);
    if (!vault) return res.status(404).json({ error: "Vault not found" });

    const proposal = proposals.find((p) => p.id === proposalId && p.vaultId === vaultId);
    if (!proposal) return res.status(404).json({ error: "Proposal not found" });

    return res.status(200).json(formatProposal(proposal));
  }
);

// POST /api/vault/:vaultId/proposals/:proposalId/cancel — Cancel a proposal
app.post(
  "/api/vault/:vaultId/proposals/:proposalId/cancel",
  (req: Request, res: Response) => {
    const vaultId = parseInt(req.params.vaultId, 10);
    const proposalId = parseInt(req.params.proposalId, 10);
    if (isNaN(vaultId)) return res.status(404).json({ error: "Vault not found" });
    if (isNaN(proposalId)) return res.status(404).json({ error: "Proposal not found" });

    const vault = vaults.find((v) => v.id === vaultId);
    if (!vault) return res.status(404).json({ error: "Vault not found" });

    const proposal = proposals.find((p) => p.id === proposalId && p.vaultId === vaultId);
    if (!proposal) return res.status(404).json({ error: "Proposal not found" });

    const parsed = CancelSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation failed" });
    }
    const { signer, signature } = parsed.data;

    // 403: only proposer can cancel
    if (signer !== proposal.proposer) {
      return res.status(403).json({ error: "Only the proposer can cancel" });
    }

    // 409: check proposal status
    if (proposal.status === "executed") {
      return res.status(409).json({ error: "Proposal already executed" });
    }
    if (proposal.status === "cancelled") {
      return res.status(409).json({ error: "Proposal already cancelled" });
    }

    // 400: verify signature — message is "cancel:<proposalId>"
    if (!verifySignature(`cancel:${proposalId}`, signature, signer)) {
      return res.status(400).json({ error: "Invalid signature" });
    }

    proposal.status = "cancelled";
    return res.status(200).json(formatProposal(proposal));
  }
);

// GET /api/vault/:vaultId/data — Get vault key-value data store
app.get("/api/vault/:vaultId/data", (req: Request, res: Response) => {
  const vaultId = parseInt(req.params.vaultId, 10);
  if (isNaN(vaultId)) return res.status(404).json({ error: "Vault not found" });
  const vault = vaults.find((v) => v.id === vaultId);
  if (!vault) return res.status(404).json({ error: "Vault not found" });
  return res.status(200).json({ data: vault.data });
});

app.listen(3000, () => console.log("Server running on port 3000"));
export default app;
