document.addEventListener('DOMContentLoaded', () => {
    // Preloader
    window.addEventListener('load', () => {
        document.querySelector('.preloader').style.display = 'none';
    });

    // Mobile Menu
    const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
    const navbar = document.querySelector('.navbar');

    mobileMenuBtn.addEventListener('click', () => {
        navbar.classList.toggle('active');
    });

    // Hero Slider
    const slides = document.querySelectorAll('.hero-slide');
    let currentSlide = 0;

    function showSlide(n) {
        slides.forEach(slide => slide.classList.remove('active'));
        slides[n].classList.add('active');
    }

    document.querySelector('.slider-next').addEventListener('click', () => {
        currentSlide = (currentSlide + 1) % slides.length;
        showSlide(currentSlide);
    });

    document.querySelector('.slider-prev').addEventListener('click', () => {
        currentSlide = (currentSlide - 1 + slides.length) % slides.length;
        showSlide(currentSlide);
    });

    // Cart Functionality
    const cartIcon = document.querySelector('.cart-icon');
    const cartSidebar = document.querySelector('.cart-sidebar');
    const closeCart = document.querySelector('.close-cart');
    let cartItems = [];

    cartIcon.addEventListener('click', () => {
        cartSidebar.classList.add('active');
    });

    closeCart.addEventListener('click', () => {
        cartSidebar.classList.remove('active');
    });

    // Product Generation
    function generateProducts() {
        return Array.from({length: 12}, (_, i) => ({
            id: i + 1,
            name: `Prodotto ${i + 1}`,
            price: (Math.random() * 100 + 50).toFixed(2),
            image: `https://picsum.photos/400/500?random=${i}`,
            category: ['men', 'women'][Math.floor(Math.random() * 2)]
        }));
    }

    function renderProducts(products) {
        const grid = document.querySelector('.products-grid');
        grid.innerHTML = products.map(product => `
            <div class="product-card" data-category="${product.category}">
                <img src="${product.image}" alt="${product.name}">
                <div class="product-info" style="padding: 1rem">
                    <h3>${product.name}</h3>
                    <p>€${product.price}</p>
                    <button class="btn add-to-cart" data-id="${product.id}">
                        Aggiungi al Carrello
                    </button>
                </div>
            </div>
        `).join('');
    }

    // Filter Products
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            const filter = this.dataset.filter;
            const products = document.querySelectorAll('.product-card');
            
            products.forEach(product => {
                if(filter === 'all' || product.dataset.category === filter) {
                    product.style.display = 'block';
                } else {
                    product.style.display = 'none';
                }
            });
        });
    });

    // Add to Cart
    document.addEventListener('click', (e) => {
        if(e.target.classList.contains('add-to-cart')) {
            const productId = e.target.dataset.id;
            const product = generateProducts().find(p => p.id == productId);
            cartItems.push(product);
            updateCart();
        }
    });

    function updateCart() {
        const count = document.querySelector('.cart-count');
        count.textContent = cartItems.length;
        
        const cartItemsContainer = document.querySelector('.cart-items');
        cartItemsContainer.innerHTML = cartItems.map(item => `
            <div class="cart-item">
                <h4>${item.name}</h4>
                <p>€${item.price}</p>
            </div>
        `).join('');
        
        const total = cartItems.reduce((sum, item) => sum + parseFloat(item.price), 0);
        document.querySelector('.total-price').textContent = `€${total.toFixed(2)}`;
    }

    // Initialize
    renderProducts(generateProducts());
});
