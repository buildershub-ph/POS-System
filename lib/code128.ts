const patterns = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213","221312","231212",
  "112232","122132","122231","113222","123122","123221","223211","221132","221231","213212","223112","312131",
  "311222","321122","321221","312212","322112","322211","212123","212321","232121","111323","131123","131321",
  "112313","132113","132311","211313","231113","231311","112133","112331","132131","113123","113321","133121",
  "313121","211331","231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
  "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214","112412","122114",
  "122411","142112","142211","241211","221114","413111","241112","134111","111242","121142","121241","114212",
  "124112","124211","411212","421112","421211","212141","214121","412121","111143","111341","131141","114113",
  "114311","411113","411311","113141","114131","311141","411131","211412","211214","211232","2331112",
];

export function code128Modules(value: string) {
  const clean = value.trim();
  if (!clean || [...clean].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) > 126)) {
    throw new Error("Code 128 supports printable characters only.");
  }
  const values = [...clean].map((character) => character.charCodeAt(0) - 32);
  const checksum = (104 + values.reduce((total, item, index) => total + item * (index + 1), 0)) % 103;
  const encoded = [104, ...values, checksum, 106].map((item) => patterns[item]).join("");
  const bars: Array<{ black: boolean; width: number }> = [];
  let black = true;
  for (const width of encoded) {
    bars.push({ black, width: Number(width) });
    black = !black;
  }
  return bars;
}

export function generateInternalBarcode() {
  const timestamp = Date.now().toString().slice(-10);
  const random = crypto.getRandomValues(new Uint32Array(1))[0].toString().slice(-3).padStart(3, "0");
  return `BH${timestamp}${random}`;
}
