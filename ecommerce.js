document.addEventListener('DOMContentLoaded', () => {
    // Preloader
    window.addEventListener('load', () => {
        document.querySelector('.preloader').style.opacity = '0';
        setTimeout(() => {
            document.querySelector('.preloader').style.display = 'none';
        }, 500);
    });

    // Mobile Menu
    const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
    const navbar = document.querySelector('.navbar');
    const menuLinks = document.querySelectorAll('.navbar a');

    mobileMenuBtn.addEventListener('click', () => {
        navbar.classList.toggle('active');
        document.body.classList.toggle('no-scroll');
    });

    menuLinks.forEach(link => {
        link.addEventListener('click', () => {
            navbar.classList.remove('active');
            document.body.classList.remove('no-scroll');
        });
    });

    // Hero Slider con Autoplay
    const slides = document.querySelectorAll('.hero-slide');
    let currentSlide = 0;
    let autoSlideInterval;

    function showSlide(n) {
        slides.forEach(slide => {
            slide.classList.remove('active');
            slide.style.transform = 'scale(1.1)';
        });
        slides[n].classList.add('active');
        slides[n].style.transform = 'scale(1)';
        
        currentSlide = n;
    }

    function nextSlide() {
        let newSlide = currentSlide + 1;
        if(newSlide >= slides.length) newSlide = 0;
        showSlide(newSlide);
    }

    // Avvia autoplay
    autoSlideInterval = setInterval(nextSlide, 5000);

    // Gestione controlli manuali
    document.querySelector('.slider-next').addEventListener('click', () => {
        clearInterval(autoSlideInterval);
        nextSlide();
        autoSlideInterval = setInterval(nextSlide, 5000);
    });

    document.querySelector('.slider-prev').addEventListener('click', () => {
        clearInterval(autoSlideInterval);
        let newSlide = currentSlide - 1;
        if(newSlide < 0) newSlide = slides.length - 1;
        showSlide(newSlide);
        autoSlideInterval = setInterval(nextSlide, 5000);
    });

    // Carrello Avanzato
    const cart = {
        items: [],
        addItem(product) {
            this.items.push(product);
            this.updateCart();
            this.animateCartIcon();
        },
        updateCart() {
            // Aggiorna interfaccia
            document.querySelector('.cart-count').textContent = this.items.length;
            
            // Aggiorna lista prodotti
            const cartItemsContainer = document.querySelector('.cart-items');
            cartItemsContainer.innerHTML = this.items.map((item, index) => `
                <div class="cart-item">
                    <div class="cart-item-image">
                        <img src="${item.image}" alt="${item.name}">
                    </div>
                    <div class="cart-item-info">
                        <h4>${item.name}</h4>
                        <p>€${item.price}</p>
                        <button class="remove-item" data-index="${index}">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `).join('');
            
            // Aggiorna totale
            const total = this.items.reduce((sum, item) => sum + parseFloat(item.price), 0);
            document.querySelector('.total-price').textContent = `€${total.toFixed(2)}`;
        },
        animateCartIcon() {
            const cartIcon = document.querySelector('.cart-icon');
            cartIcon.style.transform = 'scale(1.2)';
            setTimeout(() => {
                cartIcon.style.transform = 'scale(1)';
            }, 300);
        }
    };

    // Aggiungi prodotto al carrello
    document.addEventListener('click', (e) => {
        if(e.target.closest('.add-to-cart')) {
            const productId = e.target.closest('.add-to-cart').dataset.id;
            const product = products.find(p => p.id == productId);
            cart.addItem(product);
        }
        
        if(e.target.closest('.remove-item')) {
            const index = e.target.closest('.remove-item').dataset.index;
            cart.items.splice(index, 1);
            cart.updateCart();
        }
    });

    // Genera prodotti fittizi
    const products = Array.from({length: 12}, (_, i) => ({
        id: i + 1,
        name: `Prodotto ${i + 1}`,
        price: (Math.random() * 100 + 50).toFixed(2),
        image: `https://picsum.photos/400/500?random=${i + 1}`,
        category: ['men', 'women'][Math.floor(Math.random() * 2)]
    }));

    // Renderizza prodotti
    function renderProducts() {
        const grid = document.querySelector('.products-grid');
        grid.innerHTML = products.map(product => `
            <div class="product-card" data-category="${product.category}">
                <div class="product-image">
                    <img src="${product.image}" alt="${product.name}">
                </div>
                <div class="product-info">
                    <h3>${product.name}</h3>
                    <div class="product-details">
                        <p class="price">€${product.price}</p>
                        <button class="btn btn-primary add-to-cart" data-id="${product.id}">
                            <i class="fas fa-shopping-bag"></i>
                            Aggiungi
                        </button>
                    </div>
                </div>
            </div>
        `).join('');
    }

    // Filtra prodotti
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            const filter = this.dataset.filter;
            
            document.querySelectorAll('.product-card').forEach(card => {
                card.style.display = (filter === 'all' || card.dataset.category === filter) 
                    ? 'block' 
                    : 'none';
            });
        });
    });

    // Inizializzazione
    renderProducts();
    showSlide(0);
});
