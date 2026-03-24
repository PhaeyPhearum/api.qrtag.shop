
-- Create payment orders table
CREATE TABLE public.payment_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id TEXT NOT NULL,
  tran_id TEXT NOT NULL UNIQUE,
  amount TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'PENDING',
  customer_firstname TEXT,
  customer_lastname TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  aba_response JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (edge functions use service role)
CREATE POLICY "Service role full access" ON public.payment_orders
  FOR ALL USING (true) WITH CHECK (true);

-- Indexes
CREATE INDEX idx_payment_orders_tran_id ON public.payment_orders (tran_id);
CREATE INDEX idx_payment_orders_order_id ON public.payment_orders (order_id);
CREATE INDEX idx_payment_orders_status ON public.payment_orders (status);

-- Timestamp trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_payment_orders_updated_at
  BEFORE UPDATE ON public.payment_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
