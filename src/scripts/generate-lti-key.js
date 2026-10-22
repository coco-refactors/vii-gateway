
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

// Generate RSA public/private keys
const { publicKey, privateKey } = generateKeyPairSync(
    "rsa",
    { modulusLength: 2048 }
);

// Convert public key to JWK format
const jwk = {
    ...publicKey.export({ format: "jwk" }),
    alg: "RS256",
    use: "sig",
    kid: randomUUID()
};

// Create a local directory for keys
mkdirSync(".secrets", { recursive: true });

// Save private key securely
writeFileSync(
    ".secrets/lti-private.pem",
    privateKey.export({
        type: "pkcs8",
        format: "pem"
    }),
    { mode: 0o600, flag: "wx" }
);

// Save public JWK
writeFileSync(
    ".secrets/lti-public.jwk.json",
    JSON.stringify(jwk, null, 2),
    { flag: "wx" }
);

console.log("LTI key pair generated successfully.");
