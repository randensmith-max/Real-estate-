import { ImageAnalysisSchema } from "./schema.mjs";
import {
  sampleA_realImageAnalysis,
  sampleB_evidenceClassificationWorkedExample,
  sampleC_invalidPayload,
} from "./sample-outputs.mjs";

function report(name, payload) {
  const result = ImageAnalysisSchema.safeParse(payload);
  console.log(`\n=== ${name} ===`);
  if (result.success) {
    console.log("VALID — passes schema");
    console.log(JSON.stringify(result.data, null, 2));
  } else {
    console.log("INVALID — rejected by schema (this is expected for sampleC)");
    for (const issue of result.error.issues) {
      console.log(`  - [${issue.path.join(".")}] ${issue.message}`);
    }
  }
  return result.success;
}

const results = {
  sampleA: report("sampleA: real image, honest 'cannot determine' output", sampleA_realImageAnalysis),
  sampleB: report("sampleB: evidence-classification worked example", sampleB_evidenceClassificationWorkedExample),
  sampleC: report("sampleC: intentionally invalid payload", sampleC_invalidPayload),
};

console.log("\n=== SUMMARY ===");
console.log(`sampleA valid (expected true):  ${results.sampleA}`);
console.log(`sampleB valid (expected true):  ${results.sampleB}`);
console.log(`sampleC valid (expected false): ${results.sampleC}`);

const pass = results.sampleA === true && results.sampleB === true && results.sampleC === false;
console.log(`\nPoC ${pass ? "PASS" : "FAIL"}`);
process.exit(pass ? 0 : 1);
