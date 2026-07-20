import { z } from "zod";

export const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
