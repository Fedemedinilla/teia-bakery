-- Teia Bakery — productos de ejemplo (correr DESPUÉS de schema.sql).
-- Tablas prefijadas `teia_` (proyecto DEMOS compartido). Las image_url son fotos de stock
-- self-hosteadas en /public/img (TEMPORALES) — reemplazá por las reales desde /administradora.

insert into teia_products (name, description, category, image_url, pack_label, price, stock, low_stock_threshold, active, sort_order) values
  ('Cheesecake de frutos rojos', 'Base de vainilla, frutos rojos frescos.', 'Tortas',    '/img/cheesecake.jpg', 'x6',  28800, 24, 6,  true, 1),
  ('Lemon pie',                  'Merengue italiano flameado.',            'Tortas',    '/img/lemonpie.jpg',   'x6',  25200, 0,  6,  true, 2),
  ('Chocotorta individual',      'Clásica, en formato individual.',        'Tortas',    '/img/chocotorta.jpg', 'x12', 26400, 18, 6,  true, 3),
  ('Pavlova individual',         'Merengue, crema y estación.',            'Postres',   '/img/pavlova.jpg',    'x12', 30000, 4,  6,  true, 1),
  ('Brownie premium',            'Chocolate 70%, nuez pecán.',             'Postres',   '/img/brownie.jpg',    'x12', 21600, 40, 8,  true, 2),
  ('Alfajores de maicena',       'Dulce de leche, coco rallado.',          'Postres',   '/img/alfajores.jpg',  'x12', 14400, 60, 10, true, 3),
  ('Medialunas de manteca',      'Hojaldre, glaseado suave.',              'Panadería', '/img/medialunas.jpg', 'x12', 9600,  80, 12, true, 1),
  ('Facturas surtidas',          'Surtido del día.',                       'Panadería', '/img/facturas.jpg',   'x12', 11200, 50, 12, true, 2),
  ('Tarta de verdura',           'Acelga, ricota y cebolla.',              'Salados',   '/img/tarta.jpg',      'x6',  19200, 12, 6,  true, 1),
  ('Empanadas caprese',          'Tomate, muzzarella y albahaca.',         'Salados',   '/img/empanadas.jpg',  'x12', 15600, 30, 8,  true, 2);
