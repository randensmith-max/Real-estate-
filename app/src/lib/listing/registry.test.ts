import { describe, it, expect } from "vitest";
import { detectProvider } from "./registry";

describe("detectProvider", () => {
  it("detects zillow.com", () => {
    expect(detectProvider("https://www.zillow.com/homedetails/123-Main-St/12345_zpid/")?.platform).toBe(
      "zillow"
    );
  });

  it("detects realtor.com", () => {
    expect(detectProvider("https://www.realtor.com/realestateandhomes-detail/123-Main-St")?.platform).toBe(
      "realtor"
    );
  });

  it("detects redfin.com", () => {
    expect(detectProvider("https://www.redfin.com/CA/City/123-Main-St/home/12345")?.platform).toBe("redfin");
  });

  it("detects rightmove.co.uk", () => {
    expect(detectProvider("https://www.rightmove.co.uk/properties/123456")?.platform).toBe("rightmove");
  });

  it("works without a www. prefix", () => {
    expect(detectProvider("https://zillow.com/x")?.platform).toBe("zillow");
  });

  it("returns null for an unsupported/unknown domain (no silent scraping)", () => {
    expect(detectProvider("https://example.com/listing/123")).toBeNull();
  });

  it("returns null for a malformed URL rather than throwing", () => {
    expect(detectProvider("not a url")).toBeNull();
  });
});
