// Toggle Dark/Light Theme
const toggle = document.getElementById('theme-toggle');
toggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  toggle.textContent = next === 'dark' ? '🌙' : '☀️';
});

// Scroll Smooth ai Prodotti
function scrollToProducts() {
  document.getElementById('products').scrollIntoView({ behavior: 'smooth' });
}

// GSAP Hero Animazioni (fade-in shapes)
gsap.from('.hero-content', { opacity: 0, y: 50, duration: 1 });

// Dati Prodotti Temporanei con Immagini da Internet\const products = [
  { id:1, name:'Cuffie Wireless X200', desc:'Suono cristallino e comfort assoluto.', price:79.99, image:'https://source.unsplash.com/featured/?wireless-headphones' },
  { id:2, name:'Smartwatch Ultra Pro', desc:'Monitoraggio salute avanzato 24/7.', price:199.99, image:'https://source.unsplash.com/featured/?fitness-watch' },
  { id:3, name:'Speaker BoomBox', desc:'Bassi potenti per le tue feste.', price:99.99, image:'https://source.unsplash.com/featured/?bluetooth-speaker' },
  { id:4, name:'Mirrorless 4K', desc:'Fotografia professionale in piccolo.', price:349.99, image:'https://source.unsplash.com/featured/?mirrorless-camera' }
];

let cart = [];
const grid = document.getElementById('products');
const cartIcon = document.getElementById('cart-icon');
const cartCount = document.getElementById('cart-count');
const cartModal = document.getElementById('cart-modal');
const cartContent = document.getElementById('cart-content');
const closeBtn = document.getElementById('close-cart');
const itemsList = document.getElementById('cart-items');
const totalEl = document.getElementById('cart-total');
const checkoutBtn = document.getElementById('checkout-btn');

// Render Prodotti con Tween GSAP
products.forEach((p, i) => {
  const card = document.createElement('div'); card.className = 'product-card';
  card.innerHTML = `
    <img src="${p.image}" alt="${p.name}">
    <div class="product-info">
      <h3>${p.name}</h3>
      <p>${p.desc}</p>
      <div class="price">€${p.price.toFixed(2)}</div>
      <button onclick="addToCart(${p.id})">Aggiungi al Carrello</button>
    </div>
  `;
  grid.appendChild(card);
  gsap.from(card, { opacity: 0, y: 30, delay: i * 0.2, duration: 0.8 });
});

function addToCart(id) {
  const prod = products.find(x => x.id === id);
  const exist = cart.find(i => i.id === id);
  if (exist) exist.qty++; else cart.push({ ...prod, qty: 1 });
  updateCart();
  if (window.UpzeoSDK) UpzeoSDK.emit('cart:update', cart);
}

function removeFromCart(id) { cart = cart.filter(i => i.id !== id); updateCart(); }

function updateCart() {
  cartCount.textContent = cart.reduce((s, i) => s + i.qty, 0);
  itemsList.innerHTML = '';
  let sum = 0;
  cart.forEach(i => {
    sum += i.price * i.qty;
    const li = document.createElement('li');
    li.innerHTML = `${i.name} x${i.qty} – €${(i.price * i.qty).toFixed(2)} <button onclick="removeFromCart(${i.id})">×</button>`;
    itemsList.appendChild(li);
  });
  totalEl.textContent = sum.toFixed(2);
}

cartIcon.addEventListener('click', () => {
  cartModal.style.display = 'flex';
  cartContent.classList.add('open');
});
closeBtn.addEventListener('click', () => {
  cartModal.style.display = 'none';
  cartContent.classList.remove('open');
});
checkoutBtn.addEventListener('click', () => {
  alert('Grazie per l'acquisto!');
  cart = [];
  updateCart();
  cartModal.style.display = 'none';
  if (window.UpzeoSDK) UpzeoSDK.emit('checkout:complete');
});
