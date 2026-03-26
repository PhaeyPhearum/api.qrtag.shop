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
    const merchantId = Deno.env.get("PAYWAY_MERCHANT_ID");
    const apiKey = Deno.env.get("PAYWAY_API_KEY");
    if (!merchantId || !apiKey) {
      return new Response(JSON.stringify({ success: false, error: "Server configuration error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { tran_id } = await req.json();
    if (!tran_id) {
      return new Response(JSON.stringify({ success: false, error: "Missing tran_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: order, error: dbError } = await supabase
      .from("payment_orders").select("*").eq("tran_id", tran_id).single();

    if (dbError || !order) {
      return new Response(JSON.stringify({ success: false, error: "Order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (order.status === "PAID" || order.status === "FAILED") {
      return new Response(JSON.stringify({
        success: true,
        status: order.status === "PAID" ? "APPROVED" : "FAILED",
        tran_id,
        order_id: order.order_id,
        external_order_id: order.external_order_id || null,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const baseUrl = getBaseUrl();
    const reqTime = getReqTime();
    const hash = await generateHash(`${reqTime}${merchantId}${tran_id}`, apiKey);

    console.log("Polling ABA:", baseUrl, "tran_id:", tran_id);

    try {
      const abaResponse = await fetch(`${baseUrl}/api/payment-gateway/v1/payments/check-transaction-2`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ req_time: reqTime, merchant_id: merchantId, tran_id, hash }).toString(),
      });
      const abaData = await abaResponse.json();
      console.log("ABA status:", JSON.stringify(abaData));

      let resolvedStatus = "PENDING";
      if (abaData.status === "0" || abaData.payment_status === "APPROVED") {
        resolvedStatus = "APPROVED";
        await supabase.from("payment_orders").update({ status: "PAID", aba_response: abaData }).eq("tran_id", tran_id).eq("status", "PENDING");
      } else if (abaData.status === "1" || abaData.payment_status === "FAILED" || abaData.payment_status === "DECLINED") {
        resolvedStatus = "FAILED";
        await supabase.from("payment_orders").update({ status: "FAILED", aba_response: abaData }).eq("tran_id", tran_id).eq("status", "PENDING");
      }

      return new Response(JSON.stringify({
        success: true,
        status: resolvedStatus,
        tran_id,
        order_id: order.order_id,
        external_order_id: order.external_order_id || null,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (abaErr) {
      console.error("ABA poll failed:", abaErr);
      return new Response(JSON.stringify({
        success: true,
        status: "PENDING",
        tran_id,
        order_id: order.order_id,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (err) {
    console.error("Status error:", err);
    return new Response(JSON.stringify({ success: false, error: (err as Error).message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
