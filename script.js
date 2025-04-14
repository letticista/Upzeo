document.addEventListener('DOMContentLoaded', () => {
  // INIZIALIZZA SFONDO 3D
  const vantaEffect = VANTA.WAVES({
    el: "#3d-background",
    color: 0x00ffe7,
    waveHeight: 15,
    shininess: 80,
    waveSpeed: 1.2,
    zoom: 0.8
  });

  // GESTIONE MENU MOBILE
  const menuToggle = document.querySelector('.menu-toggle');
  const navMenu = document.querySelector('.nav-menu');

  menuToggle.addEventListener('click', () => {
    navMenu.classList.toggle('active');
    menuToggle.classList.toggle('active');
    document.body.classList.toggle('no-scroll');
  });

  // CHIUDI MENU AL CLICK ESTERNO
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.navbar') && window.innerWidth <= 768) {
      navMenu.classList.remove('active');
      menuToggle.classList.remove('active');
      document.body.classList.remove('no-scroll');
    }
  });

  // ANIMAZIONE NUMERI STATISTICHE
  const animateNumbers = (entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const counters = document.querySelectorAll('.stat-number');
        counters.forEach(counter => {
          const target = +counter.dataset.count;
          let count = 0;
          
          const updateCount = () => {
            const increment = target / 100;
            if (count < target) {
              count += increment;
              counter.textContent = Math.ceil(count);
              requestAnimationFrame(updateCount);
            } else {
              counter.textContent = target;
            }
          };
          
          updateCount();
        });
        observer.unobserve(entry.target);
      }
    });
  };

  // OSSERVATORE INTERSEZIONE
  const observer = new IntersectionObserver(animateNumbers, {
    threshold: 0.5
  });

  observer.observe(document.querySelector('#hero'));

  // GESTIONE DROPDOWN MOBILE
  const dropdowns = document.querySelectorAll('.dropdown');
  dropdowns.forEach(dropdown => {
    const button = dropdown.querySelector('.dropdown-btn');
    const content = dropdown.querySelector('.dropdown-content');

    button.addEventListener('click', (e) => {
      e.stopPropagation();
      content.classList.toggle('active');
    });

    // CHIUDI DROPDOWN AL CLICK ESTERNO
    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target)) {
        content.classList.remove('active');
      }
    });
  });
});
