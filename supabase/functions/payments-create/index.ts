import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

// ---------- Helpers ----------

function generateTranId(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

function getReqTime(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    String(d.getFullYear()) +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

function normalizeAmount(amount: unknown): string {
  const parsed = Number(String(amount).trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Amount must be positive");
  }
  return parsed.toFixed(2);
}

function clean(v: unknown): string {
  return String(v ?? "").trim();
}

async function generateHash(
  hashString: string,
  apiKey: string
): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(apiKey),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(hashString));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

// ---------- Main ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ success: false }), {
        status: 405,
        headers: corsHeaders,
      });
    }

    // ---------- ENV ----------
    const merchantId   = Deno.env.get("PAYWAY_MERCHANT_ID") ?? "";
    const apiKey       = Deno.env.get("PAYWAY_API_KEY") ?? "";
    const returnUrlRaw = Deno.env.get("PAYWAY_RETURN_URL") ?? "";

    if (!merchantId || !apiKey) {
      throw new Error("Missing PAYWAY_MERCHANT_ID or PAYWAY_API_KEY");
    }
    if (!returnUrlRaw) {
      throw new Error("Missing PAYWAY_RETURN_URL");
    }

    // ---------- INPUT ----------
    const body = await req.json();
    console.log("BODY:", JSON.stringify(body));

    const orderId = clean(body.order_id);
    const amount  = normalizeAmount(body.amount);

    if (!orderId) throw new Error("Missing order_id");

    // ---------- CORE VALUES ----------
    const reqTime = getReqTime();
    const tranId  = generateTranId();

    const firstname = "Guest";
    const lastname  = "User";
    const email     = "guest@qrtag.shop";
    const phone     = "85500000000";
    const currency  = "USD";

    const paymentOption      = "abapay_khqr";
    const returnParams       = tranId;
    const returnUrl          = returnUrlRaw;
    const continueSuccessUrl = returnUrlRaw;

    // Optional fields — empty string if unused
    const items            = "";
    const shipping         = "";
    const type             = "";
    const cancelUrl        = "";
    const returnDeeplink   = "";
    const customFields     = "";
    const payout           = "";
    const lifetime         = "";
    const additionalParams = "";
    const googlePayToken   = "";
    const skipSuccessPage  = "1"; // skip ABA success page → redirect immediately

    // ---------- HASH STRING ----------
    // Exact field order per ABA PayWay Purchase API docs
    // ALL fields included — empty string for unused optional fields
    // Plain URL (not encoded) for all URL fields
    // apiKey = HMAC secret key, NOT part of hash string
    const hashString =
      reqTime           +  // 1.  req_time
      merchantId        +  // 2.  merchant_id
      tranId            +  // 3.  tran_id
      amount            +  // 4.  amount
      items             +  // 5.  items
      shipping          +  // 6.  shipping
      firstname         +  // 7.  firstname
      lastname          +  // 8.  lastname
      email             +  // 9.  email
      phone             +  // 10. phone
      type              +  // 11. type
      paymentOption     +  // 12. payment_option
      returnUrl         +  // 13. return_url
      cancelUrl         +  // 14. cancel_url
      continueSuccessUrl+  // 15. continue_success_url
      returnDeeplink    +  // 16. return_deeplink
      currency          +  // 17. currency
      customFields      +  // 18. custom_fields
      returnParams      +  // 19. return_params
      payout            +  // 20. payout
      lifetime          +  // 21. lifetime
      additionalParams  +  // 22. additional_params
      googlePayToken    +  // 23. google_pay_token
      skipSuccessPage;     // 24. skip_success_page

    console.log("HASH_STRING:", hashString);

    const hash = await generateHash(hashString, apiKey);

    console.log("HASH:", hash);

    // ---------- DB INSERT ----------
    const supabaseUrl    = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (supabaseUrl && serviceRoleKey) {
      const supabase = createClient(supabaseUrl, serviceRoleKey);
      const { error } = await supabase.from("payments").insert({
        order_id: orderId,
        tran_id:  tranId,
        amount:   Number(amount),
        currency: "USD",
        status:   "PENDING",
      });
      if (error) console.error("DB insert error:", error.message);
    }

    // ---------- FORM PAYLOAD ----------
    const formData: Record<string, string> = {
      req_time:             reqTime,
      merchant_id:          merchantId,
      tran_id:              tranId,
      amount,
      firstname,
      lastname,
      email,
      phone,
      currency,
      payment_option:       paymentOption,
      return_params:        returnParams,
      return_url:           returnUrl,
      continue_success_url: continueSuccessUrl,
      skip_success_page:    skipSuccessPage,
      hash,
    };

    console.log("FINAL_PAYLOAD:", JSON.stringify(formData));

    return new Response(
      JSON.stringify({
        success:     true,
        payment_url: "https://checkout-sandbox.payway.com.kh/api/payment-gateway/v1/payments/purchase",
        form_data:   formData,
        tran_id:     tranId,
      }),
      { headers: corsHeaders }
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