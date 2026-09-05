import Image from "next/image";

type ProductArtworkProps = {
  kind: string;
  alt: string;
  large?: boolean;
};

export function ProductArtwork({ kind, alt, large = false }: ProductArtworkProps) {
  const photograph = kind.startsWith("/") || kind.startsWith("http://") || kind.startsWith("https://") || kind.startsWith("blob:");
  return (
    <div
      aria-label={alt}
      className={`product-artwork ${photograph ? "product-artwork--photo" : `product-artwork--${kind}`} ${large ? "product-artwork--large" : ""}`}
      role="img"
    >
      {photograph ? <Image alt={alt} fill sizes={large ? "(max-width: 900px) 100vw, 55vw" : "(max-width: 600px) 38vw, 25vw"} src={kind} unoptimized /> : <span className="product-artwork__object" />}
    </div>
  );
}
