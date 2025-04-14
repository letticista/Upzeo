document.addEventListener('DOMContentLoaded', function() {
  // INIZIALIZZA EFFETTO 3D
  VANTA.WAVES({
    el: "#3d-background",
    color: 0x00ffe7,
    waveHeight: 20,
    shininess: 50,
    waveSpeed: 1.5,
    zoom: 0.8
  });

  // MENU MOBILE
  const menuToggle = document.querySelector('.menu-toggle');
  const navMenu = document.querySelector('.nav-menu');

  menuToggle.addEventListener('click', function() {
    navMenu.classList.toggle('active');
    menuToggle.classList.toggle('active');
  });

  // ANIMAZIONE NUMERI
  function animateValue(obj, start, end, duration) {
    let startTimestamp = null;
    const step = (timestamp) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);
      obj.innerHTML = Math.floor(progress * (end - start) + start);
      if (progress < 1) {
        window.requestAnimationFrame(step);
      }
    };
    window.requestAnimationFrame(step);
  }

  // TRIGGER ANIMAZIONI
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        if (entry.target.id === 'hero') {
          document.querySelectorAll('.stat-number').forEach(el => {
            animateValue(el, 0, parseInt(el.getAttribute('data-count')), 2000);
          });
        }
        entry.target.classList.add('animated');
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('section').forEach(section => {
    observer.observe(section);
  });
});
