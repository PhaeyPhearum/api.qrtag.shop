import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// CORS
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

// CLEAN VALUE
function clean(v: any): string {
  return v === undefined || v === null ? "" : String(v).trim();
}

function summarizeRequestBody(body: Record<string, unknown>) {
  return {
    keys: Object.keys(body),
    has_customer_info: Boolean(body.customer_info),
    customer_info_type: typeof body.customer_info,
    top_level_customer_fields: {
      firstname: body.firstname !== undefined,
      lastname: body.lastname !== undefined,
      email: body.email !== undefined,
      phone: body.phone !== undefined,
    },
    preview: {
      order_id: body.order_id ?? null,
      amount: body.amount ?? null,
      currency: body.currency ?? null,
      external_order_id: body.external_order_id ?? null,
    },
  };
}

// IDs
function generateTranId(): string {
  return `${Math.floor(Date.now() / 1000)}${Math.floor(Math.random() * 1000)}`;
}

function getReqTime(): string {
  return String(Math.floor(Date.now() / 1000));
}

function getBaseUrl(): string {
  return Deno.env.get("PAYWAY_BASE_URL") || "https://checkout-sandbox.payway.com.kh";
}

// BASE64
function bufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// HASH
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

  return bufferToBase64(signature);
}

// MAIN
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
  }

  try {
    console.log("STEP 1: request");

    const merchantId = Deno.env.get("PAYWAY_MERCHANT_ID");
    const apiKey = Deno.env.get("PAYWAY_API_KEY");

    if (!merchantId || !apiKey) {
      throw new Error("Missing env config");
    }

    const body = await req.json();
    console.log("STEP 2: body", body);
    console.log("STEP 2A: body summary", summarizeRequestBody(body));

    const {
      order_id,
      amount,
      customer_info,
      external_order_id,
      firstname: topLevelFirstname,
      lastname: topLevelLastname,
      email: topLevelEmail,
      phone: topLevelPhone,
    } = body;

    if (!order_id || !amount) {
      throw new Error("Missing required fields");
    }

    // Accept both:
    // 1. { customer_info: { firstname, lastname, email, phone } }
    // 2. { firstname, lastname, email, phone }
    const customer =
      customer_info && typeof customer_info === "object"
        ? customer_info
        : {};

    const firstname = clean(customer.firstname ?? topLevelFirstname);
    const lastname = clean(customer.lastname ?? topLevelLastname);
    const email = clean(customer.email ?? topLevelEmail);
    const phone = clean(customer.phone ?? topLevelPhone);

    console.log("CUSTOMER_INFO_SOURCE:", {
      has_customer_info: Boolean(customer_info),
      customer_info_type: typeof customer_info,
      top_level_fields_present: {
        firstname: topLevelFirstname !== undefined,
        lastname: topLevelLastname !== undefined,
        email: topLevelEmail !== undefined,
        phone: topLevelPhone !== undefined,
      },
    });
    console.log("CUSTOMER_INFO_RECEIVED:", customer);
    console.log("CUSTOMER_FIELDS_RESOLVED:", {
      firstname,
      lastname,
      email,
      phone,
    });

    if (!firstname && !lastname && !email && !phone) {
      console.warn("CUSTOMER_FIELDS_MISSING:", {
        message: "No customer fields were provided by the caller",
        expected_shapes: [
          "{ customer_info: { firstname, lastname, email, phone } }",
          "{ firstname, lastname, email, phone }",
        ],
        body_summary: summarizeRequestBody(body),
      });
    }

    const normalizedAmount = Number(amount).toFixed(2);
    const reqTime = getReqTime();
    const tranId = generateTranId();
    const returnParams = clean(order_id);

    // ✅ ALWAYS include all fields (even empty)
    const hashParts = [
      reqTime,
      merchantId,
      tranId,
      normalizedAmount,
      firstname,
      lastname,
      email,
      phone,
      returnParams,
    ];

    const hashString = hashParts.join("");

    console.log("HASH_PARTS:", hashParts);
    console.log("FINAL_HASH_STRING:", hashString);

    const hash = await generateHash(hashString, apiKey);
    console.log("STEP 3: hash", hash);

    // ⚠️ keep DB disabled until payment works
    /*
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    await supabase.from("payment_orders").insert({
      order_id,
      tran_id: tranId,
      amount: normalizedAmount,
      status: "PENDING",
    });
    */

    const baseUrl = getBaseUrl();
    const returnUrl = "https://www.qrtag.shop/payment/result";

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
      currency: "USD",
      continue_success_url: returnUrl,
      return_url: returnUrl,
    };

    console.log("STEP 4: response ready");

    return new Response(
      JSON.stringify({
        success: true,
        tran_id: tranId,
        payment_url: `${baseUrl}/api/payment-gateway/v1/payments/purchase`,
        form_data: formData,
      }),
      { headers: corsHeaders }
    );

  } catch (err) {
    console.error("ERROR:", err);

    return new Response(
      JSON.stringify({
        success: false,
        error: err.message,
      }),
      { status: 500, headers: corsHeaders }
    );
  }
});
