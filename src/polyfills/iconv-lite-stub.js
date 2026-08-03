// Minimal Workers-compatible stand-in for `iconv-lite`.
//
// The real `iconv-lite` package crashes when bundled for Cloudflare Workers
// (Uncaught TypeError: require_streams(...) is not a function — see
// https://github.com/cloudflare/workers-sdk/issues/9309). It is pulled in
// transitively by express -> body-parser -> raw-body, purely to decode
// request bodies with a non-default charset.
//
// JSON APIs sent with the default/standard `application/json` content type
// are UTF-8 (or plain ASCII, a subset of UTF-8), so we only need to support
// those two encodings here. If you need to accept other charsets (e.g.
// windows-1251, shift_jis) from clients, you will need a fuller polyfill.

function normalize(encoding) {
  return String(encoding || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function isSupported(encoding) {
  const enc = normalize(encoding);
  return enc === "utf8" || enc === "ascii" || enc === "usascii" || enc === "";
}

function assertSupported(encoding) {
  if (!isSupported(encoding)) {
    const err = new Error("Encoding not recognized: " + encoding);
    throw err;
  }
}

export function encodingExists(encoding) {
  return isSupported(encoding);
}

export function decode(buf, encoding) {
  assertSupported(encoding);
  return new TextDecoder("utf-8").decode(buf);
}

export function encode(str, encoding) {
  assertSupported(encoding);
  return Buffer.from(new TextEncoder().encode(str));
}

// Used by raw-body/body-parser as a streaming decoder.
export function getDecoder(encoding) {
  assertSupported(encoding);
  const textDecoder = new TextDecoder("utf-8");
  return {
    write(buf) {
      return textDecoder.decode(buf, { stream: true });
    },
    end() {
      return textDecoder.decode();
    },
  };
}

export function getEncoder(encoding) {
  assertSupported(encoding);
  const textEncoder = new TextEncoder();
  return {
    write(str) {
      return Buffer.from(textEncoder.encode(str));
    },
    end() {
      return Buffer.alloc(0);
    },
  };
}

export default { encodingExists, decode, encode, getDecoder, getEncoder };
