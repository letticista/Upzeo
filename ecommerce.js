// Tema dark/light
const toggle = document.getElementById('theme-toggle');
toggle.addEventListener('click', () => {
  const theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  toggle.textContent = theme === 'dark' ? '🌙' : '☀️';
});

// Scroll to prodotti
function scrollToProducts() {
  document.getElementById('products').scrollIntoView({ behavior: 'smooth' });
}

// Gestione parallax shapes
gsap.utils.toArray('.shape').forEach((el, i) => {
  gsap.to(el, { y: 20 + i * 10, repeat: -1, yoyo: true, ease: 'sine.inOut', duration: 4 + i });
});

// Prodotti di esempio
const products = [
  { id:1, name:'Cuffie Wireless', desc:'Audio cristallino e comode.', price:59.99, image:'https://source.unsplash.com/featured/?headphones' },
  { id:2, name:'Smartwatch', desc:'Monitoraggio salute 24/7.', price:129.99, image:'https://source.unsplash.com/featured/?smartwatch' },
  { id:3, name:'Speaker Bluetooth', desc:'Suono potente ovunque.', price:79.99, image:'https://source.unsplash.com/featured/?speaker' },
  { id:4, name:'Fotocamera Digitale', desc:'Scatti perfetti ad alta risoluzione.', price:249.99, image:'https://source.unsplash.com/featured/?camera' }
];

let cart = [];
const grid = document.querySelector('.product-grid');
const cartIcon = document.getElementById('cart-icon');
const cartCount = document.getElementById('cart-count');
const cartModal = document.getElementById('cart-modal');
const cartContent = document.getElementById('cart-content');
const closeBtn = document.getElementById('close-cart');
const itemsList = document.getElementById('cart-items');
const totalEl = document.getElementById('cart-total');
const checkout = document.getElementById('checkout-btn');

// Render prodotti con tilting
products.forEach(p=>{
  const card = document.createElement('div'); card.className='product-card';
  card.innerHTML=`<div class="inner"><img src="${p.image}" alt><div class="product-info"><h3>${p.name}</h3><p>${p.desc}</p><div class="price">€${p.price.toFixed(2)}</div><button onclick="addToCart(${p.id})">Aggiungi</button></div></div>`;
  // Tilt on mousemove
  card.addEventListener('mousemove', e=>{
    const rect=card.getBoundingClientRect();
    const x=(e.clientX-rect.left)/rect.width-0.5;
    const y=(e.clientY-rect.top)/rect.height-0.5;
    card.querySelector('.inner').style.transform=`rotateY(${x*20}deg) rotateX(${ -y*20}deg)`;
  });
  card.addEventListener('mouseleave',()=>{
    card.querySelector('.inner').style.transform='rotateY(0) rotateX(0)';
  });
  grid.appendChild(card);
});

function addToCart(id) {
  const prod=products.find(x=>x.id===id);
  const exist=cart.find(i=>i.id===id);
  if(exist) exist.qty++; else cart.push({...prod,qty:1});
  updateCart();
}
function removeFromCart(id) { cart=cart.filter(i=>i.id!==id); updateCart(); }
function updateCart() {
  cartCount.textContent=cart.reduce((s,i)=>s+i.qty,0);
  itemsList.innerHTML=''; let sum=0;
  cart.forEach(i=>{ sum+=i.price*i.qty; const li=document.createElement('li'); li.innerHTML=`${i.name} x ${i.qty} = €${(i.price*i.qty).toFixed(2)} <button onclick="removeFromCart(${i.id})">×</button>`; itemsList.appendChild(li); });
  totalEl.textContent=sum.toFixed(2);
  if(window.UpzeoSDK) UpzeoSDK.emit('cart:update', cart);
}

cartIcon.addEventListener('click',()=>{ cartModal.style.display='flex'; cartContent.classList.add('open'); });
closeBtn.addEventListener('click',()=>{ cartModal.style.display='none'; cartContent.classList.remove('open'); });
checkout.addEventListener('click',()=>{ alert('Grazie per l\'acquisto!'); cart=[]; updateCart(); cartModal.style.display='none'; if(window.UpzeoSDK) UpzeoSDK.emit('checkout:complete'); });
