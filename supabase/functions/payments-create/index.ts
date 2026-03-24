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
    "raw",
    encoder.encode(apiKey),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(hashString));
  return base64Encode(new Uint8Array(signature));
}

function generateTranId(): string {
  const now = Date.now();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `QRT${now}${random}`;
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
      console.error("Missing PAYWAY_MERCHANT_ID or PAYWAY_API_KEY");
      return new Response(JSON.stringify({ success: false, error: "Server configuration error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { order_id, amount, currency = "USD", customer_info, external_order_id } = body;

    if (!order_id || !amount || !customer_info) {
      return new Response(JSON.stringify({ success: false, error: "Missing required fields: order_id, amount, customer_info" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const firstname = (customer_info.firstname || "").trim();
    const lastname = (customer_info.lastname || "").trim();
    const email = (customer_info.email || "").trim();
    const phone = (customer_info.phone || "").trim();
    const normalizedAmount = parseFloat(amount).toFixed(2);
    const reqTime = getReqTime();
    const tranId = generateTranId();
    const returnParams = order_id;

    const webhookUrl = "https://api.qrtag.shop/api/payments/webhook";

    console.log("=== Payment Create ===");
    console.log("order_id:", order_id);
    console.log("external_order_id:", external_order_id || "(none)");
    console.log("tran_id:", tranId);
    console.log("amount:", normalizedAmount);
    console.log("env:", Deno.env.get("PAYWAY_ENV") || "SANDBOX");
    console.log("base_url:", getBaseUrl());
    console.log("webhook_url:", webhookUrl);

    const hashString = `${reqTime}${merchantId}${tranId}${normalizedAmount}${firstname}${lastname}${email}${phone}${returnParams}`;
    console.log("hash_string:", hashString);

    const hash = await generateHash(hashString, apiKey);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { error: dbError } = await supabase.from("payment_orders").insert({
      order_id,
      tran_id: tranId,
      amount: normalizedAmount,
      currency,
      status: "PENDING",
      customer_firstname: firstname,
      customer_lastname: lastname,
      customer_email: email,
      customer_phone: phone,
      external_order_id: external_order_id || null,
    });

    if (dbError) {
      console.error("DB insert error:", dbError);
      return new Response(JSON.stringify({ success: false, error: "Failed to save order" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const baseUrl = getBaseUrl();

    const formData = {
      req_time: reqTime,
      merchant_id: merchantId,
      tran_id: tranId,
      amount: normalizedAmount,
      firstname,
      lastname,
      email,
      phone,
      return_params: returnParams,
      hash,
      payment_option: "abapay_deeplink",
      currency,
      continue_success_url: webhookUrl,
      return_url: webhookUrl,
    };

    return new Response(JSON.stringify({
      success: true,
      tran_id: tranId,
      payment_url: `${baseUrl}/api/payment-gateway/v1/payments/purchase`,
      form_data: formData,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Create error:", err);
    return new Response(JSON.stringify({ success: false, error: err.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
