/**
 * API Gateway — routes /api/payments/* to internal edge functions.
 * Frontend calls this single endpoint without needing apikey headers.
 * 
 * Usage:
 *   POST https://<project>.supabase.co/functions/v1/api
 *   Body: { "route": "payments/create", ...payload }
 * 
 * Or via custom domain:
 *   POST https://api.qrtag.shop/api/payments/create
 */

const ALLOWED_ORIGINS = [
  "https://www.qrtag.shop",
  "https://qrtag.shop",
];

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (/^https:\/\/.*\.lovable\.app$/.test(origin)) return true;
  return false;
}

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin");
  const allowed = isAllowedOrigin(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin! : "",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

const ROUTE_MAP: Record<string, string> = {
  "payments/create": "payments-create",
  "payments/webhook": "payments-webhook",
  "payments/status": "payments-status",
};

function summarizePayload(payload: Record<string, unknown>) {
  return {
    keys: Object.keys(payload),
    has_customer_info: Boolean(payload.customer_info),
    customer_info_type: typeof payload.customer_info,
    top_level_customer_fields: {
      firstname: payload.firstname !== undefined,
      lastname: payload.lastname !== undefined,
      email: payload.email !== undefined,
      phone: payload.phone !== undefined,
    },
    preview: {
      order_id: payload.order_id ?? null,
      amount: payload.amount ?? null,
      currency: payload.currency ?? null,
      external_order_id: payload.external_order_id ?? null,
    },
  };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ success: false, error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Determine route from body or URL path
    let route: string | undefined;
    let payload: Record<string, unknown> = {};

    const url = new URL(req.url);
    // Support path-based routing: /api/payments/create etc.
    const pathMatch = url.pathname.match(/\/api\/(.+)/);
    if (pathMatch) {
      route = pathMatch[1];
      payload = await req.json().catch(() => ({}));
    } else {
      // Fallback: route in body
      const body = await req.json();
      route = body.route as string;
      const { route: _, ...rest } = body;
      payload = rest;
    }

    console.log("[Gateway] Incoming request summary:", {
      route,
      pathname: url.pathname,
      summary: summarizePayload(payload),
    });

    if (!route || !ROUTE_MAP[route]) {
      return new Response(JSON.stringify({
        success: false,
        error: `Unknown route: ${route}. Valid routes: ${Object.keys(ROUTE_MAP).join(", ")}`,
      }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const functionName = ROUTE_MAP[route];
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    console.log(`[Gateway] Routing ${route} → ${functionName}`);
    console.log("[Gateway] Forwarding payload summary:", summarizePayload(payload));

    // Call the internal edge function
    const internalResponse = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify(payload),
    });

    const responseBody = await internalResponse.text();

    return new Response(responseBody, {
      status: internalResponse.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[Gateway] Error:", err);
    return new Response(JSON.stringify({ success: false, error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
