-- Create Auth users first in the Supabase dashboard, then replace these profile UUIDs
-- with their auth.users IDs before running the profile inserts.

insert into public.categories (id, code, name, attribute_schema) values
('10000000-0000-0000-0000-000000000001','SAN','Toilets','{"required":["color","trap_type","rough_in","flush_type","bowl_shape"]}'),
('10000000-0000-0000-0000-000000000002','TIL','Tiles','{"required":["width_mm","length_mm","finish","application","pieces_per_box","sqm_per_box"]}'),
('10000000-0000-0000-0000-000000000003','DOR','Doors','{"required":["material","width_mm","height_mm","thickness_mm","color","opening_direction"]}'),
('10000000-0000-0000-0000-000000000004','SNK','Kitchen Sinks','{"required":["material","width_mm","length_mm","mount_type"]}'),
('10000000-0000-0000-0000-000000000005','SPC','SPC Flooring','{"required":["color","thickness_mm","wear_layer_mm","pieces_per_box","sqm_per_box"]}'),
('10000000-0000-0000-0000-000000000006','PAN','Panels','{"required":["material","width_mm","length_mm","finish"]}'),
('10000000-0000-0000-0000-000000000007','ACC','Accessories','{"required":[]}')
on conflict (id) do nothing;

insert into public.locations (id, code, name, address) values
('20000000-0000-0000-0000-000000000001','SHOWROOM','Main Showroom','Retail store'),
('20000000-0000-0000-0000-000000000002','WAREHOUSE','Warehouse','Stock storage'),
('20000000-0000-0000-0000-000000000003','DISPLAY','Display Area','Non-sale floor display')
on conflict (id) do nothing;

insert into public.suppliers (id, code, name) values
('30000000-0000-0000-0000-000000000001','KOSCH','KOSCH Import Trading'),
('30000000-0000-0000-0000-000000000002','FORTRESS','Fortress Doors Supply'),
('30000000-0000-0000-0000-000000000003','FUTURA','Futura Tiles')
on conflict (id) do nothing;

