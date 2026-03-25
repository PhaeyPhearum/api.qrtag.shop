import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as base64Encode } from "https://deno.land/std@0.208.0/encoding/base64.ts";

// CORS
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

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

// MAIN HANDLER
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Method not allowed" }),
        { status: 405, headers: corsHeaders }
      );
    }

    const merchantId = Deno.env.get("PAYWAY_MERCHANT_ID");
    const apiKey = Deno.env.get("PAYWAY_API_KEY");

    if (!merchantId || !apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing env config" }),
        { status: 500, headers: corsHeaders }
      );
    }

    const body = await req.json();

    const {
      order_id,
      amount,
      currency = "USD",
      customer_info,
      external_order_id,
    } = body;

    if (!order_id || !amount) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const customer = customer_info || {};

    const firstname = (customer.firstname || "").trim();
    const lastname = (customer.lastname || "").trim();
    const email = (customer.email || "").trim();
    const phone = (customer.phone || "").trim();

    // 🔥 CRITICAL: normalize ONCE and reuse everywhere
    const normalizedAmount = Number(amount).toFixed(2);

    const reqTime = getReqTime();
    const tranId = generateTranId();
    const returnParams = order_id;

    const returnUrl = "https://www.qrtag.shop/payment/result";

    const hashString = `${reqTime}${merchantId}${tranId}${normalizedAmount}${firstname}${lastname}${email}${phone}${returnParams}`;
    const hash = await generateHash(hashString, apiKey);

    // =========================
    // 🔥 DEBUG LOGS (IMPORTANT)
    // =========================
    console.log("=== PAYWAY DEBUG START ===");

    console.log("tran_id:", tranId);
    console.log("order_id:", order_id);

    console.log("amount (raw):", amount);
    console.log("amount (normalized):", normalizedAmount);

    console.log("req_time:", reqTime);

    console.log("firstname:", firstname);
    console.log("lastname:", lastname);
    console.log("email:", email);
    console.log("phone:", phone);

    console.log("return_url:", returnUrl);
    console.log("continue_success_url:", returnUrl);

    console.log("hash_string:", hashString);
    console.log("hash:", hash);

    console.log("=== PAYWAY DEBUG END ===");
    // =========================

    // SAVE ORDER
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

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
      return new Response(
        JSON.stringify({ success: false, error: "DB insert failed" }),
        { status: 500, headers: corsHeaders }
      );
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
      continue_success_url: returnUrl,
      return_url: returnUrl,
    };

    // 🔥 FINAL DEBUG
    console.log("form_data:", formData);

    return new Response(
      JSON.stringify({
        success: true,
        test_flag: "NEW_BACKEND_V2",
        tran_id: tranId,
        payment_url: `${baseUrl}/api/payment-gateway/v1/payments/purchase`,
        form_data: formData,
      }),
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (err) {
    console.error("❌ ERROR:", err);

    return new Response(
      JSON.stringify({
        success: false,
        error: err?.message || "Internal error",
      }),
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
});