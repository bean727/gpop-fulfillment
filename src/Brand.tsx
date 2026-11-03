export function BrandMark() {
  return (
    <img
      className="gpop-mark"
      src={`${import.meta.env.BASE_URL}gpop-mark.svg`}
      alt=""
      aria-hidden="true"
    />
  );
}
export default function Brand() {
  return (
    <>
      <BrandMark />
      <span className="gpop-wordmark">
        GPOP<span>FULFILLMENT</span>
      </span>
    </>
  );
}
