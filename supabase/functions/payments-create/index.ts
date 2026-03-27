import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

// ---------- Helpers ----------

function generateTranId(): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const random = Math.floor(Math.random() * 1000); // 0–999
  return `${timestamp}${random}`;
}

function getReqTime(): string {
  return String(Math.floor(Date.now() / 1000));
}

function normalizeAmount(amount: unknown): string {
  const parsed = Number(amount);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Amount must be a positive number");
  }
  return parsed.toFixed(2); // ✅ critical for hash consistency
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
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

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(hashString)
  );

  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

// ---------- Main ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: "Method not allowed" }),
        { status: 405, headers: corsHeaders }
      );
    }

    // ---------- ENV ----------
    const merchantId = Deno.env.get("PAYWAY_MERCHANT_ID");
    const apiKey = Deno.env.get("PAYWAY_API_KEY");
    const returnUrl = Deno.env.get("PAYWAY_RETURN_URL");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!merchantId || !apiKey) {
      throw new Error("Missing PAYWAY config");
    }

    // ---------- INPUT ----------
    const body = await req.json();
    console.log("STEP 1 BODY:", JSON.stringify(body));

    const orderId = clean(body.order_id);
    const amount = normalizeAmount(body.amount);

    if (!orderId) {
      throw new Error("Missing order_id");
    }

    // ---------- CORE DATA ----------
    const reqTime = getReqTime();
    const tranId = generateTranId();

    const firstname = "Guest";
    const lastname = "User";
    const email = "test@example.com";
    const phone = "85500000000";

    const returnParams = orderId;

    // ---------- HASH ----------
    const hashString =
      reqTime +
      merchantId +
      tranId +
      amount +
      firstname +
      lastname +
      email +
      phone +
      returnParams;

    console.log("HASH_STRING:", hashString);

    const hash = await generateHash(hashString, apiKey);

    console.log("HASH:", hash);

    // ---------- DB INSERT (SOURCE OF TRUTH) ----------
    if (supabaseUrl && serviceRoleKey) {
      const supabase = createClient(supabaseUrl, serviceRoleKey);

      await supabase.from("payments").insert({
        order_id: orderId,
        tran_id: tranId,
        amount: Number(amount),
        currency: "USD",
        status: "PENDING",
        customer_name: `${firstname} ${lastname}`,
        customer_email: email,
        customer_phone: phone,
      });
    }

    // ---------- PAYLOAD ----------
    const formData: Record<string, string> = {
      req_time: reqTime,
      merchant_id: merchantId,
      tran_id: tranId,
      amount,
      firstname,
      lastname,
      email,
      phone,
      return_params: returnParams,
      hash,
    };

    // ✅ IMPORTANT: add AFTER hash (DO NOT include in hash)
    // if (returnUrl) {
    //   formData.return_url = returnUrl;
    // }

    console.log("FINAL_PAYLOAD:", JSON.stringify(formData));

    // ---------- RESPONSE ----------
    return new Response(
      JSON.stringify({
        success: true,
        payment_url:
          "https://checkout-sandbox.payway.com.kh/api/payment-gateway/v1/payments/purchase",
        form_data: formData,
        tran_id: tranId,
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    console.error("ERROR:", err);

    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      }),
      { status: 500, headers: corsHeaders }
    );
  }
});