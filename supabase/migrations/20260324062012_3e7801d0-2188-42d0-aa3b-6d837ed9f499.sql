
-- Drop the permissive policy and replace with service-role-only access
DROP POLICY "Service role full access" ON public.payment_orders;

-- No public RLS policies needed - edge functions use service role which bypasses RLS
-- RLS is enabled but with no policies, only service_role can access
