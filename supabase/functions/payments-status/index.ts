import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

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

    const merchantId = Deno.env.get("PAYWAY_MERCHANT_ID");
    const apiKey = Deno.env.get("PAYWAY_API_KEY");
    const apiUrl = Deno.env.get("PAYWAY_API_URL"); // purchase URL
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!merchantId || !apiKey || !supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing env config");
    }

    const body = await req.json();
    const tranId = clean(body.tran_id);

    if (!tranId) {
      throw new Error("Missing tran_id");
    }

    const reqTime = String(Math.floor(Date.now() / 1000));

    // 🔥 HASH STRING for CHECK API (IMPORTANT)
    const hashString = reqTime + merchantId + tranId;

    const hash = await generateHash(hashString, apiKey);

    // 🔥 CALL ABA CHECK TRANSACTION API
    const checkUrl =
      "https://checkout-sandbox.payway.com.kh/api/payment-gateway/v1/payments/check";

    const formData = new URLSearchParams({
      req_time: reqTime,
      merchant_id: merchantId,
      tran_id: tranId,
      hash,
    });

    const abaRes = await fetch(checkUrl, {
      method: "POST",
      body: formData,
    });

    const abaData = await abaRes.json();

    console.log("ABA CHECK RESPONSE:", JSON.stringify(abaData));

    // 🔥 MAP STATUS
    let status = "PENDING";

    if (abaData?.status === "0") {
      status = "SUCCESS";
    } else if (abaData?.status === "1") {
      status = "FAILED";
    }

    // 🔥 UPDATE DB
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    await supabase
      .from("payments")
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("tran_id", tranId);

    return new Response(
      JSON.stringify({
        success: true,
        status,
        raw: abaData,
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    console.error("STATUS ERROR:", err);

    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      }),
      { status: 500, headers: corsHeaders }
    );
  }
});