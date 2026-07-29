/**
 * Unit tests for the email image pipeline:
 *   - src/lib/emailImages.ts        (pure classification + author warnings)
 *   - src/lib/email-inline-images.ts (fetch + rewrite to inline parts)
 *
 * Usage: npx tsx scripts/email-images-test.ts
 *
 * `fetch` is stubbed, so nothing leaves the machine. What is pinned here is the
 * behaviour an operator pasting a template depends on: what gets carried by the
 * message, what is left remote, and that a hostile or oversized source cannot
 * make the sender do work it should not.
 */

import {
  classifyImageSource,
  extractImageSources,
  imageWarnings,
} from "../src/lib/emailImages";
import { inlineEmailImages } from "../src/lib/email-inline-images";

let failures = 0;
function check(label: string, condition: boolean, detail?: string): void {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${!condition && detail ? ` — ${detail}` : ""}`);
  if (!condition) failures += 1;
}

// A 1x1 transparent PNG.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PNG_BYTES = Buffer.from(PNG_BASE64, "base64");
const DATA_URI = `data:image/png;base64,${PNG_BASE64}`;

// ---------------------------------------------------------------------------
// Extraction + classification
// ---------------------------------------------------------------------------

check(
  "extracts sources from single and double quotes",
  JSON.stringify(extractImageSources(`<img src="a.png"><img src='b.png'>`)) === JSON.stringify(["a.png", "b.png"]),
);
check("de-duplicates a source used twice", extractImageSources(`<img src="a.png"><img src="a.png">`).length === 1);
check("ignores markup that is not an img", extractImageSources(`<a href="x.png">x</a>`).length === 0);

check("the logo cid is recognised", classifyImageSource("cid:glaura-logo") === "inline-logo");
check("another cid is dangling", classifyImageSource("cid:banner") === "dangling-cid");
check("a data URI is inlinable", classifyImageSource(DATA_URI) === "data");
check("an allowlisted host is hosted", classifyImageSource("https://storage.googleapis.com/glaura-user-media-eu/x.png") === "hosted");
check("glaura.ai is hosted", classifyImageSource("https://glaura.ai/images/images/x.png") === "hosted");
check("any other host is foreign", classifyImageSource("https://cdn.evil.example/x.png") === "foreign-host");
check("http is flagged as insecure", classifyImageSource("http://glaura.ai/x.png") === "insecure");
check("a relative path is relative", classifyImageSource("/images/x.png") === "relative");

check("warnings stay silent on sources that work", imageWarnings(`<img src="cid:glaura-logo"><img src="${DATA_URI}">`).length === 0);
check("warnings flag a relative path", imageWarnings(`<img src="/x.png">`)[0]?.message.includes("relatif") === true);
check("warnings flag a foreign host", imageWarnings(`<img src="https://cdn.evil.example/x.png">`).length === 1);

// ---------------------------------------------------------------------------
// Inlining
// ---------------------------------------------------------------------------

type FetchStub = { calls: string[]; restore: () => void };

function stubFetch(handler: (url: string) => Response): FetchStub {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return handler(url);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function imageResponse(bytes: Buffer, contentType = "image/png"): Response {
  return new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": contentType } });
}

async function run() {
  // A data URI needs no network at all.
  {
    const stub = stubFetch(() => imageResponse(PNG_BYTES));
    const result = await inlineEmailImages(`<img src="${DATA_URI}">`);
    stub.restore();
    check("a data URI becomes an inline part", result.attachments.length === 1 && result.attachments[0].content.equals(PNG_BYTES));
    check("the data URI is replaced by its cid", result.html === `<img src="cid:${result.attachments[0].cid}">`);
    check("no fetch is made for a data URI", stub.calls.length === 0);
  }

  // An allowlisted URL is downloaded and carried.
  {
    const url = "https://storage.googleapis.com/glaura-user-media-eu/email_assets/banner.png";
    const stub = stubFetch(() => imageResponse(PNG_BYTES));
    const result = await inlineEmailImages(`<img src="${url}"><img src="${url}">`);
    stub.restore();
    check("an allowlisted image is downloaded once and reused", stub.calls.length === 1 && result.attachments.length === 1);
    check("both references point at the same cid", result.html.split(`cid:${result.attachments[0].cid}`).length - 1 === 2);
    check("the part is marked inline", result.attachments[0].contentDisposition === "inline");
  }

  // Everything else is left exactly as pasted.
  {
    const stub = stubFetch(() => imageResponse(PNG_BYTES));
    const html = `<img src="https://cdn.evil.example/x.png"><img src="/rel.png"><img src="cid:glaura-logo">`;
    const result = await inlineEmailImages(html);
    stub.restore();
    check("a foreign host is never fetched", stub.calls.length === 0);
    check("nothing is rewritten and the body survives intact", result.html === html && result.attachments.length === 0);
    check("skipped counts every source left alone", result.skipped === 3);
  }

  // Guards.
  {
    const url = "https://glaura.ai/huge.png";
    const stub = stubFetch(() => imageResponse(Buffer.alloc(4 * 1024 * 1024)));
    const result = await inlineEmailImages(`<img src="${url}">`);
    stub.restore();
    check("an oversized image is left remote rather than attached", result.attachments.length === 0 && result.skipped === 1);
  }
  {
    const url = "https://glaura.ai/not-an-image";
    const stub = stubFetch(() => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }));
    const result = await inlineEmailImages(`<img src="${url}">`);
    stub.restore();
    check("a non-image response is refused", result.attachments.length === 0);
  }
  {
    const url = "https://glaura.ai/gone.png";
    const stub = stubFetch(() => new Response("", { status: 404 }));
    const result = await inlineEmailImages(`<img src="${url}">`);
    stub.restore();
    check("a 404 leaves the original URL in place", result.html.includes(url));
  }
  {
    const url = "https://glaura.ai/boom.png";
    const original = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error("network down"); }) as typeof fetch;
    const result = await inlineEmailImages(`<img src="${url}">`);
    globalThis.fetch = original;
    check("a network failure never throws out of the inliner", result.html.includes(url) && result.attachments.length === 0);
  }

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run();
