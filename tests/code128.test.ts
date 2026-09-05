import assert from "node:assert/strict";
import test from "node:test";
import { code128Modules } from "../lib/code128.ts";
import { buildersHubCatalogue } from "../lib/builders-hub-catalogue.ts";

// Independent decoder built from the same pattern table used by
// code128Modules, so a round trip proves the encoder produces a spec-correct
// Code 128 symbol (right modules, right checksum) without needing a
// physical scanner. See lib/code128.ts for the encoder.
const patterns = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213", "221312", "231212",
  "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131",
  "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321", "232121", "111323", "131123", "131321",
  "112313", "132113", "132311", "211313", "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114",
  "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111", "111242", "121142", "121241", "114212",
  "124112", "124211", "411212", "421112", "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

function decode(bars: Array<{ black: boolean; width: number }>) {
  const moduleString = bars.map((bar) => String(bar.width)).join("");
  const startToken = moduleString.slice(0, 6);
  assert.equal(patterns.indexOf(startToken), 104, `expected Start Code B, got token ${startToken}`);

  const stopToken = moduleString.slice(-7);
  assert.equal(patterns.indexOf(stopToken), 106, `expected Stop pattern, got token ${stopToken}`);

  const middle = moduleString.slice(6, -7);
  assert.equal(middle.length % 6, 0, "data+checksum region must be a whole number of 6-module symbols");
  const indices: number[] = [];
  for (let i = 0; i < middle.length; i += 6) {
    const token = middle.slice(i, i + 6);
    const index = patterns.indexOf(token);
    assert.notEqual(index, -1, `unknown pattern token: ${token}`);
    indices.push(index);
  }
  const checksum = indices[indices.length - 1];
  const dataValues = indices.slice(0, -1);
  const expectedChecksum = (104 + dataValues.reduce((sum, value, i) => sum + value * (i + 1), 0)) % 103;
  assert.equal(checksum, expectedChecksum, "encoded checksum does not match the Code 128 checksum formula");
  return dataValues.map((value) => String.fromCharCode(value + 32)).join("");
}

test("pattern table matches the Code 128 spec for Start Code B and Stop", () => {
  assert.equal(patterns.length, 107);
  assert.equal(patterns[104], "211214"); // Start Code B: widths 2,1,1,2,1,4
  assert.equal(patterns[106], "2331112"); // Stop: widths 2,3,3,1,1,1,2
});

test("every real catalogue barcode round-trips through encode and decode", () => {
  for (const product of buildersHubCatalogue) {
    const decoded = decode(code128Modules(product.barcode));
    assert.equal(decoded, product.barcode, `barcode for ${product.sku} did not round-trip`);
  }
});

test("edge cases round-trip: short, long, punctuation, mixed case", () => {
  const cases = [
    "A",
    "1234567890",
    "BH1234567890123",
    "TIL-BHX3600-10-60",
    "abc-def",
    "SKU/2026.08#1",
  ];
  for (const value of cases) {
    assert.equal(decode(code128Modules(value)), value);
  }
});

test("rejects characters outside the printable ASCII range Code 128 subset B supports", () => {
  assert.throws(() => code128Modules("café"), /printable characters/);
  assert.throws(() => code128Modules(""), /printable characters/);
});
