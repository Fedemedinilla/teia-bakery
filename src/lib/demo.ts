// Demo data — used ONLY when Supabase isn't configured, so the storefront and panel are fully
// clickable for a local preview or a prospect demo before any database is wired. Once
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set, the app uses the real tables instead.
//
// Las image_url apuntan a fotos de stock self-hosteadas en /public/img (TEMPORALES) — se
// reemplazan por las fotos reales de Teia desde /administradora. Si una no carga, el catálogo
// cae a la plaquita con la inicial.

export const DEMO_PRODUCTS = [
  // Tortas
  { id: 1, name: 'Cheesecake de frutos rojos', category: 'Tortas', description: 'Base de vainilla, frutos rojos frescos.', pack_label: 'x6',  price: 28800, stock: 24, low_stock_threshold: 6,  active: true, image_url: '/img/cheesecake.jpg' },
  { id: 2, name: 'Lemon pie',                   category: 'Tortas', description: 'Merengue italiano flameado.',           pack_label: 'x6',  price: 25200, stock: 0,  low_stock_threshold: 6,  active: true, image_url: '/img/lemonpie.jpg' },
  { id: 3, name: 'Chocotorta individual',       category: 'Tortas', description: 'Clásica, en formato individual.',       pack_label: 'x12', price: 26400, stock: 18, low_stock_threshold: 6,  active: true, image_url: '/img/chocotorta.jpg' },

  // Postres
  { id: 4, name: 'Pavlova individual',          category: 'Postres', description: 'Merengue, crema y estación.',          pack_label: 'x12', price: 30000, stock: 4,  low_stock_threshold: 6,  active: true, image_url: '/img/pavlova.jpg' },
  { id: 5, name: 'Brownie premium',             category: 'Postres', description: 'Chocolate 70%, nuez pecán.',           pack_label: 'x12', price: 21600, stock: 40, low_stock_threshold: 8,  active: true, image_url: '/img/brownie.jpg' },
  { id: 6, name: 'Alfajores de maicena',        category: 'Postres', description: 'Dulce de leche, coco rallado.',        pack_label: 'x12', price: 14400, stock: 60, low_stock_threshold: 10, active: true, image_url: '/img/alfajores.jpg' },

  // Panadería
  { id: 7, name: 'Medialunas de manteca',       category: 'Panadería', description: 'Hojaldre, glaseado suave.',          pack_label: 'x12', price: 9600,  stock: 80, low_stock_threshold: 12, active: true, image_url: '/img/medialunas.jpg' },
  { id: 8, name: 'Facturas surtidas',           category: 'Panadería', description: 'Surtido del día.',                   pack_label: 'x12', price: 11200, stock: 50, low_stock_threshold: 12, active: true, image_url: '/img/facturas.jpg' },

  // Salados
  { id: 9, name: 'Tarta de verdura',            category: 'Salados', description: 'Acelga, ricota y cebolla.',            pack_label: 'x6',  price: 19200, stock: 12, low_stock_threshold: 6,  active: true, image_url: '/img/tarta.jpg' },
  { id: 10, name: 'Empanadas caprese',          category: 'Salados', description: 'Tomate, muzzarella y albahaca.',       pack_label: 'x12', price: 15600, stock: 30, low_stock_threshold: 8,  active: true, image_url: '/img/empanadas.jpg' },
];

export const DEMO_ORDERS = [
  { id: 101, order_number: 'TEIA-0041', client_name: 'Café de la Esquina', client_contact: '11 5555-1234',  delivery_date: '2026-07-03', total: 86400, status: 'pendiente' },
  { id: 100, order_number: 'TEIA-0040', client_name: 'Almacén Belén',      client_contact: 'belen@correo.com', delivery_date: '2026-07-02', total: 50400, status: 'confirmado' },
];

// A sample "last order" so the Recompra (reorder) card is visible in the demo.
export const DEMO_LAST_ORDER = {
  order_number: 'TEIA-0040',
  items: [
    { id: 7, name: 'Medialunas de manteca',       pack: 'x12', price: 9600,  qty: 3 },
    { id: 1, name: 'Cheesecake de frutos rojos',   pack: 'x6',  price: 28800, qty: 1 },
  ],
};
