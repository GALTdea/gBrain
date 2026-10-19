import { NextRequest, NextResponse } from "next/server";

/**
 * Server-side fallback for POST /capture-share-target.
 * When the Service Worker is active on the device, it intercepts this POST in public/sw.js.
 * If the Service Worker is inactive, warming up, or bypassed, this route receives the
 * multipart/form-data request from Android OS and handles text/url or redirects to /capture.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const title = (formData.get("title") as string) || "";
    const text = (formData.get("text") as string) || "";
    const url = (formData.get("url") as string) || "";

    const params = new URLSearchParams();
    if (title) params.set("title", title);
    if (text) params.set("text", text);
    if (url) params.set("url", url);

    // Redirect user to the capture UI with the parameters
    const redirectUrl = new URL(`/capture?${params.toString()}`, req.url);
    return NextResponse.redirect(redirectUrl, { status: 303 });
  } catch (error) {
    console.error("[Share Target Route] Error parsing form data:", error);
    return NextResponse.redirect(new URL("/capture", req.url), { status: 303 });
  }
}

// Allow GET fallback
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  return NextResponse.redirect(new URL(`/capture?${searchParams.toString()}`, req.url), {
    status: 303,
  });
}

