import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

serve(async (req) => {
  const form = await req.formData();

  const tran_id = form.get("tran_id")?.toString();
  const status = form.get("status")?.toString();

  console.log("WEBHOOK:", { tran_id, status });

  if (!tran_id) {
    return new Response("Missing tran_id", { status: 400 });
  }

  let mappedStatus = "FAILED";

  if (status === "0") mappedStatus = "SUCCESS";
  if (status === "1") mappedStatus = "FAILED";

  await supabase
    .from("payments")
    .update({
      status: mappedStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("tran_id", tran_id);

  return new Response("OK", { status: 200 });
});