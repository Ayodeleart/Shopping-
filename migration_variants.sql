-- ============================================================
-- MARCATO VARIANTS MIGRATION (order_items.variants)
-- Run once in the Supabase SQL editor. Safe to re-run; adds one column, changes nothing else.
--
-- The colour / size a customer picks on the product page is saved on each order line, so the seller and the admin see the
-- exact variant, e.g. {"Colour":"Black","Size":"XL"}. NULL for products without options.
-- Until this is run, orders still work exactly as before; the choices are just not recorded on the order line.
-- ============================================================
alter table order_items add column if not exists variants jsonb;

comment on column order_items.variants is
  'Customer choices for this line, e.g. {"Colour":"Black","Size":"XL"}; NULL when the product has no options.';
