import { createHash } from "node:crypto";

// Stable host ABI. Digests refer to *decoded HTTP bodies*, including the CMap
// reader's entire Huffman table + indexed binary maps (not cmaps.brotli).
export const resources = [
  ["cmaps", "230f46e3068770bf0e2c515e95473e46df6f0854eff3552e48e355e8ab148868"],
  ["FoxitSansItalic.pfb", "7751cbefeda351708dae8c4a88db043411bc39ab2ae2097685da845d4d16f307"],
  ["FoxitSansBoldItalic.pfb", "555ce45924338e2e4b32821910221ce85da691fd59a9723c4c971a7c5627fc8b"],
  ["FoxitFixedBold.pfb", "f1b7159702973f54fc86254ea38bcf3712b2a736eb3a0995751e9f4bb45ad603"],
  ["FoxitFixedItalic.pfb", "5007faf8320fa1fcc08b8894b356ad976f60b992ba29ee5272578bbdebaf3876"],
  ["FoxitFixedBoldItalic.pfb", "8a000945843bd31add06aee63bf9fd41b7578b4f3242a4b7cd46349ad9d24d4d"],
  ["FoxitSerif.pfb", "4f57d2b9d884af8f907bf22df6019b52d86cbf6214fdbd02b1ae05472a543f35"],
  ["FoxitSerifBold.pfb", "0bdf4b04e964139818d51eda03d566ba999fc3ba2421b1c6c51f9dc969022e80"],
  ["FoxitSerifItalic.pfb", "610ae0687198045c4db5d1a6650fd5e92536631706382eb8b72e38df578d0ae9"],
  ["FoxitSerifBoldItalic.pfb", "a406cac82583bf98175cb62c87ed5e95c45fbb34eece63a10b0a13e793cb2e10"],
  ["FoxitDingbats.pfb", "845c752392b6c914fb989c75a08b7792b88f542d2499042ef2889f8c814a16ed"],
  ["FoxitSymbol.pfb", "47967d055530e7357088a08403115425643ec2cdfd6201ba8af0fbd7116c1539"],
].map(([name, sha256], id) => ({ name, sha256, id, path: `pkg/resources/${id}.bin` }));

export function verifyResource(resource, bytes) {
  if (createHash("sha256").update(bytes).digest("hex") !== resource.sha256)
    throw Error(`Invalid renderer asset: ${resource.path} (${resource.name})`);
}
