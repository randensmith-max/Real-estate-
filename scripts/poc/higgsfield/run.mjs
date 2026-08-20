// Phase 0D PoC: official Higgsfield SDK (@higgsfield/client v2), NOT the consumer website.
// No HF_CREDENTIALS / HIGGSFIELD_API_KEY present in this sandbox's environment, so a real
// image-to-video generation cannot be completed. This script still proves:
//   1. the official SDK installs and imports cleanly
//   2. it builds a real HTTP request to the real Higgsfield endpoint
//   3. the endpoint is reachable and returns a genuine auth rejection (not a network/DNS
//      failure), confirming platform.higgsfield.ai + the image2video/dop endpoint are live
//      and match the documented contract.
import { higgsfield, config } from "@higgsfield/client/v2";
import { AuthenticationError, APIError } from "@higgsfield/client";

const hasCreds = Boolean(process.env.HF_CREDENTIALS || (process.env.HF_API_KEY && process.env.HF_API_SECRET));

console.log(`HF credentials present in env: ${hasCreds}`);

if (!hasCreds) {
  // Deliberately do NOT invent a key. Use an obviously-placeholder value so the request
  // exercises the real auth path and we can observe how the API actually rejects it.
  config({ credentials: "PLACEHOLDER_ID:PLACEHOLDER_SECRET" });
}

const PRESERVATION_PROMPT =
  "Slow cinematic real-estate camera push forward. Preserve the exact architecture, " +
  "walls, windows, furniture, lighting, layout and dimensions of the source image. " +
  "Do not add or remove objects. No people. No structural changes.";

const start = Date.now();
try {
  const jobSet = await higgsfield.subscribe("/v1/image2video/dop", {
    input: {
      model: "dop-turbo",
      prompt: PRESERVATION_PROMPT,
      input_images: [
        {
          type: "image_url",
          // Placeholder URL — request is expected to fail on auth before this is fetched.
          image_url: "https://example.com/sample-interior.jpg",
        },
      ],
    },
    withPolling: false,
  });
  console.log("UNEXPECTED SUCCESS:", JSON.stringify(jobSet, null, 2));
} catch (err) {
  const elapsedMs = Date.now() - start;
  console.log(`\nRequest completed (rejected) in ${elapsedMs}ms`);
  console.log(`Error class: ${err?.constructor?.name}`);
  console.log(`instanceof AuthenticationError: ${err instanceof AuthenticationError}`);
  console.log(`instanceof APIError: ${err instanceof APIError}`);
  console.log(`message: ${err?.message}`);
  if (err?.statusCode) console.log(`statusCode: ${err.statusCode}`);
}
