import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as base64Encode } from "https://deno.land/std@0.208.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

async function generateHash(hashString: string, apiKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(apiKey),
    { name: "HMAC", hash: "SHA-512" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(hashString));
  return base64Encode(new Uint8Array(signature));
}

function getReqTime(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function getBaseUrl(): string {
  return Deno.env.get("PAYWAY_BASE_URL") || "https://checkout-sandbox.payway.com.kh";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ success: false, error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    console.log("=== Webhook Received ===");
    console.log("Source IP:", req.headers.get("x-forwarded-for") || "unknown");
    console.log("User-Agent:", req.headers.get("user-agent") || "unknown");

    let body: Record<string, unknown>;
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const text = await req.text();
      body = Object.fromEntries(new URLSearchParams(text).entries());
    } else {
      body = await req.json();
    }

    console.log("Webhook body:", JSON.stringify(body));

    const tranId = body.tran_id as string;
    if (!tranId) {
      return new Response(JSON.stringify({ success: false, error: "Missing tran_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: existingOrder, error: fetchError } = await supabase
      .from("payment_orders").select("status").eq("tran_id", tranId).single();

    if (fetchError || !existingOrder) {
      return new Response(JSON.stringify({ success: false, error: "Order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (existingOrder.status === "PAID" || existingOrder.status === "FAILED") {
      console.log(`Order ${tranId} already ${existingOrder.status}. Skipping.`);
      return new Response(JSON.stringify({ success: true, message: "Already processed" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const merchantId = Deno.env.get("PAYWAY_MERCHANT_ID");
    const apiKey = Deno.env.get("PAYWAY_API_KEY");
    if (!merchantId || !apiKey) {
      return new Response(JSON.stringify({ success: false, error: "Server configuration error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const baseUrl = getBaseUrl();
    const reqTime = getReqTime();
    const hash = await generateHash(`${reqTime}${merchantId}${tranId}`, apiKey);

    console.log("Verifying with ABA:", baseUrl);

    let verifiedStatus = "PENDING";
    try {
      const abaResponse = await fetch(`${baseUrl}/api/payment-gateway/v1/payments/check-transaction-2`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ req_time: reqTime, merchant_id: merchantId, tran_id: tranId, hash }).toString(),
      });
      const abaData = await abaResponse.json();
      console.log("ABA verification:", JSON.stringify(abaData));

      if (abaData.status === "0" || abaData.payment_status === "APPROVED") verifiedStatus = "PAID";
      else if (abaData.status === "1" || abaData.payment_status === "FAILED" || abaData.payment_status === "DECLINED") verifiedStatus = "FAILED";
    } catch (abaErr) {
      console.error("ABA verification failed:", abaErr);
      return new Response(JSON.stringify({ success: false, error: "Verification failed" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (verifiedStatus === "PAID" || verifiedStatus === "FAILED") {
      await supabase.from("payment_orders")
        .update({ status: verifiedStatus, aba_response: body })
        .eq("tran_id", tranId).eq("status", "PENDING");
      console.log(`Order ${tranId} → ${verifiedStatus}`);
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Webhook error:", err);
    return new Response(JSON.stringify({ success: false, error: (err as Error).message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
