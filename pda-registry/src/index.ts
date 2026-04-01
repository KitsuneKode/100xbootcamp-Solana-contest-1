import express, { NextFunction, Request, Response } from "express";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { z } from "zod";

declare const require: any;
declare const module: any;

const PORT = 3000;
const app = express();

app.disable("x-powered-by");
app.use(express.json());

interface NameRegistration {
  id: number;
  name: string;
  programId: string;
  pda: string;
  owner: string;
  bump: number;
  createdAt: string;
  parentPda: string | null;
  parentName: string | null;
}

type TopLevelRegistrationResponse = Omit<
  NameRegistration,
  "parentPda" | "parentName"
>;

type SubRegistrationResponse = TopLevelRegistrationResponse & {
  parentPda: string;
  parentName: string;
};

const registrations: NameRegistration[] = [];
let nextId = 1;

const invalidBodyMessage = "Invalid request body";

function badRequest(res: Response, error: string) {
  return res.status(400).json({ error });
}

function parsePublicKey(address: string): PublicKey | null {
  try {
    return new PublicKey(address);
  } catch {
    return null;
  }
}

function rawRequiredString(message: string) {
  return z
    .unknown()
    .superRefine((value, ctx) => {
      if (typeof value !== "string" || value.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message,
        });
      }
    })
    .transform((value) => value as string);
}

function rawRequiredStringAllowWhitespace(message: string) {
  return z
    .unknown()
    .superRefine((value, ctx) => {
      if (typeof value !== "string" || value.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message,
        });
      }
    })
    .transform((value) => value as string);
}

function publicKeyString(requiredMessage: string, invalidMessage: string) {
  return z
    .unknown()
    .superRefine((value, ctx) => {
      if (value === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: requiredMessage,
        });
        return;
      }

      if (typeof value !== "string") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: invalidMessage,
        });
        return;
      }

      if (value.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: requiredMessage,
        });
        return;
      }

      if (parsePublicKey(value) === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: invalidMessage,
        });
      }
    })
    .transform((value) => value as string);
}

const RegisterSchema = z
  .object({
    name: rawRequiredString("name is required"),
    programId: publicKeyString("programId is required", "Invalid programId"),
    owner: publicKeyString("owner is required", "Invalid owner"),
  }, { error: invalidBodyMessage })
  .passthrough();

const SubRegisterSchema = z
  .object({
    parentName: rawRequiredString("parentName is required"),
    subName: rawRequiredString("subName is required"),
    programId: publicKeyString("programId is required", "Invalid programId"),
    owner: publicKeyString("owner is required", "Invalid owner"),
  }, { error: invalidBodyMessage })
  .passthrough();

const TransferSchema = z
  .object({
    programId: rawRequiredString("programId is required"),
    name: rawRequiredString("name is required"),
    newOwner: publicKeyString("newOwner is required", "Invalid newOwner"),
    signature: rawRequiredString("signature is required"),
    message: rawRequiredStringAllowWhitespace("message is required"),
  }, { error: invalidBodyMessage })
  .passthrough();

const VerifySchema = z
  .object({
    address: publicKeyString("address is required", "Invalid address"),
    programId: publicKeyString("programId is required", "Invalid programId"),
    seeds: z.array(z.string({ error: "seeds must be an array of strings" }), {
      error: (issue) =>
        issue.input === undefined
          ? "seeds is required"
          : "seeds must be an array of strings",
    }),
  }, { error: invalidBodyMessage })
  .passthrough();

function parseBody<T extends Record<string, unknown>>(
  schema: z.ZodType<T>,
  body: unknown,
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(
    typeof body === "object" && body !== null && !Array.isArray(body) ? body : {},
  );

  if (!result.success) {
    return {
      success: false,
      error: result.error.issues[0]?.message ?? invalidBodyMessage,
    };
  }

  return {
    success: true,
    data: result.data,
  };
}

function verifySignature(
  message: string,
  signature: string,
  signerAddress: string,
): boolean {
  const signer = parsePublicKey(signerAddress);
  if (!signer) {
    return false;
  }

  let signatureBytes: Uint8Array;
  try {
    signatureBytes = bs58.decode(signature);
  } catch {
    return false;
  }

  if (signatureBytes.length !== 64) {
    return false;
  }

  return nacl.sign.detached.verify(
    Buffer.from(message, "utf8"),
    signatureBytes,
    signer.toBytes(),
  );
}

function findTopLevelRegistration(
  programId: string,
  name: string,
): NameRegistration | undefined {
  return registrations.find(
    (registration) =>
      registration.programId === programId &&
      registration.name === name &&
      registration.parentPda === null,
  );
}

function formatTopLevelRegistration(
  registration: NameRegistration,
): TopLevelRegistrationResponse {
  return {
    id: registration.id,
    name: registration.name,
    programId: registration.programId,
    pda: registration.pda,
    owner: registration.owner,
    bump: registration.bump,
    createdAt: registration.createdAt,
  };
}

function formatSubRegistration(
  registration: NameRegistration,
): SubRegistrationResponse {
  return {
    id: registration.id,
    name: registration.name,
    parentName: registration.parentName as string,
    parentPda: registration.parentPda as string,
    programId: registration.programId,
    pda: registration.pda,
    owner: registration.owner,
    bump: registration.bump,
    createdAt: registration.createdAt,
  };
}

app.post("/api/registry/register", (req: Request, res: Response) => {
  const parsed = parseBody(RegisterSchema, req.body);
  if (!parsed.success) {
    return badRequest(res, parsed.error);
  }

  const { name, programId, owner } = parsed.data;
  const programPublicKey = new PublicKey(programId);

  if (findTopLevelRegistration(programId, name)) {
    return res
      .status(409)
      .json({ error: "Name already registered for this programId" });
  }

  let derivedPda: PublicKey;
  let bump: number;
  try {
    [derivedPda, bump] = PublicKey.findProgramAddressSync(
      [Buffer.from("name"), Buffer.from(name)],
      programPublicKey,
    );
  } catch {
    return badRequest(res, "Failed to derive PDA");
  }

  const registration: NameRegistration = {
    id: nextId,
    name,
    programId,
    pda: derivedPda.toBase58(),
    owner,
    bump,
    createdAt: new Date().toISOString(),
    parentPda: null,
    parentName: null,
  };

  nextId += 1;
  registrations.push(registration);

  return res.status(201).json(formatTopLevelRegistration(registration));
});

app.get(
  "/api/registry/resolve/:programId/:name",
  (req: Request, res: Response) => {
    const registration = findTopLevelRegistration(
      req.params.programId,
      req.params.name,
    );

    if (!registration) {
      return res.status(404).json({ error: "Name not found" });
    }

    return res.status(200).json(formatTopLevelRegistration(registration));
  },
);

app.post("/api/registry/sub/register", (req: Request, res: Response) => {
  const parsed = parseBody(SubRegisterSchema, req.body);
  if (!parsed.success) {
    return badRequest(res, parsed.error);
  }

  const { parentName, subName, programId, owner } = parsed.data;
  const programPublicKey = new PublicKey(programId);

  const parent = findTopLevelRegistration(programId, parentName);
  if (!parent) {
    return res.status(404).json({ error: "Parent name not found" });
  }

  const existingSubRegistration = registrations.find(
    (registration) =>
      registration.programId === programId &&
      registration.name === subName &&
      registration.parentPda === parent.pda,
  );
  if (existingSubRegistration) {
    return res
      .status(409)
      .json({ error: "Sub-name already exists under this parent" });
  }

  let derivedPda: PublicKey;
  let bump: number;
  try {
    [derivedPda, bump] = PublicKey.findProgramAddressSync(
      [Buffer.from("sub"), new PublicKey(parent.pda).toBuffer(), Buffer.from(subName)],
      programPublicKey,
    );
  } catch {
    return badRequest(res, "Failed to derive PDA");
  }

  const registration: NameRegistration = {
    id: nextId,
    name: subName,
    programId,
    pda: derivedPda.toBase58(),
    owner,
    bump,
    createdAt: new Date().toISOString(),
    parentPda: parent.pda,
    parentName: parent.name,
  };

  nextId += 1;
  registrations.push(registration);

  return res.status(201).json(formatSubRegistration(registration));
});

app.get(
  "/api/registry/sub/resolve/:programId/:parentName/:subName",
  (req: Request, res: Response) => {
    const parent = findTopLevelRegistration(
      req.params.programId,
      req.params.parentName,
    );
    if (!parent) {
      return res.status(404).json({ error: "not found" });
    }

    const registration = registrations.find(
      (entry) =>
        entry.programId === req.params.programId &&
        entry.name === req.params.subName &&
        entry.parentPda === parent.pda,
    );

    if (!registration) {
      return res.status(404).json({ error: "not found" });
    }

    return res.status(200).json(formatSubRegistration(registration));
  },
);

app.post("/api/registry/transfer", (req: Request, res: Response) => {
  const parsed = parseBody(TransferSchema, req.body);
  if (!parsed.success) {
    return badRequest(res, parsed.error);
  }

  const { programId, name, newOwner, signature, message } = parsed.data;

  const expectedMessage = `transfer:${name}:to:${newOwner}`;
  if (message !== expectedMessage) {
    return badRequest(
      res,
      "Message must be exactly: transfer:<name>:to:<newOwner>",
    );
  }

  const registration = findTopLevelRegistration(programId, name);
  if (!registration) {
    return res.status(404).json({ error: "Name not found" });
  }

  if (!verifySignature(message, signature, registration.owner)) {
    return res.status(403).json({ error: "Invalid signature" });
  }

  registration.owner = newOwner;
  return res.status(200).json(formatTopLevelRegistration(registration));
});

app.post("/api/registry/verify", (req: Request, res: Response) => {
  const parsed = parseBody(VerifySchema, req.body);
  if (!parsed.success) {
    return badRequest(res, parsed.error);
  }

  const { address, programId, seeds } = parsed.data;
  const programPublicKey = new PublicKey(programId);

  try {
    const [expectedPda, bump] = PublicKey.findProgramAddressSync(
      seeds.map((seed) => Buffer.from(seed, "utf8")),
      programPublicKey,
    );

    return res.status(200).json({
      valid: expectedPda.toBase58() === address,
      expectedPda: expectedPda.toBase58(),
      bump,
    });
  } catch {
    return badRequest(res, "Failed to derive PDA");
  }
});

app.get("/api/registry/list/:programId", (req: Request, res: Response) => {
  const ownerFilter =
    typeof req.query.owner === "string" ? req.query.owner : undefined;

  const topLevelRegistrations = registrations.filter(
    (registration) =>
      registration.programId === req.params.programId &&
      registration.parentPda === null &&
      (ownerFilter === undefined || registration.owner === ownerFilter),
  );

  return res
    .status(200)
    .json(topLevelRegistrations.map(formatTopLevelRegistration));
});

app.get(
  "/api/registry/list/:programId/:name/subs",
  (req: Request, res: Response) => {
    const parent = findTopLevelRegistration(
      req.params.programId,
      req.params.name,
    );
    if (!parent) {
      return res.status(404).json({ error: "Parent name not found" });
    }

    const subRegistrations = registrations.filter(
      (registration) =>
        registration.programId === req.params.programId &&
        registration.parentPda === parent.pda,
    );

    return res
      .status(200)
      .json(subRegistrations.map(formatSubRegistration));
  },
);

app.use(
  (
    error: unknown,
    _req: Request,
    res: Response,
    next: NextFunction,
  ): Response | void => {
    if (error instanceof SyntaxError && "body" in error) {
      return res.status(400).json({ error: "Invalid JSON body" });
    }

    return next(error);
  },
);

const isDirectExecution =
  typeof require !== "undefined" && require.main === module;

if (isDirectExecution) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

if (typeof module !== "undefined") {
  module.exports = app;
  module.exports.default = app;
}

export default app;
