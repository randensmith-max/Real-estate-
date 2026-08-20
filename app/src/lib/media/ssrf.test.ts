import { describe, it, expect } from "vitest";
import { assertSafeImageUrl, UnsafeImageUrlError } from "./ssrf";

describe("assertSafeImageUrl", () => {
  it("rejects localhost", async () => {
    await expect(assertSafeImageUrl("http://localhost/image.jpg")).rejects.toBeInstanceOf(
      UnsafeImageUrlError
    );
  });

  it("rejects 127.0.0.1 (loopback)", async () => {
    await expect(assertSafeImageUrl("http://127.0.0.1/image.jpg")).rejects.toBeInstanceOf(
      UnsafeImageUrlError
    );
  });

  it("rejects private 10.x range", async () => {
    await expect(assertSafeImageUrl("http://10.0.0.5/image.jpg")).rejects.toBeInstanceOf(UnsafeImageUrlError);
  });

  it("rejects private 192.168.x range", async () => {
    await expect(assertSafeImageUrl("http://192.168.1.1/image.jpg")).rejects.toBeInstanceOf(
      UnsafeImageUrlError
    );
  });

  it("rejects the cloud metadata IP (169.254.169.254)", async () => {
    await expect(assertSafeImageUrl("http://169.254.169.254/latest/meta-data/")).rejects.toBeInstanceOf(
      UnsafeImageUrlError
    );
  });

  it("rejects the IPv6 loopback", async () => {
    await expect(assertSafeImageUrl("http://[::1]/image.jpg")).rejects.toBeInstanceOf(UnsafeImageUrlError);
  });

  it("rejects non-http(s) schemes", async () => {
    await expect(assertSafeImageUrl("file:///etc/passwd")).rejects.toBeInstanceOf(UnsafeImageUrlError);
    await expect(assertSafeImageUrl("ftp://example.com/image.jpg")).rejects.toBeInstanceOf(
      UnsafeImageUrlError
    );
  });

  it("rejects a malformed URL", async () => {
    await expect(assertSafeImageUrl("not a url")).rejects.toBeInstanceOf(UnsafeImageUrlError);
  });

  it("accepts a well-formed public https URL by literal public IP (no DNS needed)", async () => {
    // 93.184.216.34 was the long-standing example.com IP; used here only as a
    // "clearly not private" literal address so this test needs no live DNS/network.
    const url = await assertSafeImageUrl("https://93.184.216.34/image.jpg");
    expect(url.hostname).toBe("93.184.216.34");
  });
});
