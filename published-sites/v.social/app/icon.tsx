import { ImageResponse } from "next/og";

export const runtime = "edge";
export const contentType = "image/png";

export default function Icon({ params }: { params?: { size?: string } }) {
  const size = Number(params?.size ?? 512);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(180deg,#0d0d11,#050507)",
          color: "#f3f0ea",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "radial-gradient(circle at top, rgba(213,49,39,0.28), transparent 40%)",
          }}
        />
        <div style={{ fontSize: Math.round(size * 0.55), fontWeight: 700, color: "#d53127" }}>V</div>
      </div>
    ),
    {
      width: size,
      height: size,
    },
  );
}
