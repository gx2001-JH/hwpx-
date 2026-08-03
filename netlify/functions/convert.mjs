import { buildHwpxBytes } from "./hwpxBuilder.mjs";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const bodyText = await req.text();
  const params = new URLSearchParams(bodyText);
  const text = params.get("text") || "";
  let filename = (params.get("filename") || "output").trim();
  filename = filename.replace(/[\\/:*?"<>|]/g, "").trim() || "output";

  if (!text.trim()) {
    return new Response(JSON.stringify({ error: "변환할 텍스트를 입력해주세요." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const data = buildHwpxBytes(text, filename);
    return new Response(data, {
      status: 200,
      headers: {
        "Content-Type": "application/haansofthwpx",
        "Content-Disposition": `attachment; filename="${filename}.hwpx"`,
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: `변환 중 오류가 발생했습니다: ${e.message}` }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config = {
  path: "/convert",
};
